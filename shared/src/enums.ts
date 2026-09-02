/** Enums del dominio. `as const` + type derivado: sirven igual en Mongoose y en Angular. */

export const TipoInsumo = {
  PRODUCTO_BASE: 'PRODUCTO_BASE',
  PAPEL: 'PAPEL',
  TINTA: 'TINTA',
  PACKAGING: 'PACKAGING',
  OTRO: 'OTRO',
} as const;
export type TipoInsumo = (typeof TipoInsumo)[keyof typeof TipoInsumo];

export const UnidadUso = {
  UNIDAD: 'UNIDAD',
  HOJA: 'HOJA',
  ML: 'ML',
  G: 'G',
  CM2: 'CM2',
} as const;
export type UnidadUso = (typeof UnidadUso)[keyof typeof UnidadUso];

export const TipoDescuento = {
  PORCENTAJE: 'PORCENTAJE',
  MONTO: 'MONTO',
} as const;
export type TipoDescuento = (typeof TipoDescuento)[keyof typeof TipoDescuento];

/**
 * MONOTRIBUTO no estaba en la especificacion original y es la condicion mas probable
 * para este negocio: no discrimina IVA, alicuota 0, el total es el neto.
 */
export const CondicionIva = {
  MONOTRIBUTO: 'MONOTRIBUTO',
  EXENTO: 'EXENTO',
  RESPONSABLE_INSCRIPTO: 'RESPONSABLE_INSCRIPTO',
} as const;
export type CondicionIva = (typeof CondicionIva)[keyof typeof CondicionIva];

export const EstadoPresupuesto = {
  BORRADOR: 'BORRADOR',
  ENVIADO: 'ENVIADO',
  ACEPTADO: 'ACEPTADO',
  RECHAZADO: 'RECHAZADO',
  VENCIDO: 'VENCIDO',
} as const;
export type EstadoPresupuesto = (typeof EstadoPresupuesto)[keyof typeof EstadoPresupuesto];

/** Motivos por los que un costeo sale incompleto. La UI los traduce a un cartel. */
export const MotivoIncompleto = {
  INSUMO_SIN_PRECIO: 'INSUMO_SIN_PRECIO',
  EQUIPO_SIN_VIDA_UTIL: 'EQUIPO_SIN_VIDA_UTIL',
  SIN_VALOR_HORA: 'SIN_VALOR_HORA',
  SIN_COSTO_KWH: 'SIN_COSTO_KWH',
} as const;
export type MotivoIncompleto = (typeof MotivoIncompleto)[keyof typeof MotivoIncompleto];

export const ALICUOTA_IVA_GENERAL = 21;

export const DEFAULTS = {
  PORCENTAJE_MERMA: 3,
  MARGEN: 50,
  COMISION_PLATAFORMA: 0,
  VALIDEZ_DIAS: 15,
  PORCENTAJE_SENIA: 50,
  /** Dias antes de considerar "viejo" el precio de un insumo en el listado. */
  DIAS_PRECIO_DESACTUALIZADO: 30,
} as const;

export const ETIQUETAS_UNIDAD_USO: Record<UnidadUso, string> = {
  UNIDAD: 'unidad',
  HOJA: 'hoja',
  ML: 'ml',
  G: 'g',
  CM2: 'cm²',
};

export const ETIQUETAS_TIPO_INSUMO: Record<TipoInsumo, string> = {
  PRODUCTO_BASE: 'Producto base',
  PAPEL: 'Papel',
  TINTA: 'Tinta',
  PACKAGING: 'Packaging',
  OTRO: 'Otro',
};

export const ETIQUETAS_ESTADO: Record<EstadoPresupuesto, string> = {
  BORRADOR: 'Borrador',
  ENVIADO: 'Enviado',
  ACEPTADO: 'Aceptado',
  RECHAZADO: 'Rechazado',
  VENCIDO: 'Vencido',
};
