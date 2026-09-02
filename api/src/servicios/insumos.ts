import { Types } from 'mongoose';
import { ORG_UNICA, type InsumoConPrecio, type PrecioInsumo, type UnidadUso } from '@calc/shared';
import { InsumoModel, PrecioInsumoModel, preciosVigentes } from '../models/index.js';
import { aInsumoConPrecio, aPrecioInsumo } from '../dto/mapear.js';
import { noEncontrado, solicitudInvalida } from '../http/errores.js';

export interface FiltroInsumos {
  soloActivos?: boolean | undefined;
  tipo?: string | undefined;
  /** Solo los que tienen el precio vencido (mas de 30 dias) o nunca lo tuvieron. */
  soloDesactualizados?: boolean | undefined;
  busqueda?: string | undefined;
}

/**
 * Listado con precio vigente, fecha de ese precio y el aviso de "mas de 30 dias".
 *
 * Dos consultas para N insumos, no N+1: el listado y la calculadora piden esto
 * seguido y la agregacion de precios vigentes ya resuelve todos de una.
 */
export async function listarConPrecios(
  filtro: FiltroInsumos = {},
  organizacionId = ORG_UNICA,
): Promise<InsumoConPrecio[]> {
  const where: Record<string, unknown> = { organizacionId };
  if (filtro.soloActivos !== false) where['activo'] = true;
  if (filtro.tipo) where['tipo'] = filtro.tipo;
  if (filtro.busqueda) where['nombre'] = { $regex: escaparRegex(filtro.busqueda), $options: 'i' };

  const docs = await InsumoModel.find(where).sort({ tipo: 1, nombre: 1 });
  const precios = await preciosVigentes(
    organizacionId,
    docs.map((d) => d._id),
  );

  const ahora = new Date();
  const lista = docs.map((d) => aInsumoConPrecio(d, precios.get(String(d._id)), ahora));
  return filtro.soloDesactualizados ? lista.filter((i) => i.precioDesactualizado) : lista;
}

export interface DatosPrecio {
  presentacion: { cantidad: number; unidad: UnidadUso };
  precioPresentacion: number;
  proveedor?: string | undefined;
  fecha?: Date | undefined;
}

/**
 * Carga un precio nuevo. Nunca pisa el anterior: el historico es lo que permite que
 * un presupuesto de hace dos meses siga diciendo lo que decia.
 */
export async function registrarPrecio(
  insumoId: string,
  datos: DatosPrecio,
  organizacionId = ORG_UNICA,
): Promise<PrecioInsumo> {
  const insumo = await InsumoModel.findOne({ _id: insumoId, organizacionId });
  if (!insumo) throw noEncontrado('el insumo');

  const doc = await PrecioInsumoModel.create({
    organizacionId,
    insumo: insumo._id,
    fecha: datos.fecha ?? new Date(),
    presentacion: datos.presentacion,
    precioPresentacion: datos.precioPresentacion,
    ...(datos.proveedor ? { proveedor: datos.proveedor } : {}),
  });
  return aPrecioInsumo(doc);
}

export interface LineaLote extends DatosPrecio {
  insumoId: string;
}

export interface ResultadoLote {
  cargados: number;
  precios: PrecioInsumo[];
}

/**
 * Carga una lista completa del proveedor de una sola vez.
 *
 * Es la operacion que decide si la herramienta se usa o se abandona: actualizar
 * treinta insumos de a uno no lo hace nadie.
 *
 * Se valida TODO antes de escribir nada. Sin transacciones (Mongo standalone) no
 * hay rollback, asi que la unica forma de no dejar media lista cargada es que
 * ningun documento pueda fallar por validacion en el momento de insertar.
 */
export async function registrarPreciosEnLote(
  lineas: readonly LineaLote[],
  organizacionId = ORG_UNICA,
): Promise<ResultadoLote> {
  if (lineas.length === 0) throw solicitudInvalida('La lista de precios vino vacia.');

  const ids = [...new Set(lineas.map((l) => l.insumoId))];
  const insumos = await InsumoModel.find({
    _id: { $in: ids.map((i) => new Types.ObjectId(i)) },
    organizacionId,
  });
  const existentes = new Set(insumos.map((i) => String(i._id)));

  const faltantes = ids.filter((i) => !existentes.has(i));
  if (faltantes.length > 0) {
    throw solicitudInvalida(
      `Hay ${faltantes.length} insumo(s) de la lista que no existen. No se cargo ningun precio.`,
      { insumoIds: faltantes },
    );
  }

  const fecha = new Date();
  const docs = lineas.map(
    (l) =>
      new PrecioInsumoModel({
        organizacionId,
        insumo: new Types.ObjectId(l.insumoId),
        fecha: l.fecha ?? fecha,
        presentacion: l.presentacion,
        precioPresentacion: l.precioPresentacion,
        ...(l.proveedor ? { proveedor: l.proveedor } : {}),
      }),
  );

  // Paso 1: validar todo (esto tambien dispara el hook que deriva
  // precioPorUnidadUso). Si algo falla, no se escribio nada todavia.
  await Promise.all(docs.map((d) => d.validate()));

  // Paso 2: una sola escritura.
  await PrecioInsumoModel.insertMany(docs);

  return { cargados: docs.length, precios: docs.map(aPrecioInsumo) };
}

/** Historico completo de un insumo, del mas nuevo al mas viejo. */
export async function historialPrecios(
  insumoId: string,
  organizacionId = ORG_UNICA,
): Promise<PrecioInsumo[]> {
  const docs = await PrecioInsumoModel.find({ insumo: insumoId, organizacionId }).sort({
    fecha: -1,
    _id: -1,
  });
  return docs.map(aPrecioInsumo);
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
