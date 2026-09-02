import { Router } from 'express';
import { z } from 'zod';
import { ClienteModel } from '../models/index.js';
import { aCliente } from '../dto/mapear.js';
import { rutasCrud } from '../http/crud.js';

const zCrear = z.object({
  nombreRazonSocial: z.string().trim().min(1, 'El cliente necesita un nombre o razon social.'),
  // '' -> undefined: el indice parcial de cuitDni excluye los documentos donde el
  // campo directamente no existe, pero SI indexaria un string vacio guardado a
  // proposito, y dos clientes con cuitDni:"" volverian a chocar entre si.
  cuitDni: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  direccion: z.string().trim().optional(),
  localidad: z.string().trim().optional(),
  telefono: z.string().trim().optional(),
  email: z.email('El email no es valido.').optional().or(z.literal('')),
  activo: z.boolean().optional(),
});

export const rutasClientes: Router = rutasCrud(ClienteModel, {
  nombre: 'el cliente',
  esquemaCrear: zCrear,
  esquemaActualizar: zCrear.partial(),
  mapear: aCliente as (d: never) => unknown,
  orden: { nombreRazonSocial: 1 },
  camposBusqueda: ['nombreRazonSocial', 'cuitDni', 'email'],
});
