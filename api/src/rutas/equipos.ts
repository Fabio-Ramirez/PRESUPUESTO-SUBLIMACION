import { Router } from 'express';
import { z } from 'zod';
import { EquipoModel } from '../models/index.js';
import { aEquipo } from '../dto/mapear.js';
import { rutasCrud } from '../http/crud.js';
import { zCentavos, zFecha } from '../http/validar.js';

/**
 * La amortizacion por unidad NO se recibe: la deriva el esquema de costo / vida util.
 * Si se pudiera mandar por HTTP, volveria el problema de la planilla, donde era un
 * numero escrito a mano que quedaba viejo.
 */
const zCrear = z.object({
  nombre: z.string().trim().min(1, 'El equipo necesita un nombre.'),
  costoAdquisicion: zCentavos,
  vidaUtilUnidades: z
    .number()
    .int()
    .min(1, 'La vida util tiene que ser de al menos 1 unidad.'),
  /** Consumo electrico: es lo que permite calcular la energia de cada equipo. */
  consumoWatts: z.number().min(0).default(0),
  fechaCompra: zFecha.optional(),
  activo: z.boolean().optional(),
});

export const rutasEquipos: Router = rutasCrud(EquipoModel, {
  nombre: 'el equipo',
  esquemaCrear: zCrear,
  esquemaActualizar: zCrear.partial(),
  mapear: aEquipo as (d: never) => unknown,
});
