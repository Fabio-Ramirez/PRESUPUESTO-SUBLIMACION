import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { DEFAULTS } from '@calc/shared';
import {
  campoMonto,
  campoOrganizacion,
  campoPorcentaje,
  esquemaTramoDescuento,
  opcionesBase,
} from './comun.js';

/** Cuanto de cada insumo lleva UNA unidad del producto. */
const esquemaRecetaInsumo = new Schema(
  {
    insumo: { type: Schema.Types.ObjectId, ref: 'Insumo', required: true },
    /** Fraccionaria a proposito: media hoja, 1,8 ml de tinta. */
    cantidad: { type: Number, required: true, min: [0, 'La cantidad no puede ser negativa.'] },
  },
  { _id: false },
);

/**
 * Reemplaza al `minutosEquipo` unico del modelo original, que no alcanzaba: la
 * impresora corre 2 minutos a 30 W y la plancha 5 a 1400 W, y con un solo numero
 * la energia no se puede repartir.
 */
const esquemaRecetaEquipo = new Schema(
  {
    equipo: { type: Schema.Types.ObjectId, ref: 'Equipo', required: true },
    /** Piezas de vida util que consume: normalmente 1, mas si lleva dos pasadas. */
    unidadesConsumidas: { type: Number, required: true, default: 1, min: 0 },
    /** Minutos encendido para esta unidad. Alimenta el calculo de energia. */
    minutosUso: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

const esquemaProducto = new Schema(
  {
    organizacionId: campoOrganizacion(),
    nombre: { type: String, required: true, trim: true },
    categoria: { type: String, required: true, trim: true, default: 'General' },
    insumos: { type: [esquemaRecetaInsumo], default: [] },
    equipos: { type: [esquemaRecetaEquipo], default: [] },
    minutosManoObra: { type: Number, required: true, default: 0, min: 0 },
    otrosGastos: campoMonto('centavos', 0),
    porcentajeMerma: campoPorcentaje(DEFAULTS.PORCENTAJE_MERMA),
    /**
     * Margen SOBRE EL PRECIO DE VENTA, no recargo sobre el costo.
     * El tope es 99,99: con 100 el precio seria infinito.
     */
    margen: campoPorcentaje(
      DEFAULTS.MARGEN,
      99.99,
      'El margen tiene que ser menor a 100%: con 100% el precio seria infinito.',
    ),
    /**
     * Valor por defecto del producto. La comision en realidad pertenece al CANAL
     * de venta (ML 13%, MercadoPago 6,9%, efectivo 0%), asi que el motor la recibe
     * como parametro: la misma taza se cotiza por los tres sin duplicar el producto.
     * Cuando exista una entidad CanalVenta, este campo pasa a ser solo el default.
     */
    comisionPlataforma: campoPorcentaje(
      DEFAULTS.COMISION_PLATAFORMA,
      99.99,
      'La comision tiene que ser menor a 100%.',
    ),
    /** Descuentos por volumen. Si esta vacio, se usan los de Empresa. */
    tramosDescuento: { type: [esquemaTramoDescuento], default: [] },
    activo: { type: Boolean, required: true, default: true },
  },
  opcionesBase,
);

export type ProductoDoc = HydratedDocument<InferSchemaType<typeof esquemaProducto>>;

esquemaProducto.index({ organizacionId: 1, nombre: 1 }, { unique: true });
esquemaProducto.index({ organizacionId: 1, activo: 1, categoria: 1 });

/** Los tramos ordenados y sin duplicados: el motor busca el mayor alcanzado. */
esquemaProducto.pre('validate', function (this: ProductoDoc) {
  if (this.tramosDescuento?.length) {
    const vistos = new Set<number>();
    for (const t of this.tramosDescuento) {
      if (vistos.has(t.desdeCantidad)) {
        this.invalidate('tramosDescuento', `Hay dos tramos que arrancan en ${t.desdeCantidad} unidades.`);
      }
      vistos.add(t.desdeCantidad);
    }
    this.tramosDescuento.sort((a: { desdeCantidad: number }, b: { desdeCantidad: number }) => a.desdeCantidad - b.desdeCantidad);
  }
});

export const ProductoModel = model('Producto', esquemaProducto);
