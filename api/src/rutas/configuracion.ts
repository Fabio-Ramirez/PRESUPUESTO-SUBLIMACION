import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { CondicionIva, ORG_UNICA, formatearNumeroPresupuesto } from '@calc/shared';
import { ConfiguracionModel, obtenerConfiguracion } from '../models/configuracion.js';
import { aConfiguracion } from '../dto/mapear.js';
import { datos, validarCuerpo, zCentavos, zPorcentaje, zTramosDescuento } from '../http/validar.js';

/**
 * Configuracion: un unico singleton con los datos del emisor, los costos operativos
 * y los valores por defecto de los presupuestos.
 *
 * `proximoNumeroPresupuesto` NO se puede editar por esta via: lo maneja
 * `tomarNumeroPresupuesto` con un $inc atomico, y dejarlo escribir a mano seria la
 * forma mas facil de romper la correlatividad.
 */
const zActualizar = z.object({
  empresa: z
    .object({
      nombre: z.string().trim().optional(),
      cuit: z.string().trim().optional(),
      direccion: z.string().trim().optional(),
      whatsapp: z.string().trim().optional(),
      email: z.string().trim().optional(),
      /** Data URI del logo: el PDF queda autocontenido. */
      logo: z.string().optional(),
      condicionIva: z.enum(Object.values(CondicionIva) as [string, ...string[]]).optional(),
    })
    .optional(),
  costos: z
    .object({
      valorHoraManoObra: zCentavos.optional(),
      costoKwh: zCentavos.optional(),
    })
    .optional(),
  presupuestos: z
    .object({
      condicionesGeneralesPorDefecto: z.string().optional(),
      validezDiasPorDefecto: z.number().int().min(1).optional(),
      porcentajeSeniaPorDefecto: zPorcentaje.optional(),
      tramosDescuentoPorDefecto: zTramosDescuento.optional(),
      puntoVenta: z.number().int().min(0).optional(),
    })
    .optional(),
});
type Actualizar = z.infer<typeof zActualizar>;

export const rutasConfiguracion: Router = Router();

rutasConfiguracion.get('/', async (_req: Request, res: Response) => {
  res.json(aConfiguracion(await obtenerConfiguracion()));
});

rutasConfiguracion.put('/', validarCuerpo(zActualizar), async (_req: Request, res: Response) => {
  const cambios = datos<Actualizar>(res);
  const doc = await obtenerConfiguracion();

  /**
   * Merge campo por campo con paths ("empresa.nombre"), no bloque por bloque.
   * Asignar el subdocumento entero borraria los campos que el front no mando:
   * guardar solo el costo del kWh no puede vaciar los datos de la empresa.
   */
  const paths: Record<string, unknown> = {};
  for (const [bloque, valores] of Object.entries(cambios)) {
    if (!valores) continue;
    for (const [campo, valor] of Object.entries(valores)) {
      if (valor !== undefined) paths[`${bloque}.${campo}`] = valor;
    }
  }
  doc.set(paths);

  await doc.save();
  res.json(aConfiguracion(doc));
});

/**
 * Diagnostico: que numero le va a tocar al proximo presupuesto que se emita.
 * Solo lectura, no reserva nada.
 */
rutasConfiguracion.get('/proximo-numero', async (_req: Request, res: Response) => {
  const doc = await ConfiguracionModel.findOne({ organizacionId: ORG_UNICA });
  res.json({
    proximoNumero: formatearNumeroPresupuesto(
      doc?.presupuestos.puntoVenta ?? 1,
      doc?.presupuestos.proximoNumeroPresupuesto ?? 1,
    ),
  });
});
