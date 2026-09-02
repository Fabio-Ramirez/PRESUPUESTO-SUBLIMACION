/**
 * Dinero: dos unidades enteras, ninguna coma flotante persistida.
 *
 * Centavos       -> todo lo facturable (precios de lista, items, totales del presupuesto).
 * Milicentavos   -> todo lo *derivado de una division* dentro del costeo
 *                   (precio por unidad de uso, amortizacion por unidad, costos intermedios).
 *
 * Por que dos unidades: el precio de una hoja de papel es "precio de la resma / 100".
 * Si eso se redondea a centavos, el error entra al costo unitario y se DUPLICA al
 * dividir por (1 - margen). La planilla original arrastra esos decimales ocultos:
 * el papel que muestra "$35,31" vale en realidad $35,306. Reproducir el Excel exige
 * la misma precision sub-centavo.
 *
 * Regla: el motor calcula en milicentavos y redondea a centavos UNA sola vez,
 * al asentar el precio en un presupuesto o al mostrarlo en pantalla.
 */

/** Entero. 1 peso = 100 centavos. */
export type Centavos = number & { readonly __unidad: 'centavos' };

/** Entero. 1 centavo = 1.000 milicentavos, 1 peso = 100.000 milicentavos. */
export type Milicentavos = number & { readonly __unidad: 'milicentavos' };

export const CENTAVOS_POR_PESO = 100;
export const MILICENTAVOS_POR_CENTAVO = 1_000;
export const MILICENTAVOS_POR_PESO = 100_000;

/**
 * Redondeo half-away-from-zero (0,5 -> 1 ; -0,5 -> -1).
 * Math.round no sirve solo: con negativos redondea hacia +Infinito
 * (Math.round(-0.5) === -0), lo que hace que un descuento y su reverso no cierren.
 */
export function redondear(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

export function centavos(n: number): Centavos {
  return redondear(n) as Centavos;
}

export function milicentavos(n: number): Milicentavos {
  return redondear(n) as Milicentavos;
}

export const CERO_C = 0 as Centavos;
export const CERO_M = 0 as Milicentavos;

/* ------------------------------------------------------------------ */
/* Conversiones                                                        */
/* ------------------------------------------------------------------ */

export function aMilicentavos(c: Centavos): Milicentavos {
  return (c * MILICENTAVOS_POR_CENTAVO) as Milicentavos;
}

/** Unico punto donde se pierde precision. Llamalo lo mas tarde posible. */
export function aCentavos(m: Milicentavos): Centavos {
  return redondear(m / MILICENTAVOS_POR_CENTAVO) as Centavos;
}

/** Solo para entrada de usuario y tests. Nunca para persistir. */
export function pesosACentavos(pesos: number): Centavos {
  return redondear(pesos * CENTAVOS_POR_PESO) as Centavos;
}

export function pesosAMilicentavos(pesos: number): Milicentavos {
  return redondear(pesos * MILICENTAVOS_POR_PESO) as Milicentavos;
}

export function centavosAPesos(c: Centavos): number {
  return c / CENTAVOS_POR_PESO;
}

export function milicentavosAPesos(m: Milicentavos): number {
  return m / MILICENTAVOS_POR_PESO;
}

/* ------------------------------------------------------------------ */
/* Aritmetica                                                          */
/* ------------------------------------------------------------------ */

export function sumarM(...xs: Milicentavos[]): Milicentavos {
  let t = 0;
  for (const x of xs) t += x;
  return t as Milicentavos;
}

export function sumarC(...xs: Centavos[]): Centavos {
  let t = 0;
  for (const x of xs) t += x;
  return t as Centavos;
}

/** monto x cantidad. La cantidad puede ser fraccionaria (0,5 hoja; 1,8 ml). */
export function porCantidadM(monto: Milicentavos, cantidad: number): Milicentavos {
  return milicentavos(monto * cantidad);
}

/**
 * monto x porcentaje. `pct` en porcentaje humano (3 = 3%, 12.5 = 12,5%).
 * Se escala a basis points enteros antes de multiplicar para que 3% de un entero
 * de sub-centavos de exacto en vez de arrastrar 0,00000001.
 */
export function porcentajeDeM(monto: Milicentavos, pct: number): Milicentavos {
  return milicentavos((monto * aBps(pct)) / 10_000);
}

export function porcentajeDeC(monto: Centavos, pct: number): Centavos {
  return centavos((monto * aBps(pct)) / 10_000);
}

/** 12,5 % -> 1250 basis points enteros. */
export function aBps(pct: number): number {
  return redondear(pct * 100);
}

/**
 * Divide un monto por (1 - pct), que es la operacion central del pricing:
 *   precio = costo / (1 - margen)
 * Se resuelve como  monto * 10.000 / (10.000 - bps)  para no tocar nunca un
 * float como 0,6667. Exacto mientras el numerador sea un entero seguro:
 * con milicentavos eso topa cerca de $900.000 por unidad, holgado para el rubro.
 */
export function dividirPorComplementoM(monto: Milicentavos, pct: number): Milicentavos {
  const bps = aBps(pct);
  if (bps >= 10_000) {
    throw new RangeError(
      `Un porcentaje de ${pct}% sobre el precio de venta es imposible: dejaria el precio en infinito. Tiene que ser menor a 100.`,
    );
  }
  if (bps < 0) {
    throw new RangeError(`Porcentaje negativo no valido: ${pct}%.`);
  }
  const numerador = monto * 10_000;
  if (!Number.isSafeInteger(numerador)) {
    throw new RangeError('Monto fuera del rango soportado por el motor de costeo.');
  }
  return milicentavos(numerador / (10_000 - bps));
}

/* ------------------------------------------------------------------ */
/* Formato (es-AR)                                                     */
/* ------------------------------------------------------------------ */

const FMT_PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * $ 1.234,56
 *
 * Intl separa el simbolo con un espacio duro (U+00A0). Se normaliza a espacio
 * comun: de otro modo cualquier comparacion de strings falla de forma invisible.
 * Que los importes no se partan en el PDF se resuelve con `white-space: nowrap`.
 */
export function formatearCentavos(c: Centavos): string {
  return FMT_PESOS.format(centavosAPesos(c)).replace(/\u00A0/g, ' ');
}

/** Redondea a centavos para mostrar. El detalle sub-centavo no se muestra nunca. */
export function formatearMilicentavos(m: Milicentavos): string {
  return formatearCentavos(aCentavos(m));
}

/** 50 -> "50%" ; 12,5 -> "12,5%". Sin espacio: es como se escribe comercialmente aca. */
export function formatearPorcentaje(pct: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(pct) + '%';
}
