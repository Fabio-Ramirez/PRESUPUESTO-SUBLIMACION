import type { Types } from 'mongoose';
import {
  diasEntre,
  precioEstaDesactualizado,
  resolverEstadoEfectivo,
  type Cliente,
  type Configuracion,
  type Equipo,
  type EstadoPresupuesto,
  type Insumo,
  type InsumoConPrecio,
  type PrecioInsumo,
  type Presupuesto,
  type Producto,
} from '@calc/shared';
import type {
  ClienteDoc,
  ConfiguracionDoc,
  EquipoDoc,
  InsumoDoc,
  PrecioInsumoDoc,
  PresupuestoDoc,
  ProductoDoc,
} from '../models/index.js';

/**
 * Mappers documento -> contrato de /shared.
 *
 * Existen para que el front nunca vea un ObjectId, un Date ni un `_id`. Todo lo que
 * sale de la API tiene exactamente la forma que declaran las interfaces de /shared,
 * asi que el front las puede importar y confiar en ellas.
 */

const id = (v: unknown): string => String(v);
const idOpcional = (v: unknown): string | null => (v == null ? null : String(v));
const iso = (d: Date | undefined | null): string => (d ?? new Date()).toISOString();

interface Base {
  _id: Types.ObjectId;
  organizacionId: string;
  creadoEn?: Date;
  actualizadoEn?: Date;
}

function base(d: Base) {
  return {
    id: id(d._id),
    organizacionId: d.organizacionId,
    creadoEn: iso(d.creadoEn),
    actualizadoEn: iso(d.actualizadoEn),
  };
}

/* ------------------------------------------------------------------ */

export function aInsumo(d: InsumoDoc): Insumo {
  return {
    ...base(d as unknown as Base),
    nombre: d.nombre,
    tipo: d.tipo,
    unidadUso: d.unidadUso,
    activo: d.activo,
    ...(d.notas ? { notas: d.notas } : {}),
  };
}

export function aPrecioInsumo(d: PrecioInsumoDoc): PrecioInsumo {
  return {
    ...base(d as unknown as Base),
    insumoId: id(d.insumo),
    fecha: iso(d.fecha),
    presentacion: { cantidad: d.presentacion.cantidad, unidad: d.presentacion.unidad },
    precioPresentacion: d.precioPresentacion as never,
    precioPorUnidadUso: d.precioPorUnidadUso as never,
    ...(d.proveedor ? { proveedor: d.proveedor } : {}),
  };
}

/**
 * Insumo + precio vigente + la senal de "este precio ya tiene mas de 30 dias".
 * El aviso se calcula aca, del lado del servidor, para que el listado y la
 * calculadora usen el mismo criterio.
 */
export function aInsumoConPrecio(
  d: InsumoDoc,
  precio: PrecioInsumoDoc | undefined,
  ahora = new Date(),
): InsumoConPrecio {
  const dias = precio ? diasEntre(precio.fecha, ahora) : null;
  return {
    ...aInsumo(d),
    precioVigente: precio ? aPrecioInsumo(precio) : null,
    diasDesdeUltimoPrecio: dias,
    precioDesactualizado: precio ? precioEstaDesactualizado(precio.fecha, ahora) : true,
  };
}

export function aEquipo(d: EquipoDoc): Equipo {
  return {
    ...base(d as unknown as Base),
    nombre: d.nombre,
    costoAdquisicion: d.costoAdquisicion as never,
    vidaUtilUnidades: d.vidaUtilUnidades,
    fechaCompra: iso(d.fechaCompra),
    consumoWatts: d.consumoWatts,
    amortizacionPorUnidad: d.amortizacionPorUnidad as never,
    activo: d.activo,
  };
}

export function aProducto(d: ProductoDoc): Producto {
  return {
    ...base(d as unknown as Base),
    nombre: d.nombre,
    categoria: d.categoria,
    insumos: d.insumos.map((r) => ({ insumoId: id(r.insumo), cantidad: r.cantidad })),
    equipos: d.equipos.map((r) => ({
      equipoId: id(r.equipo),
      unidadesConsumidas: r.unidadesConsumidas,
      minutosUso: r.minutosUso,
    })),
    minutosManoObra: d.minutosManoObra,
    otrosGastos: d.otrosGastos as never,
    porcentajeMerma: d.porcentajeMerma,
    margen: d.margen,
    comisionPlataforma: d.comisionPlataforma,
    tramosDescuento: d.tramosDescuento.map((t) => ({
      desdeCantidad: t.desdeCantidad,
      porcentaje: t.porcentaje,
    })),
    activo: d.activo,
  };
}

export function aCliente(d: ClienteDoc): Cliente {
  return {
    ...base(d as unknown as Base),
    nombreRazonSocial: d.nombreRazonSocial,
    ...(d.cuitDni ? { cuitDni: d.cuitDni } : {}),
    ...(d.direccion ? { direccion: d.direccion } : {}),
    ...(d.localidad ? { localidad: d.localidad } : {}),
    ...(d.telefono ? { telefono: d.telefono } : {}),
    ...(d.email ? { email: d.email } : {}),
    activo: d.activo,
  };
}

export function aConfiguracion(d: ConfiguracionDoc): Configuracion {
  return {
    ...base(d as unknown as Base),
    empresa: {
      nombre: d.empresa.nombre ?? '',
      cuit: d.empresa.cuit ?? '',
      direccion: d.empresa.direccion ?? '',
      whatsapp: d.empresa.whatsapp ?? '',
      email: d.empresa.email ?? '',
      ...(d.empresa.logo ? { logo: d.empresa.logo } : {}),
      condicionIva: d.empresa.condicionIva,
    },
    costos: {
      valorHoraManoObra: d.costos.valorHoraManoObra as never,
      costoKwh: d.costos.costoKwh as never,
    },
    presupuestos: {
      condicionesGeneralesPorDefecto: d.presupuestos.condicionesGeneralesPorDefecto ?? '',
      validezDiasPorDefecto: d.presupuestos.validezDiasPorDefecto,
      porcentajeSeniaPorDefecto: d.presupuestos.porcentajeSeniaPorDefecto,
      tramosDescuentoPorDefecto: d.presupuestos.tramosDescuentoPorDefecto.map((t) => ({
        desdeCantidad: t.desdeCantidad,
        porcentaje: t.porcentaje,
      })),
      puntoVenta: d.presupuestos.puntoVenta,
      proximoNumeroPresupuesto: d.presupuestos.proximoNumeroPresupuesto,
    },
  };
}

export function aPresupuesto(d: PresupuestoDoc, ahora = new Date()): Presupuesto {
  const estado = d.estado as EstadoPresupuesto;
  return {
    ...base(d as unknown as Base),
    numero: d.numero ?? null,
    fecha: iso(d.fecha),
    validezDias: d.validezDias,
    validoHasta: iso(d.validoHasta),
    cliente: {
      clienteId: idOpcional(d.cliente.clienteId),
      nombreRazonSocial: d.cliente.nombreRazonSocial,
      ...(d.cliente.cuitDni ? { cuitDni: d.cliente.cuitDni } : {}),
      ...(d.cliente.direccion ? { direccion: d.cliente.direccion } : {}),
      ...(d.cliente.localidad ? { localidad: d.cliente.localidad } : {}),
      ...(d.cliente.telefono ? { telefono: d.cliente.telefono } : {}),
      ...(d.cliente.email ? { email: d.cliente.email } : {}),
      activo: d.cliente.activo ?? true,
    },
    items: d.items.map((i) => ({
      productoId: idOpcional(i.producto),
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario as never,
      subtotal: i.subtotal as never,
      costoUnitarioAlMomento: i.costoUnitarioAlMomento as never,
      ...(i.costeoAlMomento ? { costeoAlMomento: i.costeoAlMomento as never } : {}),
      costeoIncompleto: i.costeoIncompleto,
    })),
    subtotal: d.subtotal as never,
    descuento: d.descuento
      ? {
          tipo: d.descuento.tipo,
          valor: d.descuento.valor,
          monto: d.descuento.monto as never,
          automatico: d.descuento.automatico,
        }
      : null,
    neto: d.neto as never,
    iva: { condicion: d.iva.condicion, alicuota: d.iva.alicuota, monto: d.iva.monto as never },
    total: d.total as never,
    porcentajeSenia: d.porcentajeSenia,
    montoSenia: d.montoSenia as never,
    saldoContraEntrega: d.saldoContraEntrega as never,
    condicionesGenerales: d.condicionesGenerales ?? '',
    estado,
    // Derivado, no persistido: un listado no debe disparar escrituras.
    estadoEfectivo: resolverEstadoEfectivo(estado, d.validoHasta, ahora),
    ...(d.notasInternas ? { notasInternas: d.notasInternas } : {}),
    ...(d.fechaEnvio ? { fechaEnvio: iso(d.fechaEnvio) } : {}),
    ...(d.duplicadoDe ? { duplicadoDeId: id(d.duplicadoDe) } : {}),
  };
}
