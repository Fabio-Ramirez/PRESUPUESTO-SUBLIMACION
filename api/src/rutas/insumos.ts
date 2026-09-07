import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { TipoInsumo, TipoMovimientoStock, UnidadUso } from '@calc/shared';
import { InsumoModel } from '../models/index.js';
import { aInsumo } from '../dto/mapear.js';
import { rutasCrud } from '../http/crud.js';
import {
  datos,
  query,
  validarCuerpo,
  validarQuery,
  zCentavos,
  zFecha,
  zId,
} from '../http/validar.js';
import {
  historialPrecios,
  historialStock,
  listarConPrecios,
  registrarMovimientoStock,
  registrarPrecio,
  registrarPreciosEnLote,
  type DatosMovimientoStock,
  type DatosPrecio,
  type LineaLote,
} from '../servicios/insumos.js';

const zCrear = z.object({
  nombre: z.string().trim().min(1, 'El insumo necesita un nombre.'),
  tipo: z.enum(Object.values(TipoInsumo) as [string, ...string[]]),
  unidadUso: z.enum(Object.values(UnidadUso) as [string, ...string[]]),
  notas: z.string().trim().optional(),
  activo: z.boolean().optional(),
  /** Umbral del aviso de stock bajo. Sin cargar (u en 0), nunca se avisa. */
  stockMinimo: z.number().min(0, 'El minimo de stock no puede ser negativo.').optional(),
});

const zActualizar = zCrear.partial();

/** La presentacion es como se COMPRA: resma de 500 hojas, botella de 100 ml. */
const zPresentacion = z.object({
  cantidad: z.number().positive('La presentacion tiene que ser mayor a cero.'),
  unidad: z.enum(Object.values(UnidadUso) as [string, ...string[]]),
});

const zPrecio = z.object({
  presentacion: zPresentacion,
  precioPresentacion: zCentavos,
  proveedor: z.string().trim().optional(),
  fecha: zFecha.optional(),
});

const zLote = z.object({
  precios: z
    .array(zPrecio.extend({ insumoId: zId }))
    .min(1, 'La lista de precios vino vacia.'),
});

const zMovimientoStock = z.object({
  tipo: z.enum(Object.values(TipoMovimientoStock) as [string, ...string[]]),
  cantidad: z.number().positive('La cantidad tiene que ser mayor a cero.'),
  motivo: z.string().trim().optional(),
  fecha: zFecha.optional(),
});

export const rutasInsumos: Router = Router();

/**
 * Listado enriquecido: precio vigente, su fecha y el aviso de mas de 30 dias.
 * Va antes del CRUD generico porque es la vista que consumen las pantallas de
 * Insumos y de Actualizar precios.
 */
const zFiltroPrecios = z.object({
  soloActivos: z.enum(['true', 'false']).optional().transform((v) => v !== 'false'),
  soloDesactualizados: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  soloStockBajo: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  tipo: z.enum(Object.values(TipoInsumo) as [string, ...string[]]).optional(),
  busqueda: z.string().trim().min(1).optional(),
});

rutasInsumos.get(
  '/con-precios',
  validarQuery(zFiltroPrecios),
  async (_req: Request, res: Response) => {
    res.json({ datos: await listarConPrecios(query(res)) });
  },
);

/** Carga masiva: una lista entera del proveedor en un solo pedido. */
rutasInsumos.post('/precios/lote', validarCuerpo(zLote), async (_req: Request, res: Response) => {
  const { precios } = datos<{ precios: LineaLote[] }>(res);
  res.status(201).json(await registrarPreciosEnLote(precios));
});

rutasInsumos.get('/:id/precios', async (req: Request, res: Response) => {
  res.json({ datos: await historialPrecios(req.params['id'] as string) });
});

/** Un precio nuevo. El anterior no se toca: el historico es el punto. */
rutasInsumos.post(
  '/:id/precios',
  validarCuerpo(zPrecio),
  async (req: Request, res: Response) => {
    const precio = await registrarPrecio(req.params['id'] as string, datos<DatosPrecio>(res));
    res.status(201).json(precio);
  },
);

rutasInsumos.get('/:id/stock', async (req: Request, res: Response) => {
  res.json({ datos: await historialStock(req.params['id'] as string) });
});

/**
 * Una entrada o salida nueva. Nunca se pisa un movimiento anterior: el stock
 * actual es la suma de todo el historico, igual que con los precios.
 */
rutasInsumos.post(
  '/:id/stock',
  validarCuerpo(zMovimientoStock),
  async (req: Request, res: Response) => {
    const movimiento = await registrarMovimientoStock(
      req.params['id'] as string,
      datos<DatosMovimientoStock>(res),
    );
    res.status(201).json(movimiento);
  },
);

rutasInsumos.use(
  rutasCrud(InsumoModel, {
    nombre: 'el insumo',
    esquemaCrear: zCrear,
    esquemaActualizar: zActualizar,
    mapear: aInsumo as (d: never) => unknown,
    orden: { tipo: 1, nombre: 1 },
  }),
);
