import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { DEFAULTS } from '@calc/shared';
import {
  datos,
  validarCuerpo,
  zCantidad,
  zCentavos,
  zId,
  zPorcentaje,
  zPorcentajeDivisor,
} from '../http/validar.js';
import { costearReceta, type RecetaAdHoc } from '../servicios/costeo.js';

/**
 * La Calculadora: costea una receta que todavia no es un producto guardado.
 *
 * Es POST y no GET porque la receta es una estructura, no un puñado de parametros.
 * El front la llama con cada cambio, asi que el servicio resuelve todo en 4
 * consultas fijas sin importar cuantos insumos tenga.
 */
const zReceta = z.object({
  insumos: z.array(z.object({ insumoId: zId, cantidad: zCantidad })).default([]),
  equipos: z
    .array(
      z.object({
        equipoId: zId,
        unidadesConsumidas: z.number().min(0).default(1),
        minutosUso: z.number().min(0).default(0),
      }),
    )
    .default([]),
  minutosManoObra: z.number().min(0).default(0),
  otrosGastos: zCentavos.default(0),
  porcentajeMerma: zPorcentaje.default(DEFAULTS.PORCENTAJE_MERMA),
  /** Sobre el precio de venta. Con 50% el precio es el doble del costo. */
  margen: zPorcentajeDivisor.default(DEFAULTS.MARGEN),
  /** Del canal de venta (ML, MercadoPago, efectivo), no del producto. */
  comisionPlataforma: zPorcentajeDivisor.default(DEFAULTS.COMISION_PLATAFORMA),
});

export const rutasCosteo: Router = Router();

rutasCosteo.post('/', validarCuerpo(zReceta), async (_req: Request, res: Response) => {
  res.json(await costearReceta(datos<RecetaAdHoc>(res)));
});
