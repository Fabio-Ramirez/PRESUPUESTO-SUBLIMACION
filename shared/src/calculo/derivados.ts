import {
  aMilicentavos,
  milicentavos,
  type Centavos,
  type Milicentavos,
} from '../dinero.js';
import { DEFAULTS } from '../enums.js';
import type { Presentacion } from '../modelo.js';

/**
 * Campos que NO se cargan a mano. Estan aca, en un solo lugar, para que la API,
 * el front y cualquier script de migracion los deriven igual.
 */

/**
 * precioPorUnidadUso = precioPresentacion / presentacion.cantidad
 *
 * Este cociente es la razon de ser de los milicentavos. Una resma de 500 hojas a
 * $17.653,00 da $35,306 por hoja. Redondeado a centavos ($35,31) el costo unitario
 * se corre, y el error se duplica al dividir por (1 - margen). La planilla original
 * arrastra exactamente estos decimales ocultos.
 *
 * Se persiste junto al precio y NUNCA se recalcula: es historia.
 */
export function calcularPrecioPorUnidadUso(
  precioPresentacion: Centavos,
  presentacion: Presentacion,
): Milicentavos {
  if (!(presentacion.cantidad > 0)) {
    throw new RangeError('La cantidad de la presentacion tiene que ser mayor a cero.');
  }
  return milicentavos(aMilicentavos(precioPresentacion) / presentacion.cantidad);
}

/**
 * amortizacionPorUnidad = costoAdquisicion / vidaUtilUnidades
 *
 * Derivado, recalculado en cada guardado del equipo. En la planilla eran montos
 * fijos escritos a mano que quedaban viejos apenas se cambiaba una impresora.
 */
export function calcularAmortizacionPorUnidad(
  costoAdquisicion: Centavos,
  vidaUtilUnidades: number,
): Milicentavos {
  if (!(vidaUtilUnidades > 0)) {
    throw new RangeError('La vida util del equipo tiene que ser mayor a cero unidades.');
  }
  return milicentavos(aMilicentavos(costoAdquisicion) / vidaUtilUnidades);
}

/** "000-001": punto de venta en 3 digitos, numero en 3 (crece si hace falta). */
export function formatearNumeroPresupuesto(puntoVenta: number, numero: number): string {
  const pv = String(puntoVenta).padStart(3, '0');
  const nro = String(numero).padStart(3, '0');
  return `${pv}-${nro}`;
}

/** Dias enteros entre dos fechas, contados sobre el dia calendario argentino. */
export function diasEntre(desde: Date, hasta: Date): number {
  const MS_DIA = 86_400_000;
  return Math.floor((inicioDelDiaAr(hasta).getTime() - inicioDelDiaAr(desde).getTime()) / MS_DIA);
}

export function precioEstaDesactualizado(
  fechaPrecio: Date,
  ahora: Date = new Date(),
  dias: number = DEFAULTS.DIAS_PRECIO_DESACTUALIZADO,
): boolean {
  return diasEntre(fechaPrecio, ahora) > dias;
}

/** validoHasta = fecha + validezDias */
export function calcularValidoHasta(fecha: Date, validezDias: number): Date {
  const d = new Date(fecha.getTime());
  d.setUTCDate(d.getUTCDate() + validezDias);
  return d;
}

/* ------------------------------------------------------------------ */
/* Fechas en horario de Argentina                                      */
/* ------------------------------------------------------------------ */

export const ZONA_AR = 'America/Argentina/Buenos_Aires';

const FMT_FECHA_AR = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_AR,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** DD/MM/AAAA */
export function formatearFecha(fecha: Date | string): string {
  return FMT_FECHA_AR.format(typeof fecha === 'string' ? new Date(fecha) : fecha);
}

/**
 * Medianoche argentina del dia al que pertenece `fecha`, expresada en UTC.
 * Hace falta para comparar vencimientos: un presupuesto vence al terminar su
 * ultimo dia en Argentina, no a las 21:00 del dia anterior por el offset UTC.
 */
export function inicioDelDiaAr(fecha: Date): Date {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_AR,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
  return new Date(`${partes}T00:00:00.000Z`);
}
