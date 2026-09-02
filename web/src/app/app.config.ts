import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { rutas } from './app.routes.js';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless: toda la app se apoya en signals, no hay nada que zone.js tenga que
    // parchear. Menos trabajo por cada tecla en la calculadora.
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch()),
    // withComponentInputBinding: los parametros de ruta llegan como inputs.
    provideRouter(rutas, withComponentInputBinding()),
  ],
};
