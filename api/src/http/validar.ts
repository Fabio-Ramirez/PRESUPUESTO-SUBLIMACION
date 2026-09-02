import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodType } from 'zod';

/**
 * Valida `req.body` contra un esquema Zod y deja el resultado tipado en `res.locals`.
 *
 * No se pisa `req.body` porque en Express 5 esta tipado como `any` y perderiamos el
 * tipo. `datos(res)` lo recupera con el tipo correcto en el handler.
 */
export function validarCuerpo<T>(esquema: ZodType<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = esquema.safeParse(req.body);
    if (!r.success) return next(r.error);
    res.locals['datos'] = r.data;
    next();
  };
}

export function validarQuery<T>(esquema: ZodType<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = esquema.safeParse(req.query);
    if (!r.success) return next(r.error);
    res.locals['query'] = r.data;
    next();
  };
}

export function datos<T>(res: Response): T {
  return res.locals['datos'] as T;
}

export function query<T>(res: Response): T {
  return res.locals['query'] as T;
}

/* ------------------------------------------------------------------ */
/* Piezas reutilizables                                                */
/* ------------------------------------------------------------------ */

/** ObjectId de Mongo: 24 caracteres hexadecimales. */
export const zId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'No es un identificador valido.');

/**
 * Un monto en centavos. Entero y no negativo, siempre: la unica forma de que un
 * float se cuele en la base es que alguien lo mande por HTTP, y aca se corta.
 */
export const zCentavos = z
  .number()
  .int('El monto tiene que ser un entero en centavos (sin decimales).')
  .min(0, 'El monto no puede ser negativo.');

export const zPorcentaje = z.number().min(0).max(100);

/** Margen y comision: 100% haria que el precio sea infinito. */
export const zPorcentajeDivisor = z
  .number()
  .min(0)
  .max(99.99, 'Tiene que ser menor a 100%: con 100% el precio seria infinito.');

export const zCantidad = z.number().min(0, 'La cantidad no puede ser negativa.');

export const zFecha = z.union([z.iso.datetime(), z.iso.date()]).transform((s) => new Date(s));

export const zTramosDescuento = z
  .array(
    z.object({
      desdeCantidad: z.number().int().min(1),
      porcentaje: zPorcentaje,
    }),
  )
  .refine(
    (ts) => new Set(ts.map((t) => t.desdeCantidad)).size === ts.length,
    'Hay dos tramos que arrancan en la misma cantidad.',
  );

export const zPaginacion = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
});
export type Paginacion = z.infer<typeof zPaginacion>;
