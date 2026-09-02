import { Types } from 'mongoose';
import {
  EstadoPresupuesto,
  ORG_UNICA,
  TipoDescuento,
  aCentavos,
  calcularDescuentoAutomatico,
  calcularSubtotalItem,
  calcularTotales,
  congelarCosteo,
  puedeTransicionar,
  resolverEstadoEfectivo,
  type CondicionIva,
  type TramoDescuento,
} from '@calc/shared';
import {
  ClienteModel,
  PresupuestoModel,
  ProductoModel,
  type PresupuestoDoc,
} from '../models/index.js';
import { obtenerConfiguracion, tomarNumeroPresupuesto } from '../models/configuracion.js';
import { conflicto, noEncontrado, solicitudInvalida } from '../http/errores.js';
import { costearProducto } from './costeo.js';

/**
 * Reglas del presupuesto. Las tres que importan:
 *
 *  1. Un presupuesto emitido NO se recalcula nunca. Congela cliente, precios y costos.
 *  2. El numero se asigna al pasar a ENVIADO, no al crear el borrador, para que los
 *     borradores descartados no dejen huecos.
 *  3. El costo del momento se guarda junto al precio, para poder saber despues que
 *     margen REAL tuvo cada trabajo.
 */

export interface ItemEntrada {
  productoId?: string | undefined;
  descripcion?: string | undefined;
  cantidad: number;
  /** Si no viene, se toma el precio de venta que calcula el motor para ese producto. */
  precioUnitario?: number | undefined;
}

export interface DatosPresupuesto {
  clienteId?: string | undefined;
  /** Cliente escrito a mano, para no obligar a darlo de alta antes de cotizar. */
  clienteManual?:
    | {
        nombreRazonSocial: string;
        cuitDni?: string | undefined;
        direccion?: string | undefined;
        localidad?: string | undefined;
        telefono?: string | undefined;
        email?: string | undefined;
      }
    | undefined;
  items: ItemEntrada[];
  fecha?: Date | undefined;
  validezDias?: number | undefined;
  porcentajeSenia?: number | undefined;
  condicionesGenerales?: string | undefined;
  notasInternas?: string | undefined;
  /** Descuento manual. Si no viene, se aplica el automatico por tramos. */
  descuento?: { tipo: TipoDescuento; valor: number } | undefined;
  /** Poner en true para no aplicar ningun descuento aunque los tramos den. */
  sinDescuento?: boolean | undefined;
}

/* ------------------------------------------------------------------ */
/* Armado                                                              */
/* ------------------------------------------------------------------ */

/**
 * Resuelve items, descuento y totales. Se usa al crear y al editar un BORRADOR.
 *
 * Cada item se costea contra los precios de HOY: mientras es borrador, el
 * presupuesto sigue vivo. El congelamiento ocurre recien al emitir.
 */
async function armar(datos: DatosPresupuesto, organizacionId: string) {
  if (datos.items.length === 0) {
    throw solicitudInvalida('El presupuesto tiene que tener al menos un item.');
  }

  const config = await obtenerConfiguracion(organizacionId);
  const cliente = await resolverCliente(datos, organizacionId);

  const items = [];
  const tramosPorProducto = new Map<string, readonly TramoDescuento[]>();

  for (const entrada of datos.items) {
    if (entrada.productoId) {
      const { producto, costeo } = await costearProducto(entrada.productoId, {}, organizacionId);
      // Precio de venta final: ya trae aplicada la comision del canal si el
      // producto la tiene configurada.
      const precioUnitario = entrada.precioUnitario ?? aCentavos(costeo.precioVentaFinal);
      tramosPorProducto.set(producto.id, producto.tramosDescuento);
      items.push({
        producto: new Types.ObjectId(producto.id),
        descripcion: entrada.descripcion?.trim() || producto.nombre,
        cantidad: entrada.cantidad,
        precioUnitario,
        subtotal: calcularSubtotalItem(precioUnitario as never, entrada.cantidad),
        costoUnitarioAlMomento: aCentavos(costeo.costoTotalUnitario),
        costeoAlMomento: congelarCosteo(costeo),
        costeoIncompleto: !costeo.completo,
      });
    } else {
      // Item libre: un trabajo que no esta modelado como producto. No tiene costeo,
      // asi que su margen real queda desconocido y se marca como incompleto.
      if (!entrada.descripcion?.trim()) {
        throw solicitudInvalida('Un item sin producto necesita una descripcion.');
      }
      if (entrada.precioUnitario == null) {
        throw solicitudInvalida(
          `El item "${entrada.descripcion}" no tiene producto, asi que necesita un precio unitario.`,
        );
      }
      items.push({
        producto: null,
        descripcion: entrada.descripcion.trim(),
        cantidad: entrada.cantidad,
        precioUnitario: entrada.precioUnitario,
        subtotal: calcularSubtotalItem(entrada.precioUnitario as never, entrada.cantidad),
        costoUnitarioAlMomento: 0,
        costeoIncompleto: true,
      });
    }
  }

  // Descuento: manual si lo mandaron, si no el automatico por tramos, que igual
  // queda editable a mano en el borrador.
  let descuentoPedido: { tipo: TipoDescuento; valor: number; automatico: boolean } | null = null;
  if (datos.sinDescuento) {
    descuentoPedido = null;
  } else if (datos.descuento) {
    descuentoPedido = { ...datos.descuento, automatico: false };
  } else {
    const auto = calcularDescuentoAutomatico(
      items.map((i) => ({
        cantidad: i.cantidad,
        subtotal: i.subtotal,
        productoId: i.producto ? String(i.producto) : null,
      })),
      tramosPorProducto,
      config.presupuestos.tramosDescuentoPorDefecto,
    );
    if (auto) descuentoPedido = { tipo: auto.tipo, valor: auto.valor, automatico: true };
  }

  const totales = calcularTotales(
    items,
    descuentoPedido,
    config.empresa.condicionIva as CondicionIva,
    datos.porcentajeSenia ?? config.presupuestos.porcentajeSeniaPorDefecto,
  );

  return {
    fecha: datos.fecha ?? new Date(),
    validezDias: datos.validezDias ?? config.presupuestos.validezDiasPorDefecto,
    cliente,
    items,
    ...totales,
    condicionesGenerales:
      datos.condicionesGenerales ?? config.presupuestos.condicionesGeneralesPorDefecto,
    ...(datos.notasInternas === undefined ? {} : { notasInternas: datos.notasInternas }),
  };
}

/**
 * El cliente se COPIA al presupuesto, no se referencia. Si despues se muda o cambia
 * de razon social, el presupuesto emitido tiene que seguir diciendo lo que decia.
 */
async function resolverCliente(datos: DatosPresupuesto, organizacionId: string) {
  if (datos.clienteId) {
    const c = await ClienteModel.findOne({ _id: datos.clienteId, organizacionId });
    if (!c) throw noEncontrado('el cliente');
    return {
      clienteId: c._id,
      nombreRazonSocial: c.nombreRazonSocial,
      cuitDni: c.cuitDni,
      direccion: c.direccion,
      localidad: c.localidad,
      telefono: c.telefono,
      email: c.email,
      activo: c.activo,
    };
  }
  if (datos.clienteManual?.nombreRazonSocial) {
    return { clienteId: null, ...datos.clienteManual, activo: true };
  }
  throw solicitudInvalida('Falta el cliente: elegi uno de la lista o cargalo a mano.');
}

/* ------------------------------------------------------------------ */
/* Operaciones                                                         */
/* ------------------------------------------------------------------ */

export async function crearBorrador(
  datos: DatosPresupuesto,
  organizacionId = ORG_UNICA,
): Promise<PresupuestoDoc> {
  const armado = await armar(datos, organizacionId);
  // Sin numero: se asigna recien al emitir.
  return PresupuestoModel.create({
    organizacionId,
    numero: null,
    estado: EstadoPresupuesto.BORRADOR,
    ...armado,
  });
}

export async function actualizarBorrador(
  id: string,
  datos: DatosPresupuesto,
  organizacionId = ORG_UNICA,
): Promise<PresupuestoDoc> {
  const doc = await buscar(id, organizacionId);
  if (doc.estado !== EstadoPresupuesto.BORRADOR) {
    throw conflicto(
      `El presupuesto ${doc.numero ?? ''} ya fue emitido y no se modifica. ` +
        'Usa "duplicar con precios actuales" para generar uno nuevo.',
    );
  }
  const armado = await armar(datos, organizacionId);
  doc.set(armado);
  await doc.save();
  return doc;
}

/**
 * BORRADOR -> ENVIADO. Es el momento en que el presupuesto deja de ser un calculo
 * y pasa a ser un documento: toma numero, se le sella la fecha de envio y a partir
 * de ahi sus numeros no se tocan mas.
 */
export async function emitir(id: string, organizacionId = ORG_UNICA): Promise<PresupuestoDoc> {
  const doc = await buscar(id, organizacionId);
  if (doc.estado !== EstadoPresupuesto.BORRADOR) {
    throw conflicto(`El presupuesto ${doc.numero ?? ''} ya fue emitido.`);
  }
  if (doc.items.length === 0) {
    throw conflicto('No se puede emitir un presupuesto sin items.');
  }

  doc.numero = await tomarNumeroPresupuesto(organizacionId);
  doc.estado = EstadoPresupuesto.ENVIADO;
  doc.fechaEnvio = new Date();
  await doc.save();
  return doc;
}

export async function cambiarEstado(
  id: string,
  nuevo: EstadoPresupuesto,
  organizacionId = ORG_UNICA,
): Promise<PresupuestoDoc> {
  const doc = await buscar(id, organizacionId);

  // Se valida contra el estado EFECTIVO: un presupuesto vencido igual se puede
  // aceptar si el cliente aparece tarde, pero no se puede volver a "enviar".
  const actual = resolverEstadoEfectivo(doc.estado as EstadoPresupuesto, doc.validoHasta);
  if (nuevo === EstadoPresupuesto.ENVIADO) {
    throw solicitudInvalida('Para pasar a ENVIADO usa la accion de emitir, que asigna el numero.');
  }
  if (!puedeTransicionar(actual, nuevo)) {
    throw conflicto(`Un presupuesto ${actual} no puede pasar a ${nuevo}.`);
  }
  doc.estado = nuevo;
  await doc.save();
  return doc;
}

/**
 * Duplicar con precios actuales.
 *
 * Es la unica forma de "actualizar" un presupuesto viejo: se genera uno nuevo,
 * en BORRADOR y sin numero, recosteado contra los precios de hoy. El original queda
 * intacto, que es justamente el punto.
 */
export async function duplicar(id: string, organizacionId = ORG_UNICA): Promise<PresupuestoDoc> {
  const original = await buscar(id, organizacionId);

  const items: ItemEntrada[] = original.items.map((i) => ({
    productoId: i.producto ? String(i.producto) : undefined,
    descripcion: i.descripcion,
    cantidad: i.cantidad,
    // Los items con producto se recotizan; los libres conservan su precio, porque
    // no hay de donde recalcularlo.
    precioUnitario: i.producto ? undefined : i.precioUnitario,
  }));

  const nuevo = await crearBorrador(
    {
      ...(original.cliente.clienteId
        ? { clienteId: String(original.cliente.clienteId) }
        : { clienteManual: { nombreRazonSocial: original.cliente.nombreRazonSocial } }),
      items,
      validezDias: original.validezDias,
      porcentajeSenia: original.porcentajeSenia,
      condicionesGenerales: original.condicionesGenerales,
    },
    organizacionId,
  );

  nuevo.duplicadoDe = original._id;
  await nuevo.save();
  return nuevo;
}

export async function eliminarBorrador(id: string, organizacionId = ORG_UNICA): Promise<void> {
  const doc = await buscar(id, organizacionId);
  if (doc.estado !== EstadoPresupuesto.BORRADOR) {
    throw conflicto(
      `El presupuesto ${doc.numero} ya fue emitido: forma parte del historial y no se borra. ` +
        'Si el cliente no lo tomo, marcalo como RECHAZADO.',
    );
  }
  await doc.deleteOne();
}

export async function buscar(id: string, organizacionId = ORG_UNICA): Promise<PresupuestoDoc> {
  const doc = await PresupuestoModel.findOne({ _id: id, organizacionId });
  if (!doc) throw noEncontrado('el presupuesto');
  return doc;
}
