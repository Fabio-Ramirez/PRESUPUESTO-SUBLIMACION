import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
import { esDesarrollo } from '../config.js';

const aqui = dirname(fileURLToPath(import.meta.url));

/** Junto al .js compilado (lo copia el build) o, si no, el fuente en src/. */
const HOJA = [join(aqui, 'estilos.scss'), join(aqui, '..', '..', 'src', 'pdf', 'estilos.scss')];

/** La carpeta de tokens compartida con el front, en sus dos ubicaciones posibles. */
const TOKENS = [join(aqui, '..', 'estilos'), join(aqui, '..', '..', '..', 'estilos')];

/**
 * El SCSS se compila en tiempo de ejecucion, no en el build.
 *
 * En desarrollo eso permite tocar un color y recargar el PDF sin recompilar el
 * proyecto, que es justamente el motivo de haber elegido HTML + CSS para el
 * documento. En produccion se compila una sola vez y queda cacheado: correr sass
 * en cada presupuesto no aporta nada.
 */
let cache: string | null = null;

export function cssDelPresupuesto(): string {
  if (cache !== null && !esDesarrollo) return cache;

  const hoja = HOJA.find(existsSync);
  if (!hoja) throw new Error(`No se encontro estilos.scss. Busque en: ${HOJA.join(', ')}`);

  const { css } = sass.compile(hoja, {
    style: esDesarrollo ? 'expanded' : 'compressed',
    // Resuelve `@use 'tokens'` contra la carpeta compartida con el front.
    loadPaths: TOKENS.filter(existsSync),
    silenceDeprecations: ['import', 'global-builtin'],
  });

  cache = css;
  return css;
}
