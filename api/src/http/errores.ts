import type { NextFunction, Request, Response } from 'express';
import { Error as ErroresMongoose } from 'mongoose';
import { ZodError } from 'zod';
import { esDesarrollo } from '../config.js';

/**
 * Error de negocio con codigo HTTP. Todos los mensajes estan escritos para que el
 * usuario los pueda leer tal cual en un cartel: nada de "ValidationError E11000".
 */
export class ErrorApp extends Error {
  constructor(
    readonly estado: number,
    message: string,
    readonly detalles?: unknown,
  ) {
    super(message);
    this.name = 'ErrorApp';
  }
}

export const noEncontrado = (que: string) => new ErrorApp(404, `No se encontro ${que}.`);
export const solicitudInvalida = (mensaje: string, detalles?: unknown) =>
  new ErrorApp(400, mensaje, detalles);
/** 409: la operacion es imposible por el estado actual, no por como vino el pedido. */
export const conflicto = (mensaje: string) => new ErrorApp(409, mensaje);

export function rutaNoEncontrada(req: Request, _res: Response, next: NextFunction): void {
  next(new ErrorApp(404, `La ruta ${req.method} ${req.originalUrl} no existe.`));
}

/**
 * Traduce cualquier error a una respuesta JSON uniforme `{ error, detalles? }`.
 *
 * Los errores de Mongoose y Zod se traducen aca y en un solo lugar: si cada ruta
 * los formateara por su cuenta, el front tendria que conocer tres formas distintas
 * de error.
 */
export function manejadorDeErrores(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const { estado, mensaje, detalles } = traducir(err);
  if (estado >= 500) console.error(err);
  res.status(estado).json({
    error: mensaje,
    ...(detalles === undefined ? {} : { detalles }),
    ...(esDesarrollo && estado >= 500 && err instanceof Error ? { stack: err.stack } : {}),
  });
}

function traducir(err: unknown): { estado: number; mensaje: string; detalles?: unknown } {
  if (err instanceof ErrorApp) {
    return { estado: err.estado, mensaje: err.message, detalles: err.detalles };
  }

  if (err instanceof ZodError) {
    return {
      estado: 400,
      mensaje: 'Los datos enviados no son validos.',
      detalles: err.issues.map((i) => ({ campo: i.path.join('.') || '(raiz)', mensaje: i.message })),
    };
  }

  // Los mensajes de validacion de los esquemas ya estan escritos en castellano
  // para el usuario, asi que se pasan tal cual.
  if (err instanceof ErroresMongoose.ValidationError) {
    return {
      estado: 400,
      mensaje: 'Los datos enviados no son validos.',
      detalles: Object.values(err.errors).map((e) => ({ campo: e.path, mensaje: e.message })),
    };
  }

  if (err instanceof ErroresMongoose.CastError) {
    return { estado: 400, mensaje: `El identificador "${String(err.value)}" no es valido.` };
  }

  // 11000 = clave duplicada. Es casi siempre un nombre repetido, que el usuario
  // puede arreglar solo si se lo decimos con esas palabras.
  if (esErrorDuplicado(err)) {
    const campo = Object.keys(err.keyPattern ?? {}).filter((c) => c !== 'organizacionId')[0];
    return {
      estado: 409,
      mensaje: campo
        ? `Ya existe un registro con ese ${campo}.`
        : 'Ya existe un registro con esos datos.',
    };
  }

  if (err instanceof Error) return { estado: 500, mensaje: err.message };
  return { estado: 500, mensaje: 'Error inesperado.' };
}

function esErrorDuplicado(err: unknown): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
