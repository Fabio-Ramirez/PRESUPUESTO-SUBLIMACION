import { Schema } from 'mongoose';
import { ORG_UNICA } from '@calc/shared';

/**
 * Piezas compartidas por todos los esquemas.
 *
 * Los helpers devuelven objetos literales SIN anotar el tipo de retorno: anotarlos
 * como SchemaDefinitionProperty<number> borra la forma literal y `InferSchemaType`
 * deja de poder derivar el tipo del documento.
 */

/**
 * Todos los montos se guardan como ENTEROS. Mongo tiene Decimal128, pero obliga a
 * convertir en cada lectura y no evita que alguien escriba 0,1 + 0,2. Un entero de
 * centavos (o milicentavos) es exacto por construccion y se suma en agregaciones
 * sin ninguna conversion.
 *
 * `porDefecto` en null hace el campo obligatorio (hay que cargarlo);
 * en 0, opcional con arranque en cero.
 */
export function campoMonto(unidad: 'centavos' | 'milicentavos', porDefecto: number | null = null) {
  return {
    type: Number,
    required: true as const,
    ...(porDefecto === null ? {} : { default: porDefecto }),
    validate: {
      validator: Number.isInteger,
      message: `{PATH} tiene que ser un entero en ${unidad}, llego {VALUE}.`,
    },
  };
}

export function campoPorcentaje(porDefecto: number, max = 100, mensajeMax?: string) {
  return {
    type: Number,
    required: true as const,
    default: porDefecto,
    min: [0, 'El porcentaje no puede ser negativo.'] as [number, string],
    max: [max, mensajeMax ?? `El porcentaje no puede pasar de ${max}.`] as [number, string],
  };
}

/**
 * Discriminante de organizacion. Hoy vale siempre la misma constante y no hay login;
 * esta desde ahora para que agregar multi-usuario sea llenar el campo y no migrar
 * ocho colecciones con sus indices.
 */
export function campoOrganizacion(unico = false) {
  return {
    type: String,
    required: true as const,
    default: ORG_UNICA,
    index: true as const,
    ...(unico ? { unique: true as const } : {}),
  };
}

/**
 * Opciones base: timestamps y una salida JSON estable (id en vez de _id, sin __v).
 * El front recibe siempre la misma forma, sin saber que hay mongoose atras.
 */
export const opcionesBase = {
  timestamps: { createdAt: 'creadoEn', updatedAt: 'actualizadoEn' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform(_doc: unknown, ret: Record<string, unknown>) {
      ret['id'] = String(ret['_id']);
      delete ret['_id'];
      return ret;
    },
  },
  toObject: { virtuals: true },
} as const;

export const esquemaTramoDescuento = new Schema(
  {
    desdeCantidad: { type: Number, required: true, min: 1 },
    porcentaje: campoPorcentaje(0),
  },
  { _id: false },
);
