import { Pipe, type PipeTransform } from '@angular/core';
import {
  aCentavos,
  formatearCentavos,
  formatearFecha,
  formatearPorcentaje,
  type Centavos,
  type Milicentavos,
} from '@calc/shared';

/**
 * Pipes de formato.
 *
 * Todos delegan en las funciones de /shared: el "$ 1.234,56" de la pantalla sale
 * del mismo codigo que el del PDF, asi que no pueden divergir en un separador.
 */

/** Centavos enteros -> "$ 1.234,56" */
@Pipe({ name: 'pesos' })
export class PesosPipe implements PipeTransform {
  transform(centavos: number | null | undefined): string {
    if (centavos == null) return '—';
    return formatearCentavos(centavos as Centavos);
  }
}

/**
 * Milicentavos -> "$ 1.234,56"
 *
 * Es lo que devuelve el motor de costeo. Se redondea solo para mostrar: el valor
 * que se guarda en el presupuesto se redondea una unica vez, al emitir.
 */
@Pipe({ name: 'pesosM' })
export class PesosMiliPipe implements PipeTransform {
  transform(mili: number | null | undefined): string {
    if (mili == null) return '—';
    return formatearCentavos(aCentavos(mili as Milicentavos));
  }
}

/** 12.5 -> "12,5%" */
@Pipe({ name: 'pct' })
export class PorcentajePipe implements PipeTransform {
  transform(valor: number | null | undefined): string {
    if (valor == null) return '—';
    return formatearPorcentaje(valor);
  }
}

/** ISO -> "31/08/2026" en horario de Argentina */
@Pipe({ name: 'fecha' })
export class FechaPipe implements PipeTransform {
  transform(fecha: string | Date | null | undefined): string {
    if (!fecha) return '—';
    return formatearFecha(fecha);
  }
}

/** 2.5 -> "2,5" ; 50 -> "50". Sin decimales inutiles en columnas de cantidad. */
@Pipe({ name: 'cantidad' })
export class CantidadPipe implements PipeTransform {
  private readonly fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

  transform(valor: number | null | undefined): string {
    if (valor == null) return '—';
    return this.fmt.format(valor);
  }
}

export const PIPES_FORMATO = [
  PesosPipe,
  PesosMiliPipe,
  PorcentajePipe,
  FechaPipe,
  CantidadPipe,
] as const;

/* ------------------------------------------------------------------ */
/* Entrada de montos                                                   */
/* ------------------------------------------------------------------ */

/**
 * El usuario escribe pesos ("4.900,50"), la API recibe centavos enteros (490050).
 * La conversion vive aca, en un solo lugar: si cada formulario la hiciera por su
 * cuenta, alcanzaria con que uno se olvide del x100 para cargar un precio cien
 * veces mas barato.
 */
export function pesosDeTexto(texto: string): number | null {
  const limpio = texto
    .replace(/\s|\$/g, '')
    .replace(/\./g, '') // separador de miles
    .replace(',', '.'); // separador decimal
  if (limpio === '') return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Centavos -> "4900,50" para poner adentro de un <input>. Sin simbolo ni miles. */
export function textoDePesos(centavos: number | null | undefined): string {
  if (centavos == null) return '';
  return (centavos / 100).toFixed(2).replace('.', ',');
}
