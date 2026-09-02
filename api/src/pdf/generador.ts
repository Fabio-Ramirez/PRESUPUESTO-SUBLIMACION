import puppeteer, { type Browser } from 'puppeteer';
import type { Configuracion, Presupuesto } from '@calc/shared';
import { cssDelPresupuesto } from './estilos.js';
import { renderizarPresupuesto } from './plantilla.js';

/**
 * Generacion del PDF.
 *
 * Se eligio Chromium sobre PDFKit/pdfmake porque el layout del presupuesto es una
 * tabla con encabezado repetido, totales alineados y bloques de texto de alto
 * variable: describirlo en CSS lleva una tarde, posicionarlo a mano lleva una
 * semana y se rompe con cada cambio.
 */

/**
 * Una sola instancia de Chromium para todo el proceso.
 *
 * Arrancarlo cuesta cerca de un segundo; generar una pagina en uno ya abierto,
 * decenas de milisegundos. Sin esto, previsualizar un presupuesto mientras se edita
 * seria inusable.
 */
let navegador: Browser | null = null;
let arrancando: Promise<Browser> | null = null;

async function obtenerNavegador(): Promise<Browser> {
  if (navegador?.connected) return navegador;
  // Si dos pedidos llegan juntos con el navegador caido, no se lanzan dos Chromium.
  arrancando ??= puppeteer
    .launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    })
    .then((b) => {
      navegador = b;
      arrancando = null;
      return b;
    })
    .catch((e: unknown) => {
      arrancando = null;
      throw e;
    });
  return arrancando;
}

export async function cerrarNavegador(): Promise<void> {
  await navegador?.close();
  navegador = null;
}

/** El HTML completo, con el CSS embebido. Util para iterar el diseño sin PDF. */
export function htmlDelPresupuesto(p: Presupuesto, config: Configuracion): string {
  return renderizarPresupuesto(p, config, cssDelPresupuesto());
}

export async function generarPdf(p: Presupuesto, config: Configuracion): Promise<Uint8Array> {
  const pagina = await (await obtenerNavegador()).newPage();
  try {
    // `domcontentloaded` alcanza: no hay recursos externos que esperar, el CSS va
    // inline y el logo viaja como data URI.
    await pagina.setContent(htmlDelPresupuesto(p, config), { waitUntil: 'domcontentloaded' });
    return await pagina.pdf({
      format: 'A4',
      // Los margenes los pone @page en el SCSS, junto al resto del diseño.
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: piePaginado(p),
    });
  } finally {
    // La pagina se cierra siempre; el navegador queda vivo para el proximo pedido.
    await pagina.close();
  }
}

/**
 * "Página 1 de 2" abajo a la derecha. Chromium exige estilos inline aca: el
 * footerTemplate se renderiza en un contexto aparte que no ve el CSS del documento.
 */
function piePaginado(p: Presupuesto): string {
  const referencia = p.numero ? `Presupuesto ${p.numero}` : 'Presupuesto (borrador)';
  return `<div style="width:100%;font-size:7pt;color:#8b939c;font-family:'Segoe UI',Arial,sans-serif;padding:0 14mm;display:flex;justify-content:space-between;">
    <span>${referencia}</span>
    <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
  </div>`;
}

/** Nombre de archivo listo para compartir: el cliente lo ve en WhatsApp. */
export function nombreArchivo(p: Presupuesto): string {
  const referencia = p.numero ?? 'borrador';
  const cliente = p.cliente.nombreRazonSocial
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // saca los acentos que dejo NFD
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `Presupuesto-${referencia}${cliente ? `-${cliente}` : ''}.pdf`;
}
