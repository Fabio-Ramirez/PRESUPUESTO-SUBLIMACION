import {
  aMilicentavos,
  dividirPorComplementoM,
  milicentavos,
  porCantidadM,
  porcentajeDeM,
  sumarM,
  CERO_M,
  type Centavos,
  type Milicentavos,
} from '../dinero.js';
import { MotivoIncompleto, type TipoInsumo, type UnidadUso } from '../enums.js';
import type {
  Advertencia,
  CostosOperativos,
  Equipo,
  Id,
  InsumoConPrecio,
  LineaCosteoEquipo,
  LineaCosteoInsumo,
  Producto,
  ResultadoCosteo,
  ResumenCosteoCongelado,
} from '../modelo.js';
import { aCentavos } from '../dinero.js';

/**
 * MOTOR DE COSTEO
 *
 * Funcion pura. Vive en /shared porque la usan los dos lados y tienen que dar
 * exactamente lo mismo:
 *   - el front, para recalcular en vivo mientras se mueve un slider;
 *   - la API, para congelar el costo dentro del presupuesto que se emite.
 * Si el calculo estuviera duplicado, tarde o temprano divergen y el presupuesto
 * emitido no coincide con lo que el usuario vio en pantalla.
 *
 * Trabaja integramente en milicentavos y no redondea a centavos en ningun paso
 * intermedio (ver dinero.ts para el por que).
 */

/** Entrada aplanada: el motor no sabe de Mongo ni de HTTP, solo de numeros. */
export interface EntradaCosteo {
  insumos: EntradaInsumo[];
  equipos: EntradaEquipo[];
  minutosManoObra: number;
  valorHoraManoObra: Milicentavos;
  costoKwh: Milicentavos;
  otrosGastos: Milicentavos;
  porcentajeMerma: number;
  margen: number;
  comisionPlataforma: number;
}

export interface EntradaInsumo {
  insumoId: Id;
  nombre: string;
  tipo: TipoInsumo;
  unidadUso: UnidadUso;
  cantidad: number;
  /** null cuando el insumo todavia no tiene precio cargado. */
  precioPorUnidadUso: Milicentavos | null;
}

export interface EntradaEquipo {
  equipoId: Id;
  nombre: string;
  unidadesConsumidas: number;
  minutosUso: number;
  amortizacionPorUnidad: Milicentavos;
  consumoWatts: number;
}

/* ------------------------------------------------------------------ */
/* Pasos elementales, exportados para poder testearlos de a uno        */
/* ------------------------------------------------------------------ */

/**
 * PASO 1 - Insumos.  costoInsumos = SUMA (cantidadUsada x precioPorUnidadDeUso)
 *
 * Un insumo sin precio no rompe el costeo: aporta 0 y se marca `sinPrecio`.
 * El total resultante es parcial y el llamador lo avisa, en vez de dejar al
 * usuario sin ningun numero.
 */
export function calcularLineasInsumo(insumos: readonly EntradaInsumo[]): LineaCosteoInsumo[] {
  return insumos.map((i) => {
    const sinPrecio = i.precioPorUnidadUso === null;
    return {
      insumoId: i.insumoId,
      nombre: i.nombre,
      tipo: i.tipo,
      unidadUso: i.unidadUso,
      cantidad: i.cantidad,
      precioPorUnidadUso: i.precioPorUnidadUso,
      costo: sinPrecio ? CERO_M : porCantidadM(i.precioPorUnidadUso as Milicentavos, i.cantidad),
      sinPrecio,
    };
  });
}

/**
 * PASO 2a - Mano de obra.  minutos / 60 x valorHora
 * Se resuelve como (valorHora x minutos) / 60 para dividir una sola vez, al final.
 */
export function calcularManoObra(minutos: number, valorHora: Milicentavos): Milicentavos {
  if (minutos <= 0 || valorHora <= 0) return CERO_M;
  return milicentavos((valorHora * minutos) / 60);
}

/**
 * PASO 2b - Energia, por equipo.
 *   kWh consumidos = (minutos / 60) x (watts / 1000)
 *   costo          = kWh x costoKwh
 * Todo junto: (minutos x watts x costoKwh) / 60.000
 */
export function calcularEnergia(
  minutosUso: number,
  consumoWatts: number,
  costoKwh: Milicentavos,
): Milicentavos {
  if (minutosUso <= 0 || consumoWatts <= 0 || costoKwh <= 0) return CERO_M;
  return milicentavos((minutosUso * consumoWatts * costoKwh) / 60_000);
}

/**
 * PASO 2c - Amortizacion.  unidadesConsumidas x (costoEquipo / vidaUtil)
 * El cociente ya viene resuelto en `amortizacionPorUnidad`: es una propiedad del
 * equipo, no del producto, y se recalcula cada vez que el equipo se edita.
 */
export function calcularAmortizacion(
  unidadesConsumidas: number,
  amortizacionPorUnidad: Milicentavos,
): Milicentavos {
  if (unidadesConsumidas <= 0) return CERO_M;
  return porCantidadM(amortizacionPorUnidad, unidadesConsumidas);
}

export function calcularLineasEquipo(
  equipos: readonly EntradaEquipo[],
  costoKwh: Milicentavos,
): LineaCosteoEquipo[] {
  return equipos.map((e) => ({
    equipoId: e.equipoId,
    nombre: e.nombre,
    unidadesConsumidas: e.unidadesConsumidas,
    minutosUso: e.minutosUso,
    amortizacion: calcularAmortizacion(e.unidadesConsumidas, e.amortizacionPorUnidad),
    energia: calcularEnergia(e.minutosUso, e.consumoWatts, costoKwh),
  }));
}

/**
 * PASO 5 - Precio sugerido.  costoTotal / (1 - margen)
 *
 * Este es el punto donde se comete el error clasico. El margen es sobre el PRECIO
 * DE VENTA, no un recargo sobre el costo:
 *   correcto:   5.187,96 / (1 - 0,50) = 10.375,92   <- la mitad del precio es ganancia
 *   incorrecto: 5.187,96 x 1,50       =  7.781,94   <- la ganancia seria 33%, no 50%
 */
export function calcularPrecioSugerido(costoTotal: Milicentavos, margen: number): Milicentavos {
  return dividirPorComplementoM(costoTotal, margen);
}

/**
 * PASO 6 - Precio de venta final.  precioSugerido / (1 - comision)
 *
 * La comision de plataforma (MercadoLibre, MercadoPago) se cobra sobre el precio
 * final, asi que tambien se DIVIDE. Sumarla al costo recupera de menos:
 *   dividir: 10.375,92 / (1 - 0,13) = 11.926,34  ->  ML cobra 1.550,42, te quedan 10.375,92 (exacto)
 *   sumar:   10.375,92 x 1,13       = 11.724,79  ->  ML cobra 1.524,22, te quedan 10.200,57 (faltan 175,35)
 */
export function calcularPrecioVentaFinal(
  precioSugerido: Milicentavos,
  comisionPlataforma: number,
): Milicentavos {
  if (comisionPlataforma <= 0) return precioSugerido;
  return dividirPorComplementoM(precioSugerido, comisionPlataforma);
}

/* ------------------------------------------------------------------ */
/* Motor completo                                                      */
/* ------------------------------------------------------------------ */

export function calcularCosteo(entrada: EntradaCosteo): ResultadoCosteo {
  const advertencias: Advertencia[] = [];

  /* --- Bloque 1: costos de los insumos ---------------------------- */
  const lineasInsumo = calcularLineasInsumo(entrada.insumos);
  const costoInsumos = sumarM(...lineasInsumo.map((l) => l.costo));

  for (const l of lineasInsumo) {
    if (l.sinPrecio) {
      advertencias.push({
        motivo: MotivoIncompleto.INSUMO_SIN_PRECIO,
        detalle: `"${l.nombre}" no tiene precio cargado. Se conto como $ 0,00 y el total es parcial.`,
      });
    }
  }

  /* --- Bloque 2: costo de produccion ------------------------------ */
  const lineasEquipo = calcularLineasEquipo(entrada.equipos, entrada.costoKwh);
  const manoObra = calcularManoObra(entrada.minutosManoObra, entrada.valorHoraManoObra);
  const energia = sumarM(...lineasEquipo.map((l) => l.energia));
  const amortizaciones = sumarM(...lineasEquipo.map((l) => l.amortizacion));
  const otrosGastos = entrada.otrosGastos;

  if (entrada.minutosManoObra > 0 && entrada.valorHoraManoObra <= 0) {
    advertencias.push({
      motivo: MotivoIncompleto.SIN_VALOR_HORA,
      detalle:
        'El producto usa mano de obra pero no hay valor hora configurado. La mano de obra se conto como $ 0,00.',
    });
  }
  const usaEnergia = entrada.equipos.some((e) => e.minutosUso > 0 && e.consumoWatts > 0);
  if (usaEnergia && entrada.costoKwh <= 0) {
    advertencias.push({
      motivo: MotivoIncompleto.SIN_COSTO_KWH,
      detalle:
        'Hay equipos con tiempo de uso pero no hay costo del kWh configurado. La energia se conto como $ 0,00.',
    });
  }

  const costoProduccion = sumarM(manoObra, energia, amortizaciones, otrosGastos);

  /* --- Merma y costo total ---------------------------------------- */
  const subtotalCosto = sumarM(costoInsumos, costoProduccion);
  const merma = porcentajeDeM(subtotalCosto, entrada.porcentajeMerma);
  const costoTotalUnitario = sumarM(subtotalCosto, merma);

  /* --- Bloque 3: precio y rentabilidad ---------------------------- */
  const precioSugerido = calcularPrecioSugerido(costoTotalUnitario, entrada.margen);
  const precioVentaFinal = calcularPrecioVentaFinal(precioSugerido, entrada.comisionPlataforma);
  const montoComision = milicentavos(precioVentaFinal - precioSugerido);

  const gananciaUnitaria = milicentavos(precioSugerido - costoTotalUnitario);

  // Ambos porcentajes salen del mismo par de numeros y se muestran juntos en la UI,
  // que es la forma mas directa de que no se confunda uno con el otro.
  const margenRealSobreVenta =
    precioSugerido > 0 ? redondearPct((gananciaUnitaria / precioSugerido) * 100) : 0;
  const recargoSobreCosto =
    costoTotalUnitario > 0 ? redondearPct((gananciaUnitaria / costoTotalUnitario) * 100) : 0;

  return {
    lineasInsumo,
    lineasEquipo,
    costoInsumos,
    manoObra,
    energia,
    amortizaciones,
    otrosGastos,
    costoProduccion,
    subtotalCosto,
    porcentajeMerma: entrada.porcentajeMerma,
    merma,
    costoTotalUnitario,
    margen: entrada.margen,
    precioSugerido,
    comisionPlataforma: entrada.comisionPlataforma,
    montoComision,
    precioVentaFinal,
    gananciaUnitaria,
    margenRealSobreVenta,
    recargoSobreCosto,
    completo: advertencias.length === 0,
    advertencias,
  };
}

function redondearPct(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Puente entre las entidades del dominio y la entrada del motor       */
/* ------------------------------------------------------------------ */

export interface OverridesCosteo {
  porcentajeMerma?: number;
  margen?: number;
  comisionPlataforma?: number;
  otrosGastos?: Centavos;
  minutosManoObra?: number;
}

/**
 * Arma la EntradaCosteo desde las entidades. Lo usan la calculadora (con overrides
 * en vivo) y la emision del presupuesto (sin overrides).
 *
 * `comisionPlataforma` entra como override justamente porque es del canal de venta,
 * no del producto: la misma taza se cotiza por ML o en efectivo sin duplicarla.
 */
export function armarEntradaCosteo(
  producto: Pick<
    Producto,
    | 'insumos'
    | 'equipos'
    | 'minutosManoObra'
    | 'otrosGastos'
    | 'porcentajeMerma'
    | 'margen'
    | 'comisionPlataforma'
  >,
  insumos: readonly InsumoConPrecio[],
  equipos: readonly Equipo[],
  costos: CostosOperativos,
  overrides: OverridesCosteo = {},
): EntradaCosteo {
  const porId = new Map(insumos.map((i) => [i.id, i]));
  const equiposPorId = new Map(equipos.map((e) => [e.id, e]));

  const entradaInsumos: EntradaInsumo[] = producto.insumos.map((r) => {
    const insumo = porId.get(r.insumoId);
    if (!insumo) {
      // El insumo fue borrado o no vino en el lote. Se cuenta como sin precio en
      // vez de tirar el costeo entero.
      return {
        insumoId: r.insumoId,
        nombre: '(insumo no encontrado)',
        tipo: 'OTRO',
        unidadUso: 'UNIDAD',
        cantidad: r.cantidad,
        precioPorUnidadUso: null,
      };
    }
    return {
      insumoId: insumo.id,
      nombre: insumo.nombre,
      tipo: insumo.tipo,
      unidadUso: insumo.unidadUso,
      cantidad: r.cantidad,
      precioPorUnidadUso: insumo.precioVigente?.precioPorUnidadUso ?? null,
    };
  });

  const entradaEquipos: EntradaEquipo[] = producto.equipos.flatMap((r) => {
    const equipo = equiposPorId.get(r.equipoId);
    if (!equipo) return [];
    return [
      {
        equipoId: equipo.id,
        nombre: equipo.nombre,
        unidadesConsumidas: r.unidadesConsumidas,
        minutosUso: r.minutosUso,
        amortizacionPorUnidad: equipo.amortizacionPorUnidad,
        consumoWatts: equipo.consumoWatts,
      },
    ];
  });

  return {
    insumos: entradaInsumos,
    equipos: entradaEquipos,
    minutosManoObra: overrides.minutosManoObra ?? producto.minutosManoObra,
    valorHoraManoObra: aMilicentavos(costos.valorHoraManoObra),
    costoKwh: aMilicentavos(costos.costoKwh),
    otrosGastos: aMilicentavos(overrides.otrosGastos ?? producto.otrosGastos),
    porcentajeMerma: overrides.porcentajeMerma ?? producto.porcentajeMerma,
    margen: overrides.margen ?? producto.margen,
    comisionPlataforma: overrides.comisionPlataforma ?? producto.comisionPlataforma,
  };
}

/**
 * Comprime el resultado a centavos para guardarlo dentro del item del presupuesto.
 * Aca SI se redondea: a partir de este momento el numero es historia, no calculo.
 */
export function congelarCosteo(r: ResultadoCosteo): ResumenCosteoCongelado {
  return {
    costoInsumos: aCentavos(r.costoInsumos),
    manoObra: aCentavos(r.manoObra),
    energia: aCentavos(r.energia),
    amortizaciones: aCentavos(r.amortizaciones),
    otrosGastos: aCentavos(r.otrosGastos),
    merma: aCentavos(r.merma),
    porcentajeMerma: r.porcentajeMerma,
    margen: r.margen,
    comisionPlataforma: r.comisionPlataforma,
    detalleInsumos: r.lineasInsumo.map((l) => ({
      nombre: l.nombre,
      cantidad: l.cantidad,
      unidadUso: l.unidadUso,
      precioPorUnidadUso: l.precioPorUnidadUso === null ? null : aCentavos(l.precioPorUnidadUso),
      costo: aCentavos(l.costo),
    })),
  };
}
