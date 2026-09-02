import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { EstadoPresupuesto, ORG_UNICA, TipoDescuento, resolverEstadoEfectivo } from '@calc/shared';
import { PresupuestoModel } from '../models/index.js';
import { aPresupuesto } from '../dto/mapear.js';
import { rutasPdf } from './pdf.js';
import {
  datos,
  query,
  validarCuerpo,
  validarQuery,
  zCantidad,
  zCentavos,
  zFecha,
  zId,
  zPaginacion,
  zPorcentaje,
} from '../http/validar.js';
import {
  actualizarBorrador,
  buscar,
  cambiarEstado,
  crearBorrador,
  duplicar,
  emitir,
  eliminarBorrador,
  type DatosPresupuesto,
} from '../servicios/presupuestos.js';

const zItem = z
  .object({
    productoId: zId.optional(),
    descripcion: z.string().trim().optional(),
    cantidad: zCantidad.refine((n) => n > 0, 'La cantidad tiene que ser mayor a cero.'),
    /** Opcional: si no viene, se usa el precio que calcula el motor para el producto. */
    precioUnitario: zCentavos.optional(),
  })
  .refine(
    (i) => i.productoId != null || (i.descripcion != null && i.precioUnitario != null),
    'Un item sin producto necesita descripcion y precio unitario.',
  );

const zGuardar = z
  .object({
    clienteId: zId.optional(),
    clienteManual: z
      .object({
        nombreRazonSocial: z.string().trim().min(1),
        cuitDni: z.string().trim().optional(),
        direccion: z.string().trim().optional(),
        localidad: z.string().trim().optional(),
        telefono: z.string().trim().optional(),
        email: z.string().trim().optional(),
      })
      .optional(),
    items: z.array(zItem).min(1, 'El presupuesto tiene que tener al menos un item.'),
    fecha: zFecha.optional(),
    validezDias: z.number().int().min(1).optional(),
    porcentajeSenia: zPorcentaje.optional(),
    condicionesGenerales: z.string().optional(),
    notasInternas: z.string().optional(),
    /** Descuento manual: pisa al automatico por tramos. */
    descuento: z
      .object({
        tipo: z.enum([TipoDescuento.PORCENTAJE, TipoDescuento.MONTO]),
        valor: z.number().min(0),
      })
      .optional(),
    sinDescuento: z.boolean().optional(),
  })
  .refine(
    (d) => d.clienteId != null || d.clienteManual != null,
    'Falta el cliente: elegi uno de la lista o cargalo a mano.',
  );

export const rutasPresupuestos: Router = Router();

// PDF, vista previa y link de WhatsApp. Van antes de las rutas con :id para que
// /:id/pdf no se coma como si fuera un id.
rutasPresupuestos.use("/:id", rutasPdf);

/* ------------------------------------------------------------------ */
/* Listado                                                             */
/* ------------------------------------------------------------------ */

const zFiltro = zPaginacion.extend({
  estado: z.enum(Object.values(EstadoPresupuesto) as [string, ...string[]]).optional(),
  clienteId: zId.optional(),
  busqueda: z.string().trim().min(1).optional(),
});
type Filtro = z.infer<typeof zFiltro>;

rutasPresupuestos.get('/', validarQuery(zFiltro), async (_req: Request, res: Response) => {
  const f = query<Filtro>(res);
  const where: Record<string, unknown> = { organizacionId: ORG_UNICA };
  if (f.clienteId) where['cliente.clienteId'] = f.clienteId;
  if (f.busqueda) {
    const re = { $regex: f.busqueda.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    where['$or'] = [{ numero: re }, { 'cliente.nombreRazonSocial': re }];
  }

  /**
   * VENCIDO no existe como valor guardado: se deriva. Filtrar por el estado
   * efectivo es entonces filtrar por ENVIADO y comparar la fecha, no buscar un
   * `estado: 'VENCIDO'` que nunca esta escrito en la base.
   */
  const ahora = new Date();
  if (f.estado === EstadoPresupuesto.VENCIDO) {
    where['estado'] = EstadoPresupuesto.ENVIADO;
    where['validoHasta'] = { $lt: inicioDelDia(ahora) };
  } else if (f.estado === EstadoPresupuesto.ENVIADO) {
    where['estado'] = EstadoPresupuesto.ENVIADO;
    where['validoHasta'] = { $gte: inicioDelDia(ahora) };
  } else if (f.estado) {
    where['estado'] = f.estado;
  }

  const [docs, total] = await Promise.all([
    PresupuestoModel.find(where)
      .sort({ fecha: -1, _id: -1 })
      .skip((f.pagina - 1) * f.porPagina)
      .limit(f.porPagina),
    PresupuestoModel.countDocuments(where),
  ]);

  res.json({
    datos: docs.map((d) => aPresupuesto(d, ahora)),
    total,
    pagina: f.pagina,
    porPagina: f.porPagina,
  });
});

/** Resumen para los contadores del listado, calculado en la base y no en memoria. */
rutasPresupuestos.get('/resumen', async (_req: Request, res: Response) => {
  const ahora = new Date();
  const docs = await PresupuestoModel.find({ organizacionId: ORG_UNICA }).select(
    'estado validoHasta total',
  );
  const resumen: Record<string, { cantidad: number; total: number }> = {};
  for (const d of docs) {
    const e = resolverEstadoEfectivo(d.estado as EstadoPresupuesto, d.validoHasta, ahora);
    resumen[e] ??= { cantidad: 0, total: 0 };
    resumen[e]!.cantidad += 1;
    resumen[e]!.total += d.total;
  }
  res.json(resumen);
});

rutasPresupuestos.get('/:id', async (req: Request, res: Response) => {
  res.json(aPresupuesto(await buscar(req.params['id'] as string)));
});

/* ------------------------------------------------------------------ */
/* Alta y edicion (solo borradores)                                    */
/* ------------------------------------------------------------------ */

rutasPresupuestos.post('/', validarCuerpo(zGuardar), async (_req: Request, res: Response) => {
  const doc = await crearBorrador(datos<DatosPresupuesto>(res));
  res.status(201).json(aPresupuesto(doc));
});

rutasPresupuestos.put('/:id', validarCuerpo(zGuardar), async (req: Request, res: Response) => {
  const doc = await actualizarBorrador(req.params['id'] as string, datos<DatosPresupuesto>(res));
  res.json(aPresupuesto(doc));
});

/** Solo borradores. Un presupuesto emitido es historial: se marca RECHAZADO, no se borra. */
rutasPresupuestos.delete('/:id', async (req: Request, res: Response) => {
  await eliminarBorrador(req.params['id'] as string);
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */

/** BORRADOR -> ENVIADO. Aca y solo aca se asigna el numero correlativo. */
rutasPresupuestos.post('/:id/emitir', async (req: Request, res: Response) => {
  const doc = await emitir(req.params['id'] as string);
  res.json(aPresupuesto(doc));
});

const zEstado = z.object({
  estado: z.enum([
    EstadoPresupuesto.ACEPTADO,
    EstadoPresupuesto.RECHAZADO,
    EstadoPresupuesto.VENCIDO,
  ]),
});

rutasPresupuestos.post(
  '/:id/estado',
  validarCuerpo(zEstado),
  async (req: Request, res: Response) => {
    const { estado } = datos<z.infer<typeof zEstado>>(res);
    const doc = await cambiarEstado(req.params['id'] as string, estado);
    res.json(aPresupuesto(doc));
  },
);

/**
 * Duplicar con precios actuales: la unica forma de "actualizar" un presupuesto
 * viejo. Crea uno nuevo en BORRADOR, recosteado contra los precios de hoy, y deja
 * el original intacto.
 */
rutasPresupuestos.post('/:id/duplicar', async (req: Request, res: Response) => {
  const doc = await duplicar(req.params['id'] as string);
  res.status(201).json(aPresupuesto(doc));
});

function inicioDelDia(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
