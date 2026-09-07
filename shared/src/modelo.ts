import type { Centavos, Milicentavos } from './dinero.js';
import type {
  CondicionIva,
  EstadoPresupuesto,
  MotivoIncompleto,
  TipoDescuento,
  TipoInsumo,
  TipoMovimientoStock,
  UnidadUso,
} from './enums.js';

/**
 * Estas interfaces son el CONTRATO DE TRANSPORTE (lo que viaja API <-> front),
 * no los documentos de Mongo. Por eso las fechas son strings ISO y los ids strings.
 * Los esquemas Mongoose declaran sus propias interfaces con Date/ObjectId y exponen
 * un mapper a estos tipos. Asi el front nunca importa nada de mongoose.
 */
export type Id = string;

/** ISO 8601 en UTC. Se formatea a DD/MM/AAAA (America/Argentina/Buenos_Aires) al mostrar. */
export type FechaIso = string;

/**
 * Preparacion para multi-usuario sin rehacer esquemas despues.
 * Hoy vale siempre ORG_UNICA; el dia que haya login se llena de verdad y los
 * indices compuestos { organizacionId, ... } ya estan puestos.
 */
export const ORG_UNICA = 'org-unica';

export interface EntidadBase {
  id: Id;
  organizacionId: Id;
  creadoEn: FechaIso;
  actualizadoEn: FechaIso;
}

/* ------------------------------------------------------------------ */
/* Insumos y precios                                                   */
/* ------------------------------------------------------------------ */

/** Que es el insumo. Nunca cuanto sale: eso vive en PrecioInsumo. */
export interface Insumo extends EntidadBase {
  nombre: string;
  tipo: TipoInsumo;
  unidadUso: UnidadUso;
  activo: boolean;
  notas?: string;
  /**
   * Minimo para el aviso de stock bajo, en unidades de `unidadUso`. Sin cargar
   * (o en 0) el insumo nunca se marca en stock bajo, sin importar cuanto tenga.
   */
  stockMinimo?: number;
}

/** Como se compra: resma de 100 hojas, botella de 100 ml, caja de 6 unidades. */
export interface Presentacion {
  cantidad: number;
  unidad: UnidadUso;
}

/**
 * Historico. Un documento por actualizacion, nunca se pisa: el vigente es el de
 * fecha mas reciente. Sin esto, un presupuesto de hace dos meses se recalcularia
 * solo y dejaria de decir lo que decia.
 */
export interface PrecioInsumo extends EntidadBase {
  insumoId: Id;
  fecha: FechaIso;
  presentacion: Presentacion;
  /** Lo que pagaste por la presentacion completa. */
  precioPresentacion: Centavos;
  /** Derivado: precioPresentacion / presentacion.cantidad. Se persiste y NO se recalcula. */
  precioPorUnidadUso: Milicentavos;
  proveedor?: string;
}

/**
 * Insumo + su precio vigente y su stock resueltos. Lo que consume el listado y
 * la calculadora.
 */
export interface InsumoConPrecio extends Insumo {
  precioVigente: PrecioInsumo | null;
  /** Dias transcurridos desde el precio vigente. null si nunca tuvo precio. */
  diasDesdeUltimoPrecio: number | null;
  precioDesactualizado: boolean;
  /** Suma de entradas menos salidas. Puede dar negativo si se cargo de menos. */
  stockActual: number;
  /** true solo si hay `stockMinimo` cargado (> 0) y `stockActual` esta por debajo. */
  stockBajo: boolean;
}

/**
 * Movimiento de stock. Historico igual que PrecioInsumo: nunca se edita ni se
 * borra, se agrega uno nuevo — asi el stock actual (la suma) siempre coincide
 * con "por que" llego a ese numero.
 */
export interface MovimientoStock extends EntidadBase {
  insumoId: Id;
  fecha: FechaIso;
  tipo: TipoMovimientoStock;
  /** Siempre positivo. El signo con el que afecta el stock lo da `tipo`. */
  cantidad: number;
  motivo?: string;
}

/* ------------------------------------------------------------------ */
/* Equipos                                                             */
/* ------------------------------------------------------------------ */

/**
 * Impresora, plancha, corte. La amortizacion se DERIVA de costo / vida util:
 * en la planilla eran montos fijos que quedaban viejos apenas cambiaba un equipo.
 */
export interface Equipo extends EntidadBase {
  nombre: string;
  costoAdquisicion: Centavos;
  /** Piezas que se estima que produce en toda su vida. Debe ser > 0. */
  vidaUtilUnidades: number;
  fechaCompra: FechaIso;
  /**
   * Consumo electrico. Vive en el equipo, no en la configuracion global:
   * una plancha de 1400 W y una impresora de 30 W no pueden compartir un unico
   * "consumo estimado".
   */
  consumoWatts: number;
  /** Derivado: costoAdquisicion / vidaUtilUnidades. Recalculado en cada guardado. */
  amortizacionPorUnidad: Milicentavos;
  activo: boolean;
}

/* ------------------------------------------------------------------ */
/* Configuracion (singleton)                                           */
/* ------------------------------------------------------------------ */

/**
 * Un unico singleton en vez de Empresa + CostoOperativo por separado: tienen la
 * misma vida util, se editan en la misma pantalla y nunca hay mas de uno de cada
 * uno. Agrupado en tres bloques que son las tres secciones del formulario.
 */
export interface Configuracion extends EntidadBase {
  empresa: DatosEmpresa;
  costos: CostosOperativos;
  presupuestos: DefaultsPresupuesto;
}

/** Datos del emisor. Es exactamente lo que va en el encabezado del PDF. */
export interface DatosEmpresa {
  nombre: string;
  cuit: string;
  direccion: string;
  whatsapp: string;
  email: string;
  /** Data URI. Se embebe en el PDF, que asi no depende de ningun archivo externo. */
  logo?: string;
  condicionIva: CondicionIva;
}

export interface CostosOperativos {
  valorHoraManoObra: Centavos;
  costoKwh: Centavos;
}

export interface DefaultsPresupuesto {
  condicionesGeneralesPorDefecto: string;
  validezDiasPorDefecto: number;
  porcentajeSeniaPorDefecto: number;
  tramosDescuentoPorDefecto: TramoDescuento[];
  /** El "000" de 000-001. */
  puntoVenta: number;
  proximoNumeroPresupuesto: number;
}

/* ------------------------------------------------------------------ */
/* Producto (la receta de costeo)                                      */
/* ------------------------------------------------------------------ */

export interface RecetaInsumo {
  insumoId: Id;
  /** En unidades de uso del insumo. Puede ser fraccionaria: 0,5 hoja; 1,8 ml. */
  cantidad: number;
}

export interface RecetaEquipo {
  equipoId: Id;
  /** Cuantas "piezas" de vida util consume esta unidad de producto. */
  unidadesConsumidas: number;
  /** Minutos que el equipo esta encendido para esta unidad. Alimenta la energia. */
  minutosUso: number;
}

/** Descuento automatico por volumen. Se aplica el tramo de mayor `desdeCantidad` alcanzado. */
export interface TramoDescuento {
  desdeCantidad: number;
  porcentaje: number;
}

export interface Producto extends EntidadBase {
  nombre: string;
  categoria: string;
  insumos: RecetaInsumo[];
  equipos: RecetaEquipo[];
  minutosManoObra: number;
  otrosGastos: Centavos;
  porcentajeMerma: number;
  margen: number;
  /**
   * Valor por defecto. El motor lo recibe como parametro, asi la misma taza se
   * cotiza por MercadoLibre (13%) o en efectivo (0%) sin duplicar el producto.
   */
  comisionPlataforma: number;
  tramosDescuento: TramoDescuento[];
  activo: boolean;
}

/* ------------------------------------------------------------------ */
/* Clientes y empresa                                                  */
/* ------------------------------------------------------------------ */

export interface Cliente extends EntidadBase {
  nombreRazonSocial: string;
  cuitDni?: string;
  direccion?: string;
  localidad?: string;
  telefono?: string;
  email?: string;
  activo: boolean;
}

/** Los datos del cliente congelados dentro del presupuesto. */
export type ClienteSnapshot = Omit<Cliente, keyof EntidadBase> & { clienteId: Id | null };

/* ------------------------------------------------------------------ */
/* Presupuesto                                                         */
/* ------------------------------------------------------------------ */

export interface DescuentoPresupuesto {
  tipo: TipoDescuento;
  /** Porcentaje (10 = 10%) o monto en centavos, segun `tipo`. */
  valor: number;
  /** Resuelto siempre a plata. Es lo que se resta. */
  monto: Centavos;
  /** true si lo puso el motor por tramos; false si lo escribio el usuario. */
  automatico: boolean;
}

export interface IvaPresupuesto {
  condicion: CondicionIva;
  alicuota: number;
  monto: Centavos;
}

export interface ItemPresupuesto {
  productoId: Id | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: Centavos;
  subtotal: Centavos;
  /**
   * Costo congelado al momento de emitir. Es lo que permite saber, meses despues,
   * que margen real tuvo cada trabajo aunque los insumos hayan subido.
   */
  costoUnitarioAlMomento: Centavos;
  /** El desglose completo del costeo, para poder auditar el numero de arriba. */
  costeoAlMomento?: ResumenCosteoCongelado;
  costeoIncompleto: boolean;
}

/** Version serializable y compacta del ResultadoCosteo, en centavos. */
export interface ResumenCosteoCongelado {
  costoInsumos: Centavos;
  manoObra: Centavos;
  energia: Centavos;
  amortizaciones: Centavos;
  otrosGastos: Centavos;
  merma: Centavos;
  porcentajeMerma: number;
  margen: number;
  comisionPlataforma: number;
  detalleInsumos: Array<{
    nombre: string;
    cantidad: number;
    unidadUso: UnidadUso;
    precioPorUnidadUso: Centavos | null;
    costo: Centavos;
  }>;
}

export interface Presupuesto extends EntidadBase {
  /** null mientras es BORRADOR. Se asigna recien al pasar a ENVIADO. */
  numero: string | null;
  fecha: FechaIso;
  validezDias: number;
  /** Derivado: fecha + validezDias. */
  validoHasta: FechaIso;
  cliente: ClienteSnapshot;
  items: ItemPresupuesto[];
  subtotal: Centavos;
  descuento: DescuentoPresupuesto | null;
  neto: Centavos;
  iva: IvaPresupuesto;
  total: Centavos;
  porcentajeSenia: number;
  montoSenia: Centavos;
  saldoContraEntrega: Centavos;
  condicionesGenerales: string;
  estado: EstadoPresupuesto;
  /**
   * Derivado, nunca persistido: ENVIADO + vencido => VENCIDO.
   * Calcularlo evita que un simple listado dispare escrituras.
   */
  estadoEfectivo: EstadoPresupuesto;
  notasInternas?: string;
  fechaEnvio?: FechaIso;
  /** Si nacio de "duplicar con precios actuales". */
  duplicadoDeId?: Id;
}

/* ------------------------------------------------------------------ */
/* Resultado del motor de costeo                                       */
/* ------------------------------------------------------------------ */

export interface LineaCosteoInsumo {
  insumoId: Id;
  nombre: string;
  tipo: TipoInsumo;
  unidadUso: UnidadUso;
  cantidad: number;
  precioPorUnidadUso: Milicentavos | null;
  costo: Milicentavos;
  /** true si el insumo no tiene precio cargado: suma 0 y marca el total como parcial. */
  sinPrecio: boolean;
}

export interface LineaCosteoEquipo {
  equipoId: Id;
  nombre: string;
  unidadesConsumidas: number;
  minutosUso: number;
  amortizacion: Milicentavos;
  energia: Milicentavos;
}

export interface Advertencia {
  motivo: MotivoIncompleto;
  detalle: string;
}

export interface ResultadoCosteo {
  lineasInsumo: LineaCosteoInsumo[];
  lineasEquipo: LineaCosteoEquipo[];

  /** Bloque 1: insumos */
  costoInsumos: Milicentavos;

  /** Bloque 2: produccion */
  manoObra: Milicentavos;
  energia: Milicentavos;
  amortizaciones: Milicentavos;
  otrosGastos: Milicentavos;
  costoProduccion: Milicentavos;

  subtotalCosto: Milicentavos;
  porcentajeMerma: number;
  merma: Milicentavos;
  costoTotalUnitario: Milicentavos;

  /** Bloque 3: precio y rentabilidad */
  margen: number;
  precioSugerido: Milicentavos;
  comisionPlataforma: number;
  montoComision: Milicentavos;
  precioVentaFinal: Milicentavos;

  gananciaUnitaria: Milicentavos;
  /** Deberia dar igual a `margen`. Sirve para mostrar la verificacion en pantalla. */
  margenRealSobreVenta: number;
  /**
   * El numero que evita el error clasico: con margen 50% el recargo sobre el costo
   * es 100%, no 50%. La UI muestra los dos juntos.
   */
  recargoSobreCosto: number;

  /** false si algo falto. El costeo NO falla: calcula igual y avisa que es parcial. */
  completo: boolean;
  advertencias: Advertencia[];
}
