import { Router, type Request, type Response } from 'express';
import type { Model } from 'mongoose';
import { ORG_UNICA } from '@calc/shared';
import { z, type ZodType } from 'zod';
import { noEncontrado } from './errores.js';
import { datos, query, validarCuerpo, validarQuery, zPaginacion } from './validar.js';

/**
 * ABM generico. Insumos, equipos, productos y clientes tienen exactamente la misma
 * forma; escribirla cuatro veces solo garantiza que las cuatro terminen distintas.
 * Lo particular de cada recurso se agrega despues sobre el mismo router.
 */

export interface OpcionesCrud<TCrear, TActualizar> {
  /** Como se nombra el recurso en los mensajes de error: "el insumo". */
  nombre: string;
  esquemaCrear: ZodType<TCrear>;
  esquemaActualizar: ZodType<TActualizar>;
  mapear: (doc: never) => unknown;
  /** Orden por defecto del listado. */
  orden?: Record<string, 1 | -1>;
  /** Campos donde busca el parametro `busqueda`. */
  camposBusqueda?: string[];
}

const zFiltro = zPaginacion.extend({
  soloActivos: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  busqueda: z.string().trim().min(1).optional(),
});
type Filtro = z.infer<typeof zFiltro>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rutasCrud<TCrear, TActualizar>(
  modelo: Model<any>,
  opciones: OpcionesCrud<TCrear, TActualizar>,
): Router {
  const router = Router();
  const orden = opciones.orden ?? { nombre: 1 };
  const campos = opciones.camposBusqueda ?? ['nombre'];

  router.get('/', validarQuery(zFiltro), async (_req: Request, res: Response) => {
    const f = query<Filtro>(res);
    const where: Record<string, unknown> = { organizacionId: ORG_UNICA };
    if (f.soloActivos) where['activo'] = true;
    if (f.busqueda) {
      const re = { $regex: escaparRegex(f.busqueda), $options: 'i' };
      where['$or'] = campos.map((c) => ({ [c]: re }));
    }

    const [docs, total] = await Promise.all([
      modelo
        .find(where)
        .sort(orden)
        .skip((f.pagina - 1) * f.porPagina)
        .limit(f.porPagina),
      modelo.countDocuments(where),
    ]);

    res.json({
      datos: docs.map((d) => opciones.mapear(d as never)),
      total,
      pagina: f.pagina,
      porPagina: f.porPagina,
    });
  });

  router.get('/:id', async (req: Request, res: Response) => {
    const doc = await modelo.findOne({ _id: req.params['id'], organizacionId: ORG_UNICA });
    if (!doc) throw noEncontrado(opciones.nombre);
    res.json(opciones.mapear(doc as never));
  });

  router.post('/', validarCuerpo(opciones.esquemaCrear), async (_req: Request, res: Response) => {
    const doc = await modelo.create({ ...datos<TCrear>(res), organizacionId: ORG_UNICA });
    res.status(201).json(opciones.mapear(doc as never));
  });

  router.patch(
    '/:id',
    validarCuerpo(opciones.esquemaActualizar),
    async (req: Request, res: Response) => {
      const doc = await modelo.findOne({ _id: req.params['id'], organizacionId: ORG_UNICA });
      if (!doc) throw noEncontrado(opciones.nombre);
      // `set` + `save` en vez de findOneAndUpdate: los hooks pre('validate') que
      // derivan amortizacionPorUnidad y ordenan los tramos solo corren asi.
      doc.set(datos<TActualizar>(res) as Record<string, unknown>);
      await doc.save();
      res.json(opciones.mapear(doc as never));
    },
  );

  /**
   * Baja logica, no borrado. Insumos, equipos y productos estan referenciados por
   * presupuestos ya emitidos: borrarlos de verdad dejaria documentos historicos
   * apuntando al vacio. `activo: false` los saca de los listados y los deja legibles.
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    const doc = await modelo.findOneAndUpdate(
      { _id: req.params['id'], organizacionId: ORG_UNICA },
      { $set: { activo: false } },
      { new: true },
    );
    if (!doc) throw noEncontrado(opciones.nombre);
    res.json(opciones.mapear(doc as never));
  });

  return router;
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
