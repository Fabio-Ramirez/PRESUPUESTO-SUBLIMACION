/**
 * Un entero de puerto valido (1-65535), o el default si la variable no esta seteada.
 *
 * `Number(process.env['PORT'] ?? 3000)` a secas es fragil: si `PORT` esta seteada
 * en el sistema con algo que `Number()` no puede convertir (pasa seguido en Windows,
 * donde otra herramienta -IIS Express, un launcher, un dev server previo- puede
 * dejarla con un valor raro), `Server.listen(NaN)` explota con un
 * `ERR_SOCKET_BAD_PORT` que no dice nada sobre la causa real. Aca se valida antes
 * de arrancar y se explica cual es el problema, en vez de tirar ese stack criptico.
 */
function puertoDesdeEnv(nombre: string, porDefecto: number): number {
  const crudo = process.env[nombre];
  if (crudo === undefined || crudo === '') return porDefecto;

  const n = Number(crudo);
  if (!Number.isInteger(n) || n <= 0 || n >= 65536) {
    throw new Error(
      `La variable de entorno ${nombre} tiene un valor invalido: "${crudo}". ` +
        'Tiene que ser un entero entre 1 y 65535, o no estar seteada.',
    );
  }
  return n;
}

/** Configuracion de arranque. Todo lo que cambia entre maquinas vive aca. */
export const config = {
  puerto: puertoDesdeEnv('PORT', 3000),
  mongoUri: process.env['MONGO_URI'] ?? 'mongodb://127.0.0.1:27017/sublimacion',
  /** Origen del front en desarrollo. */
  origenCors: process.env['CORS_ORIGIN'] ?? 'http://localhost:4200',
  entorno: process.env['NODE_ENV'] ?? 'development',
} as const;

export const esDesarrollo = config.entorno !== 'production';
