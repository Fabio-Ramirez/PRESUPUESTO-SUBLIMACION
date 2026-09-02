import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  CondicionIva,
  DEFAULTS,
  EstadoPresupuesto,
  TipoDescuento,
  UnidadUso,
  calcularValidoHasta,
  resolverEstadoEfectivo,
} from '@calc/shared';
import { campoMonto, campoOrganizacion, campoPorcentaje, opcionesBase } from './comun.js';

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

/**
 * Los datos del cliente COPIADOS, no referenciados.
 *
 * Si el cliente se muda o cambia de razon social, el presupuesto emitido tiene que
 * seguir diciendo lo que decia el dia que se mando. La referencia `clienteId` queda
 * al lado, solo para poder navegar al cliente actual.
 */
const esquemaClienteSnapshot = new Schema(
  {
    clienteId: { type: Schema.Types.ObjectId, ref: 'Cliente', default: null },
    nombreRazonSocial: { type: String, required: true, trim: true },
    cuitDni: { type: String, trim: true },
    direccion: { type: String, trim: true },
    localidad: { type: String, trim: true },
    telefono: { type: String, trim: true },
    email: { type: String, trim: true },
    activo: { type: Boolean, default: true },
  },
  { _id: false },
);

/** El desglose del costeo, congelado en centavos. Permite auditar el costo unitario. */
const esquemaCosteoCongelado = new Schema(
  {
    costoInsumos: campoMonto('centavos', 0),
    manoObra: campoMonto('centavos', 0),
    energia: campoMonto('centavos', 0),
    amortizaciones: campoMonto('centavos', 0),
    otrosGastos: campoMonto('centavos', 0),
    merma: campoMonto('centavos', 0),
    porcentajeMerma: { type: Number, default: 0 },
    margen: { type: Number, default: 0 },
    comisionPlataforma: { type: Number, default: 0 },
    detalleInsumos: {
      type: [
        new Schema(
          {
            nombre: String,
            cantidad: Number,
            unidadUso: { type: String, enum: Object.values(UnidadUso) },
            precioPorUnidadUso: { type: Number, default: null },
            costo: campoMonto('centavos', 0),
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: false },
);

const esquemaItem = new Schema(
  {
    /** Referencia informativa. La descripcion y los numeros ya estan copiados. */
    producto: { type: Schema.Types.ObjectId, ref: 'Producto', default: null },
    descripcion: { type: String, required: true, trim: true },
    cantidad: { type: Number, required: true, min: [0, 'La cantidad no puede ser negativa.'] },
    precioUnitario: campoMonto('centavos'),
    subtotal: campoMonto('centavos'),
    /**
     * El costo del momento. Es lo que permite responder, meses despues, que margen
     * REAL tuvo cada trabajo, aunque desde entonces hayan subido los insumos.
     */
    costoUnitarioAlMomento: campoMonto('centavos', 0),
    costeoAlMomento: { type: esquemaCosteoCongelado, default: undefined },
    /** true si al emitir algun insumo no tenia precio: el costo guardado es parcial. */
    costeoIncompleto: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

/* ------------------------------------------------------------------ */
/* Presupuesto                                                         */
/* ------------------------------------------------------------------ */

const esquemaPresupuesto = new Schema(
  {
    organizacionId: campoOrganizacion(),
    /**
     * null mientras es BORRADOR. Se asigna recien al pasar a ENVIADO, para que los
     * borradores descartados no dejen huecos en la numeracion.
     */
    numero: { type: String, default: null },
    fecha: { type: Date, required: true, default: () => new Date() },
    validezDias: { type: Number, required: true, default: DEFAULTS.VALIDEZ_DIAS, min: 1 },
    /** Derivado de fecha + validezDias en el hook de abajo. */
    validoHasta: { type: Date, required: true },

    cliente: { type: esquemaClienteSnapshot, required: true },
    items: { type: [esquemaItem], default: [] },

    subtotal: campoMonto('centavos', 0),
    descuento: {
      type: new Schema(
        {
          tipo: { type: String, required: true, enum: Object.values(TipoDescuento) },
          valor: { type: Number, required: true, min: 0 },
          monto: campoMonto('centavos'),
          /** true si lo puso el motor por tramos, false si lo escribio el usuario. */
          automatico: { type: Boolean, required: true, default: false },
        },
        { _id: false },
      ),
      default: null,
    },
    neto: campoMonto('centavos', 0),
    iva: {
      type: new Schema(
        {
          condicion: { type: String, required: true, enum: Object.values(CondicionIva) },
          alicuota: { type: Number, required: true, default: 0 },
          monto: campoMonto('centavos', 0),
        },
        { _id: false },
      ),
      required: true,
    },
    total: campoMonto('centavos', 0),

    porcentajeSenia: campoPorcentaje(DEFAULTS.PORCENTAJE_SENIA),
    montoSenia: campoMonto('centavos', 0),
    saldoContraEntrega: campoMonto('centavos', 0),

    /** Texto del pie del PDF. Editable por presupuesto, arranca del default de Empresa. */
    condicionesGenerales: { type: String, default: '' },

    estado: {
      type: String,
      required: true,
      enum: Object.values(EstadoPresupuesto),
      default: EstadoPresupuesto.BORRADOR,
    },
    notasInternas: { type: String },
    fechaEnvio: { type: Date },
    /** Si nacio de "duplicar con precios actuales". */
    duplicadoDe: { type: Schema.Types.ObjectId, ref: 'Presupuesto', default: null },
  },
  opcionesBase,
);

export type PresupuestoDoc = HydratedDocument<InferSchemaType<typeof esquemaPresupuesto>>;

/**
 * Unico entre los que TIENEN numero. El indice parcial es indispensable: sin el,
 * el segundo borrador (numero null) chocaria con el primero.
 */
esquemaPresupuesto.index(
  { organizacionId: 1, numero: 1 },
  { unique: true, partialFilterExpression: { numero: { $type: 'string' } } },
);
esquemaPresupuesto.index({ organizacionId: 1, estado: 1, fecha: -1 });
esquemaPresupuesto.index({ organizacionId: 1, 'cliente.clienteId': 1, fecha: -1 });

/** validoHasta = fecha + validezDias. Derivado, nunca cargado a mano. */
esquemaPresupuesto.pre('validate', function (this: PresupuestoDoc) {
  if (this.fecha && this.validezDias) {
    this.validoHasta = calcularValidoHasta(this.fecha, this.validezDias);
  }
});

/**
 * VENCIDO se calcula al leer, no se escribe.
 *
 * La regla original decia "se marca VENCIDO al consultarlo", pero eso convierte un
 * listado de 200 presupuestos en 200 escrituras y ensucia el historial. Como virtual
 * da el mismo resultado visible, sin efectos de lado en una lectura.
 */
esquemaPresupuesto.virtual('estadoEfectivo').get(function (this: PresupuestoDoc) {
  return resolverEstadoEfectivo(this.estado as EstadoPresupuesto, this.validoHasta);
});

/**
 * Un presupuesto emitido NO se recalcula nunca contra precios nuevos: sus numeros
 * son historia. Para cotizar de vuelta esta "duplicar con precios actuales", que crea
 * un presupuesto nuevo con numero nuevo. Este guard hace que la regla no dependa de
 * que todos los caminos del codigo se acuerden.
 */
const CAMPOS_CONGELADOS = [
  'numero',
  'fecha',
  'cliente',
  'items',
  'subtotal',
  'descuento',
  'neto',
  'iva',
  'total',
  'porcentajeSenia',
  'montoSenia',
  'saldoContraEntrega',
  'validezDias',
  'validoHasta',
] as const;

esquemaPresupuesto.pre('save', function (this: PresupuestoDoc, next) {
  if (this.isNew || this.estado === EstadoPresupuesto.BORRADOR) return next();

  /**
   * La emision misma (BORRADOR -> ENVIADO) es el unico momento en que se escribe
   * `numero`, y para cuando llega este hook `estado` ya vale ENVIADO. Sin esta
   * excepcion el guard se dispararia contra la operacion que justamente tiene que
   * permitir. Todo lo demas sigue congelado incluso durante la emision: emitir no
   * puede ser la excusa para cambiar de paso los precios.
   */
  const emitiendo = this.isModified('estado') && this.estado === EstadoPresupuesto.ENVIADO;
  const congelados = emitiendo ? CAMPOS_CONGELADOS.filter((c) => c !== 'numero') : CAMPOS_CONGELADOS;

  const tocados = congelados.filter((c) => this.isModified(c));
  if (tocados.length > 0) {
    return next(
      new Error(
        `Un presupuesto ya emitido no se modifica (se intento cambiar: ${tocados.join(', ')}). ` +
          'Usa "duplicar con precios actuales" para generar uno nuevo.',
      ),
    );
  }
  next();
});

export const PresupuestoModel = model('Presupuesto', esquemaPresupuesto);
