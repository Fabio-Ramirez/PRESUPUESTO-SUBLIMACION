import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { calcularAmortizacionPorUnidad } from '@calc/shared';
import { campoMonto, campoOrganizacion, opcionesBase } from './comun.js';

/**
 * Equipo: impresora, plancha, corte.
 *
 * En la planilla la amortizacion era un monto fijo escrito a mano ($8,45, $74,95)
 * que quedaba viejo apenas se cambiaba una maquina. Aca se carga lo que se sabe
 * —cuanto salio y cuantas piezas se espera que haga— y la amortizacion se deriva.
 */
const esquemaEquipo = new Schema(
  {
    organizacionId: campoOrganizacion(),
    nombre: { type: String, required: true, trim: true },
    costoAdquisicion: campoMonto('centavos'),
    /** Piezas que se estima que produce en toda su vida util. */
    vidaUtilUnidades: {
      type: Number,
      required: true,
      min: [1, 'La vida util tiene que ser de al menos 1 unidad.'],
    },
    fechaCompra: { type: Date, required: true, default: () => new Date() },
    /**
     * Consumo electrico del equipo. Va aca y no en la configuracion global porque
     * una plancha de 1400 W y una impresora de 30 W no pueden compartir un unico
     * "consumo estimado": sin este campo la energia no es calculable por equipo.
     */
    consumoWatts: { type: Number, required: true, default: 0, min: 0 },
    /** Derivado. Nunca se carga a mano. */
    amortizacionPorUnidad: campoMonto('milicentavos'),
    activo: { type: Boolean, required: true, default: true },
  },
  opcionesBase,
);

export type EquipoDoc = HydratedDocument<InferSchemaType<typeof esquemaEquipo>>;

esquemaEquipo.index({ organizacionId: 1, nombre: 1 }, { unique: true });

/**
 * Se recalcula en cada guardado, no solo al crear: si se corrige el costo o la vida
 * util y la amortizacion no se actualiza, todos los costeos siguientes mienten.
 *
 * Nota: cambiar un equipo NO altera los presupuestos ya emitidos, porque esos
 * congelaron su costo. Solo cambia de aca en adelante, que es lo que se quiere.
 */
esquemaEquipo.pre('validate', function (this: EquipoDoc) {
  if (this.costoAdquisicion != null && this.vidaUtilUnidades > 0) {
    this.amortizacionPorUnidad = calcularAmortizacionPorUnidad(
      this.costoAdquisicion as never,
      this.vidaUtilUnidades,
    );
  }
});

export const EquipoModel = model('Equipo', esquemaEquipo);
