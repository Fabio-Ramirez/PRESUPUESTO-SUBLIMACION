import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { manejadorDeErrores, rutaNoEncontrada } from './http/errores.js';
import { rutasClientes } from './rutas/clientes.js';
import { rutasConfiguracion } from './rutas/configuracion.js';
import { rutasCosteo } from './rutas/costeo.js';
import { rutasEquipos } from './rutas/equipos.js';
import { rutasInsumos } from './rutas/insumos.js';
import { rutasPresupuestos } from './rutas/presupuestos.js';
import { rutasProductos } from './rutas/productos.js';

const aqui = dirname(fileURLToPath(import.meta.url));
/**
 * El build de Angular, si existe. Desde api/dist/app.js hay que subir a la raiz
 * del repo y bajar a web/dist/web/browser.
 */
const carpetaFrontend = join(aqui, '..', '..', 'web', 'dist', 'web', 'browser');

export function crearApp(): Express {
  const app = express();

  app.use(cors({ origin: config.origenCors }));
  // El limite alto es por el logo de la empresa, que viaja como data URI dentro
  // de la configuracion para que el PDF quede autocontenido.
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/salud', (_req: Request, res: Response) => {
    res.json({ ok: true, entorno: config.entorno });
  });

  app.use('/api/insumos', rutasInsumos);
  app.use('/api/equipos', rutasEquipos);
  app.use('/api/productos', rutasProductos);
  app.use('/api/clientes', rutasClientes);
  app.use('/api/costeo', rutasCosteo);
  app.use('/api/presupuestos', rutasPresupuestos);
  app.use('/api/configuracion', rutasConfiguracion);

  /**
   * Modo standalone: si el build de Angular esta presente, esta misma API lo sirve.
   * Es lo que permite que la app entera sea UN solo proceso para arrancar — en una
   * notebook de alguien que no es programador, "un comando y listo" es la
   * diferencia entre que se use la herramienta o no.
   *
   * En desarrollo (con `ng serve` + proxy en :4200) esta carpeta no suele existir
   * todavia, asi que el bloque no hace nada y no molesta.
   */
  if (existsSync(carpetaFrontend)) {
    app.use(express.static(carpetaFrontend));

    // Cualquier ruta que NO empiece con /api devuelve el index.html: es lo que
    // permite refrescar en /presupuestos/123 y que Angular Router la resuelva,
    // en vez de que el navegador le pida ese archivo al servidor y de 404.
    app.get(/^\/(?!api\/).*/, (_req: Request, res: Response) => {
      res.sendFile(join(carpetaFrontend, 'index.html'));
    });
  }

  app.use(rutaNoEncontrada);
  /**
   * Express 5 reenvia solo las promesas rechazadas de los handlers async, asi que
   * no hace falta envolver cada ruta en un asyncHandler: un `throw` dentro de un
   * handler llega hasta aca.
   */
  app.use(manejadorDeErrores);

  return app;
}
