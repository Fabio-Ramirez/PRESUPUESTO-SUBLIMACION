import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { campoOrganizacion, opcionesBase } from './comun.js';

const esquemaCliente = new Schema(
  {
    organizacionId: campoOrganizacion(),
    nombreRazonSocial: { type: String, required: true, trim: true },
    cuitDni: { type: String, trim: true },
    direccion: { type: String, trim: true },
    localidad: { type: String, trim: true },
    telefono: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    activo: { type: Boolean, required: true, default: true },
  },
  opcionesBase,
);

// Busqueda por nombre en el selector del presupuesto.
esquemaCliente.index({ organizacionId: 1, nombreRazonSocial: 1 });

/**
 * Un CUIT repetido casi siempre es el mismo cliente cargado dos veces — pero el
 * consumidor final se carga sin CUIT, y esos no tienen que chocar entre si.
 *
 * `sparse` NO alcanza aca porque el indice es compuesto: sparse solo excluye un
 * documento cuando TODOS sus campos faltan, y `organizacionId` nunca falta (tiene
 * default). Entonces cada cliente sin CUIT quedaba igual indexado como
 * { organizacionId, cuitDni: null }, y el segundo chocaba con el primero — asi
 * que en la practica no se podia cargar mas de un cliente sin CUIT.
 *
 * `partialFilterExpression` es preciso: solo entran al indice los documentos
 * donde cuitDni existe y es un string. Sin CUIT, el documento queda afuera del
 * indice por completo, sin importar los demas campos.
 */
esquemaCliente.index(
  { organizacionId: 1, cuitDni: 1 },
  { unique: true, partialFilterExpression: { cuitDni: { $type: 'string' } } },
);

export type ClienteDoc = HydratedDocument<InferSchemaType<typeof esquemaCliente>>;
export const ClienteModel = model('Cliente', esquemaCliente);
