import {
  centavos,
  porcentajeDeC,
  sumarC,
  CERO_C,
  type Centavos,
} from '../dinero.js';
import {
  ALICUOTA_IVA_GENERAL,
  CondicionIva,
  EstadoPresupuesto,
  TipoDescuento,
} from '../enums.js';
import type {
  DescuentoPresupuesto,
  ItemPresupuesto,
  TramoDescuento,
} from '../modelo.js';
import { inicioDelDiaAr } from './derivados.js';

/**
 * Totales del presupuesto. A diferencia del costeo, aca se trabaja en CENTAVOS:
 * son montos ya asentados, no cocientes, y tienen que cerrar exactamente con lo
 * que el cliente lee en el PDF.
 */

/** subtotal del item = precioUnitario x cantidad */
export function calcularSubtotalItem(precioUnitario: Centavos, cantidad: number): Centavos {
  return centavos(precioUnitario * cantidad);
}

/**
 * Tramo que corresponde a una cantidad: el de mayor `desdeCantidad` alcanzado.
 * Devuelve 0 si no llega a ninguno.
 */
export function porcentajeDeTramo(cantidad: number, tramos: readonly TramoDescuento[]): number {
  let pct = 0;
  let mejorDesde = -1;
  for (const t of tramos) {
    if (cantidad >= t.desdeCantidad && t.desdeCantidad > mejorDesde) {
      mejorDesde = t.desdeCantidad;
      pct = t.porcentaje;
    }
  }
  return pct;
}

/**
 * Descuento automatico por cantidad, sugerido para el presupuesto entero.
 *
 * Los tramos son por producto y la cantidad relevante es la de cada linea, asi que
 * se resuelve linea por linea y se suma. El resultado se propone como un descuento
 * de tipo MONTO —queda un solo renglon "Descuento por cantidad" en el PDF, como en
 * la planilla— y el usuario lo puede pisar a mano.
 */
export function calcularDescuentoAutomatico(
  items: readonly Pick<ItemPresupuesto, 'cantidad' | 'subtotal' | 'productoId'>[],
  tramosPorProducto: ReadonlyMap<string, readonly TramoDescuento[]>,
  tramosPorDefecto: readonly TramoDescuento[] = [],
): DescuentoPresupuesto | null {
  let monto = CERO_C;
  for (const item of items) {
    const tramos =
      (item.productoId ? tramosPorProducto.get(item.productoId) : undefined) ?? tramosPorDefecto;
    const pct = porcentajeDeTramo(item.cantidad, tramos);
    if (pct > 0) monto = sumarC(monto, porcentajeDeC(item.subtotal, pct));
  }
  if (monto <= 0) return null;
  return { tipo: TipoDescuento.MONTO, valor: monto, monto, automatico: true };
}

/** Resuelve un descuento (porcentual o fijo) a plata, acotado al subtotal. */
export function resolverMontoDescuento(
  descuento: Pick<DescuentoPresupuesto, 'tipo' | 'valor'>,
  subtotal: Centavos,
): Centavos {
  const bruto =
    descuento.tipo === TipoDescuento.PORCENTAJE
      ? porcentajeDeC(subtotal, descuento.valor)
      : centavos(descuento.valor);
  if (bruto <= 0) return CERO_C;
  // Un descuento mayor al subtotal daria un total negativo. Se topea.
  return (bruto > subtotal ? subtotal : bruto) as Centavos;
}

export function alicuotaDe(condicion: CondicionIva): number {
  // Monotributo y exento no discriminan IVA: el total es el neto.
  return condicion === CondicionIva.RESPONSABLE_INSCRIPTO ? ALICUOTA_IVA_GENERAL : 0;
}

export interface TotalesPresupuesto {
  subtotal: Centavos;
  descuento: DescuentoPresupuesto | null;
  neto: Centavos;
  iva: { condicion: CondicionIva; alicuota: number; monto: Centavos };
  total: Centavos;
  porcentajeSenia: number;
  montoSenia: Centavos;
  saldoContraEntrega: Centavos;
}

/**
 * El orden importa y es el mismo que muestra el PDF:
 *   subtotal -> descuento -> neto -> IVA -> TOTAL -> senia -> saldo
 * El IVA se calcula sobre el NETO (despues del descuento), que es como corresponde.
 */
export function calcularTotales(
  items: readonly Pick<ItemPresupuesto, 'subtotal'>[],
  descuentoPedido: Pick<DescuentoPresupuesto, 'tipo' | 'valor' | 'automatico'> | null,
  condicionIva: CondicionIva,
  porcentajeSenia: number,
): TotalesPresupuesto {
  const subtotal = sumarC(...items.map((i) => i.subtotal));

  let descuento: DescuentoPresupuesto | null = null;
  if (descuentoPedido && descuentoPedido.valor > 0) {
    descuento = {
      tipo: descuentoPedido.tipo,
      valor: descuentoPedido.valor,
      monto: resolverMontoDescuento(descuentoPedido, subtotal),
      automatico: descuentoPedido.automatico,
    };
  }

  const neto = centavos(subtotal - (descuento?.monto ?? 0));
  const alicuota = alicuotaDe(condicionIva);
  const montoIva = porcentajeDeC(neto, alicuota);
  const total = sumarC(neto, montoIva);

  const montoSenia = porcentajeDeC(total, porcentajeSenia);
  const saldoContraEntrega = centavos(total - montoSenia);

  return {
    subtotal,
    descuento,
    neto,
    iva: { condicion: condicionIva, alicuota, monto: montoIva },
    total,
    porcentajeSenia,
    montoSenia,
    saldoContraEntrega,
  };
}

/**
 * VENCIDO es derivado, no persistido.
 *
 * La regla original decia "se marca VENCIDO al consultarlo", pero eso hace que abrir
 * un listado dispare N escrituras y ensucia el historial. Calcularlo da el mismo
 * resultado visible sin efectos de lado en una lectura. Solo un ENVIADO vence:
 * un ACEPTADO ya cerro y un BORRADOR todavia no salio.
 */
export function resolverEstadoEfectivo(
  estado: EstadoPresupuesto,
  validoHasta: Date | string,
  ahora: Date = new Date(),
): EstadoPresupuesto {
  if (estado !== EstadoPresupuesto.ENVIADO) return estado;
  const limite = typeof validoHasta === 'string' ? new Date(validoHasta) : validoHasta;
  // Vence al terminar su ultimo dia en Argentina, no antes por el offset UTC.
  return inicioDelDiaAr(ahora) > inicioDelDiaAr(limite)
    ? EstadoPresupuesto.VENCIDO
    : EstadoPresupuesto.ENVIADO;
}

/** Transiciones permitidas. El numero se asigna justo en BORRADOR -> ENVIADO. */
const TRANSICIONES: Record<EstadoPresupuesto, readonly EstadoPresupuesto[]> = {
  BORRADOR: [EstadoPresupuesto.ENVIADO],
  ENVIADO: [EstadoPresupuesto.ACEPTADO, EstadoPresupuesto.RECHAZADO, EstadoPresupuesto.VENCIDO],
  ACEPTADO: [],
  RECHAZADO: [],
  VENCIDO: [EstadoPresupuesto.ACEPTADO, EstadoPresupuesto.RECHAZADO],
};

export function puedeTransicionar(
  desde: EstadoPresupuesto,
  hacia: EstadoPresupuesto,
): boolean {
  return TRANSICIONES[desde].includes(hacia);
}
