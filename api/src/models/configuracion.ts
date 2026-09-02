import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { CondicionIva, DEFAULTS, ORG_UNICA, formatearNumeroPresupuesto } from '@calc/shared';
import {
  campoMonto,
  campoOrganizacion,
  campoPorcentaje,
  esquemaTramoDescuento,
  opcionesBase,
} from './comun.js';

/**
 * Configuracion — singleton unico.
 *
 * Reemplaza a Empresa + CostoOperativo, que eran dos singletons con la misma vida
 * util y la misma pantalla. Los tres subdocumentos son las tres secciones del
 * formulario, y `empresa` es literalmente lo que consume el encabezado del PDF.
 */

const esquemaDatosEmpresa = new Schema(
  {
    nombre: { type: String, trim: true, default: '' },
    cuit: { type: String, trim: true, default: '' },
    direccion: { type: String, trim: true, default: '' },
    whatsapp: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    /** Data URI: el PDF queda autocontenido, sin depender de ningun archivo externo. */
    logo: { type: String },
    condicionIva: {
      type: String,
      required: true,
      enum: Object.values(CondicionIva),
      default: CondicionIva.MONOTRIBUTO,
    },
  },
  { _id: false },
);

const esquemaCostosOperativos = new Schema(
  {
    valorHoraManoObra: campoMonto('centavos', 0),
    costoKwh: campoMonto('centavos', 0),
  },
  { _id: false },
);

const esquemaDefaultsPresupuesto = new Schema(
  {
    condicionesGeneralesPorDefecto: { type: String, default: '' },
    validezDiasPorDefecto: { type: Number, required: true, default: DEFAULTS.VALIDEZ_DIAS, min: 1 },
    porcentajeSeniaPorDefecto: campoPorcentaje(DEFAULTS.PORCENTAJE_SENIA),
    tramosDescuentoPorDefecto: { type: [esquemaTramoDescuento], default: [] },
    /** El "000" de 000-001. */
    puntoVenta: { type: Number, required: true, default: 1, min: 0 },
    /** Proximo numero libre. Lo consume `tomarNumeroPresupuesto`. */
    proximoNumeroPresupuesto: { type: Number, required: true, default: 1, min: 1 },
  },
  { _id: false },
);

const esquemaConfiguracion = new Schema(
  {
    organizacionId: campoOrganizacion(true),
    empresa: { type: esquemaDatosEmpresa, required: true, default: () => ({}) },
    costos: { type: esquemaCostosOperativos, required: true, default: () => ({}) },
    presupuestos: { type: esquemaDefaultsPresupuesto, required: true, default: () => ({}) },
  },
  opcionesBase,
);

export type ConfiguracionDoc = HydratedDocument<InferSchemaType<typeof esquemaConfiguracion>>;
export const ConfiguracionModel = model('Configuracion', esquemaConfiguracion);

/**
 * Devuelve la configuracion, creandola con los defaults si es la primera vez.
 * La app nunca deberia romper por falta de configuracion: arranca vacia y usable.
 */
export async function obtenerConfiguracion(organizacionId = ORG_UNICA): Promise<ConfiguracionDoc> {
  return ConfiguracionModel.findOneAndUpdate(
    { organizacionId },
    { $setOnInsert: { organizacionId } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

/**
 * Reserva el proximo numero correlativo y lo devuelve formateado (000-001).
 *
 * El $inc y la lectura son la MISMA operacion atomica: dos emisiones simultaneas no
 * pueden llevarse el mismo numero. Se llama unicamente en la transicion
 * BORRADOR -> ENVIADO, nunca al crear el borrador, para que los borradores que se
 * descartan no dejen huecos.
 *
 * Riesgo residual: si la emision falla DESPUES de reservar, ese numero se pierde.
 * Con un solo usuario es despreciable; cerrarlo del todo exige envolver reserva y
 * guardado en una transaccion, lo que obliga a correr Mongo como replica set.
 */
export async function tomarNumeroPresupuesto(organizacionId = ORG_UNICA): Promise<string> {
  // `new: false` devuelve el documento PREVIO: ese es el numero que se reserva.
  const previo = await ConfiguracionModel.findOneAndUpdate(
    { organizacionId },
    { $inc: { 'presupuestos.proximoNumeroPresupuesto': 1 } },
    { new: false, upsert: true, setDefaultsOnInsert: true },
  );
  const numero = previo?.presupuestos?.proximoNumeroPresupuesto ?? 1;
  const puntoVenta = previo?.presupuestos?.puntoVenta ?? 1;
  return formatearNumeroPresupuesto(puntoVenta, numero);
}
