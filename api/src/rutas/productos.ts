import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { DEFAULTS } from '@calc/shared';
import { ProductoModel } from '../models/index.js';
import { aProducto } from '../dto/mapear.js';
import { rutasCrud } from '../http/crud.js';
import {
  query,
  validarQuery,
  zCantidad,
  zCentavos,
  zId,
  zPorcentaje,
  zPorcentajeDivisor,
  zTramosDescuento,
} from '../http/validar.js';
import { costearProducto } from '../servicios/costeo.js';

const zCrear = z.object({
  nombre: z.string().trim().min(1, 'El producto necesita un nombre.'),
  categoria: z.string().trim().default('General'),
  insumos: z
    .array(z.object({ insumo: zId, cantidad: zCantidad }))
    .default([]),
  equipos: z
    .array(
      z.object({
        equipo: zId,
        unidadesConsumidas: z.number().min(0).default(1),
        /** Minutos encendido por unidad producida. Alimenta el calculo de energia. */
        minutosUso: z.number().min(0).default(0),
      }),
    )
    .default([]),
  minutosManoObra: z.number().min(0).default(0),
  otrosGastos: zCentavos.default(0),
  porcentajeMerma: zPorcentaje.default(DEFAULTS.PORCENTAJE_MERMA),
  /** Sobre el precio de venta, no recargo sobre el costo. */
  margen: zPorcentajeDivisor.default(DEFAULTS.MARGEN),
  comisionPlataforma: zPorcentajeDivisor.default(DEFAULTS.COMISION_PLATAFORMA),
  tramosDescuento: zTramosDescuento.default([]),
  activo: z.boolean().optional(),
});

export const rutasProductos: Router = Router();

/**
 * Costeo desglosado del producto, con overrides opcionales.
 *
 * Es lo que consume la pantalla de Productos para mostrar el desglose mientras se
 * edita, y la Calculadora cuando se parte de un producto guardado. Los overrides
 * permiten mover margen o comision sin tocar el producto: la comision es del canal
 * de venta, no del producto.
 */
const zOverrides = z.object({
  margen: z.coerce.number().pipe(zPorcentajeDivisor).optional(),
  comisionPlataforma: z.coerce.number().pipe(zPorcentajeDivisor).optional(),
  porcentajeMerma: z.coerce.number().pipe(zPorcentaje).optional(),
  otrosGastos: z.coerce.number().pipe(zCentavos).optional(),
  minutosManoObra: z.coerce.number().min(0).optional(),
});

rutasProductos.get(
  '/:id/costeo',
  validarQuery(zOverrides),
  async (req: Request, res: Response) => {
    const resultado = await costearProducto(req.params['id'] as string, query(res));
    res.json(resultado);
  },
);

rutasProductos.use(
  rutasCrud(ProductoModel, {
    nombre: 'el producto',
    esquemaCrear: zCrear,
    esquemaActualizar: zCrear.partial(),
    mapear: aProducto as (d: never) => unknown,
    orden: { categoria: 1, nombre: 1 },
    camposBusqueda: ['nombre', 'categoria'],
  }),
);
