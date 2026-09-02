import { Types } from 'mongoose';
import {
  ORG_UNICA,
  armarEntradaCosteo,
  calcularCosteo,
  type OverridesCosteo,
  type Producto,
  type ResultadoCosteo,
} from '@calc/shared';
import { EquipoModel, InsumoModel, ProductoModel, preciosVigentes } from '../models/index.js';
import { obtenerConfiguracion } from '../models/configuracion.js';
import { aEquipo, aInsumoConPrecio, aProducto } from '../dto/mapear.js';
import { noEncontrado } from '../http/errores.js';

/**
 * Orquesta el costeo: junta las piezas de la base y llama al motor de /shared.
 *
 * El calculo en si NO esta aca. Esta en /shared porque el front lo corre con cada
 * tecla de la calculadora y la API lo corre al emitir; si estuviera duplicado, el
 * presupuesto emitido terminaria diciendo algo distinto de lo que el usuario vio.
 */

/** La receta sin producto guardado: es lo que manda la calculadora en vivo. */
export interface RecetaAdHoc {
  insumos: Array<{ insumoId: string; cantidad: number }>;
  equipos: Array<{ equipoId: string; unidadesConsumidas: number; minutosUso: number }>;
  minutosManoObra: number;
  otrosGastos: number;
  porcentajeMerma: number;
  margen: number;
  comisionPlataforma: number;
}

export async function costearReceta(
  receta: RecetaAdHoc,
  organizacionId = ORG_UNICA,
): Promise<ResultadoCosteo> {
  const entrada = await cargarEntrada(receta, organizacionId);
  return calcularCosteo(entrada);
}

export async function costearProducto(
  productoId: string,
  overrides: OverridesCosteo = {},
  organizacionId = ORG_UNICA,
): Promise<{ producto: Producto; costeo: ResultadoCosteo }> {
  const doc = await ProductoModel.findOne({ _id: productoId, organizacionId });
  if (!doc) throw noEncontrado('el producto');

  const receta: RecetaAdHoc = {
    insumos: doc.insumos.map((r) => ({ insumoId: String(r.insumo), cantidad: r.cantidad })),
    equipos: doc.equipos.map((r) => ({
      equipoId: String(r.equipo),
      unidadesConsumidas: r.unidadesConsumidas,
      minutosUso: r.minutosUso,
    })),
    minutosManoObra: overrides.minutosManoObra ?? doc.minutosManoObra,
    otrosGastos: overrides.otrosGastos ?? doc.otrosGastos,
    porcentajeMerma: overrides.porcentajeMerma ?? doc.porcentajeMerma,
    margen: overrides.margen ?? doc.margen,
    // La comision pertenece al canal de venta, no al producto: el valor del
    // producto es solo el arranque y la calculadora lo pisa sin duplicar nada.
    comisionPlataforma: overrides.comisionPlataforma ?? doc.comisionPlataforma,
  };

  const entrada = await cargarEntrada(receta, organizacionId);
  return { producto: aProducto(doc), costeo: calcularCosteo(entrada) };
}

/**
 * Carga insumos, precios vigentes, equipos y configuracion en 4 consultas fijas,
 * sin importar cuantos insumos tenga la receta. Esto corre en cada tecla de la
 * calculadora, asi que un N+1 aca se siente enseguida.
 */
async function cargarEntrada(receta: RecetaAdHoc, organizacionId: string) {
  const insumoIds = receta.insumos.map((r) => new Types.ObjectId(r.insumoId));
  const equipoIds = receta.equipos.map((r) => new Types.ObjectId(r.equipoId));

  const [insumosDocs, equiposDocs, precios, config] = await Promise.all([
    InsumoModel.find({ _id: { $in: insumoIds }, organizacionId }),
    EquipoModel.find({ _id: { $in: equipoIds }, organizacionId }),
    preciosVigentes(organizacionId, insumoIds),
    obtenerConfiguracion(organizacionId),
  ]);

  const insumos = insumosDocs.map((d) => aInsumoConPrecio(d, precios.get(String(d._id))));
  const equipos = equiposDocs.map(aEquipo);

  return armarEntradaCosteo(
    {
      insumos: receta.insumos.map((r) => ({ insumoId: r.insumoId, cantidad: r.cantidad })),
      equipos: receta.equipos.map((r) => ({
        equipoId: r.equipoId,
        unidadesConsumidas: r.unidadesConsumidas,
        minutosUso: r.minutosUso,
      })),
      minutosManoObra: receta.minutosManoObra,
      otrosGastos: receta.otrosGastos as never,
      porcentajeMerma: receta.porcentajeMerma,
      margen: receta.margen,
      comisionPlataforma: receta.comisionPlataforma,
    },
    insumos,
    equipos,
    { valorHoraManoObra: config.costos.valorHoraManoObra as never, costoKwh: config.costos.costoKwh as never },
  );
}
