import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from 'mongoose';
import { TipoInsumo, TipoMovimientoStock, UnidadUso, calcularPrecioPorUnidadUso } from '@calc/shared';
import { campoMonto, campoOrganizacion, opcionesBase } from './comun.js';

/* ================================================================== */
/* Insumo — QUE es, nunca cuanto sale                                  */
/* ================================================================== */

const esquemaInsumo = new Schema(
  {
    organizacionId: campoOrganizacion(),
    nombre: { type: String, required: true, trim: true },
    tipo: { type: String, required: true, enum: Object.values(TipoInsumo) },
    /** La unidad en la que se CONSUME (hoja, ml), que no siempre es en la que se compra. */
    unidadUso: { type: String, required: true, enum: Object.values(UnidadUso) },
    activo: { type: Boolean, required: true, default: true },
    notas: { type: String, trim: true },
    /**
     * Minimo para el aviso de stock bajo, en unidades de `unidadUso`. Sin
     * cargar (undefined, equivalente a 0) el insumo nunca se marca en stock
     * bajo — ver stockEstaBajo() en /shared.
     */
    stockMinimo: { type: Number, min: [0, 'El minimo de stock no puede ser negativo.'] },
  },
  opcionesBase,
);

// Dos insumos con el mismo nombre en el mismo negocio son siempre un error de carga.
esquemaInsumo.index({ organizacionId: 1, nombre: 1 }, { unique: true });
esquemaInsumo.index({ organizacionId: 1, activo: 1, tipo: 1 });

export type InsumoDoc = HydratedDocument<InferSchemaType<typeof esquemaInsumo>>;
export const InsumoModel = model('Insumo', esquemaInsumo);

/* ================================================================== */
/* PrecioInsumo — el historico                                         */
/* ================================================================== */

const esquemaPresentacion = new Schema(
  {
    /** Ej: 500 (hojas por resma), 100 (ml por botella), 1 (unidad suelta). */
    cantidad: { type: Number, required: true, min: [1e-9, 'La presentacion tiene que ser mayor a cero.'] },
    unidad: { type: String, required: true, enum: Object.values(UnidadUso) },
  },
  { _id: false },
);

const esquemaPrecioInsumo = new Schema(
  {
    organizacionId: campoOrganizacion(),
    insumo: { type: Schema.Types.ObjectId, ref: 'Insumo', required: true },
    fecha: { type: Date, required: true, default: () => new Date() },
    presentacion: { type: esquemaPresentacion, required: true },
    /** Lo que se pago por la presentacion completa. */
    precioPresentacion: campoMonto('centavos'),
    /**
     * Derivado en el hook de abajo. Va en MILICENTAVOS: es un cociente
     * (precio / cantidad de la presentacion) y redondearlo a centavos corre el
     * costo unitario. Ver dinero.ts en /shared.
     */
    precioPorUnidadUso: campoMonto('milicentavos'),
    proveedor: { type: String, trim: true },
  },
  opcionesBase,
);

/**
 * El precio vigente es el de fecha mas reciente. Este indice es el que sostiene
 * esa consulta y se usa en cada costeo, asi que no es opcional.
 */
export type PrecioInsumoDoc = HydratedDocument<InferSchemaType<typeof esquemaPrecioInsumo>>;

esquemaPrecioInsumo.index({ organizacionId: 1, insumo: 1, fecha: -1 });

esquemaPrecioInsumo.pre('validate', function (this: PrecioInsumoDoc) {
  if (this.precioPresentacion != null && this.presentacion?.cantidad) {
    this.precioPorUnidadUso = calcularPrecioPorUnidadUso(
      this.precioPresentacion as never,
      { cantidad: this.presentacion.cantidad, unidad: this.presentacion.unidad },
    );
  }
});

/**
 * INMUTABILIDAD. Un precio no se corrige: se agrega uno nuevo. Si se pudiera editar,
 * un presupuesto emitido hace dos meses cambiaria de contenido en silencio, que es
 * exactamente el problema que tenia la planilla.
 *
 * El bloqueo esta en el modelo y no solo en el service porque un update suelto desde
 * un script o una consola tiene que fallar igual.
 */
const ERROR_INMUTABLE = new Error(
  'Un precio historico no se modifica ni se borra: carga un precio nuevo con la fecha de hoy.',
);

esquemaPrecioInsumo.pre('save', function (this: PrecioInsumoDoc, next) {
  if (!this.isNew) return next(ERROR_INMUTABLE);
  next();
});

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  esquemaPrecioInsumo.pre(op, function (next: (e?: Error) => void) {
    next(ERROR_INMUTABLE);
  });
}

export const PrecioInsumoModel = model('PrecioInsumo', esquemaPrecioInsumo);

/* ------------------------------------------------------------------ */

/**
 * Precio vigente de varios insumos en UNA consulta.
 *
 * Es la operacion mas caliente del sistema: la ejecuta cada tecla de la calculadora.
 * Hecha con $sort + $group en vez de un find por insumo, para que costear un producto
 * de 8 insumos sea 1 round-trip y no 8.
 */
export async function preciosVigentes(
  organizacionId: string,
  insumoIds: readonly Types.ObjectId[],
): Promise<Map<string, PrecioInsumoDoc>> {
  const docs = await PrecioInsumoModel.aggregate<{ _id: Types.ObjectId; doc: unknown }>([
    { $match: { organizacionId, insumo: { $in: [...insumoIds] } } },
    { $sort: { fecha: -1, _id: -1 } },
    { $group: { _id: '$insumo', doc: { $first: '$$ROOT' } } },
  ]);
  const mapa = new Map<string, PrecioInsumoDoc>();
  for (const d of docs) {
    mapa.set(String(d._id), PrecioInsumoModel.hydrate(d.doc));
  }
  return mapa;
}

/* ================================================================== */
/* MovimientoStock — el historico de entradas y salidas                */
/* ================================================================== */

/**
 * Historico igual que PrecioInsumo: nunca se edita ni se borra, se agrega uno
 * nuevo. Es lo que permite que "cuanto stock hay" (la suma de estos registros)
 * siempre coincida con "por que llego a ese numero" — una carga que se pudiera
 * corregir en silencio rompe esa garantia.
 */
const esquemaMovimientoStock = new Schema(
  {
    organizacionId: campoOrganizacion(),
    insumo: { type: Schema.Types.ObjectId, ref: 'Insumo', required: true },
    fecha: { type: Date, required: true, default: () => new Date() },
    tipo: { type: String, required: true, enum: Object.values(TipoMovimientoStock) },
    /** Siempre positivo: el signo con el que afecta el stock lo da `tipo`. */
    cantidad: { type: Number, required: true, min: [1e-9, 'La cantidad tiene que ser mayor a cero.'] },
    motivo: { type: String, trim: true },
  },
  opcionesBase,
);

esquemaMovimientoStock.index({ organizacionId: 1, insumo: 1, fecha: -1 });

export type MovimientoStockDoc = HydratedDocument<InferSchemaType<typeof esquemaMovimientoStock>>;

const ERROR_MOVIMIENTO_INMUTABLE = new Error(
  'Un movimiento de stock no se modifica ni se borra: cargá un movimiento nuevo para corregirlo.',
);

esquemaMovimientoStock.pre('save', function (this: MovimientoStockDoc, next) {
  if (!this.isNew) return next(ERROR_MOVIMIENTO_INMUTABLE);
  next();
});

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  esquemaMovimientoStock.pre(op, function (next: (e?: Error) => void) {
    next(ERROR_MOVIMIENTO_INMUTABLE);
  });
}

export const MovimientoStockModel = model('MovimientoStock', esquemaMovimientoStock);

/**
 * Stock actual de varios insumos en UNA consulta: suma de ENTRADA menos suma
 * de SALIDA. Mismo motivo que preciosVigentes() — el listado de insumos no
 * puede costar una consulta por insumo.
 *
 * Puede dar negativo (se cargo de menos, o se perdio/rompio mas de lo
 * registrado): no se corrige solo, es una senal real de que el historico no
 * refleja lo fisico y conviene cargar un ajuste.
 */
export async function stockActualPorInsumo(
  organizacionId: string,
  insumoIds: readonly Types.ObjectId[],
): Promise<Map<string, number>> {
  const docs = await MovimientoStockModel.aggregate<{ _id: Types.ObjectId; stock: number }>([
    { $match: { organizacionId, insumo: { $in: [...insumoIds] } } },
    {
      $group: {
        _id: '$insumo',
        stock: {
          $sum: {
            $cond: [{ $eq: ['$tipo', TipoMovimientoStock.ENTRADA] }, '$cantidad', { $multiply: ['$cantidad', -1] }],
          },
        },
      },
    },
  ]);
  return new Map(docs.map((d) => [String(d._id), d.stock]));
}
