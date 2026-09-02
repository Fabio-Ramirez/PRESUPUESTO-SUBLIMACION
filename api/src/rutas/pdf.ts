import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { formatearCentavos, formatearFecha } from '@calc/shared';
import { obtenerConfiguracion } from '../models/configuracion.js';
import { aConfiguracion, aPresupuesto } from '../dto/mapear.js';
import { generarPdf, htmlDelPresupuesto, nombreArchivo } from '../pdf/generador.js';
import { buscar } from '../servicios/presupuestos.js';
import { query, validarQuery } from '../http/validar.js';

/**
 * Salidas del presupuesto: PDF, vista previa en HTML y link de WhatsApp.
 *
 * Se montan sobre /api/presupuestos/:id, aparte del router principal, para que las
 * rutas de datos no queden mezcladas con las de presentacion.
 */
export const rutasPdf: Router = Router({ mergeParams: true });

const zOpciones = z.object({
  /**
   * `descargar=false` sirve el PDF inline: es lo que necesita el <iframe> de la
   * previsualizacion antes de emitir. Por defecto descarga.
   */
  descargar: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
});

rutasPdf.get('/pdf', validarQuery(zOpciones), async (req: Request, res: Response) => {
  const { descargar } = query<{ descargar: boolean }>(res);
  const doc = await buscar(req.params['id'] as string);
  const config = await obtenerConfiguracion();

  const presupuesto = aPresupuesto(doc);
  const pdf = await generarPdf(presupuesto, aConfiguracion(config));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', pdf.byteLength);
  res.setHeader(
    'Content-Disposition',
    `${descargar ? 'attachment' : 'inline'}; filename="${nombreArchivo(presupuesto)}"`,
  );
  // Un borrador cambia con cada edicion; un emitido no cambia nunca mas.
  res.setHeader(
    'Cache-Control',
    presupuesto.numero ? 'private, max-age=31536000, immutable' : 'no-store',
  );
  res.end(Buffer.from(pdf));
});

/**
 * El mismo documento en HTML, sin pasar por Chromium.
 *
 * Es para iterar el diseño: se abre en el navegador y cada F5 muestra el SCSS
 * recompilado, sin esperar la generacion del PDF.
 */
rutasPdf.get('/vista-previa', async (req: Request, res: Response) => {
  const doc = await buscar(req.params['id'] as string);
  const config = await obtenerConfiguracion();
  res.type('html').send(htmlDelPresupuesto(aPresupuesto(doc), aConfiguracion(config)));
});

/**
 * Link para mandar el presupuesto por WhatsApp, que es el canal real.
 *
 * WhatsApp no permite adjuntar un archivo desde una URL, asi que esto arma el
 * mensaje con los datos y el numero del cliente ya cargado; el PDF se adjunta
 * despues desde el chat. Sin esto habria que copiar el telefono a mano cada vez.
 */
rutasPdf.get('/whatsapp', async (req: Request, res: Response) => {
  const doc = await buscar(req.params['id'] as string);
  const config = await obtenerConfiguracion();
  const p = aPresupuesto(doc);

  const telefono = soloDigitos(p.cliente.telefono ?? '');

  // Las lineas opcionales son `null` y las vacias son separadores de parrafo
  // puestos a proposito: filtrar por cadena vacia dejaria el mensaje sin respiro.
  const lineas: (string | null)[] = [
    `${saludo(p.cliente.nombreRazonSocial)}, ¿cómo estás?`,
    '',
    `Te paso el presupuesto ${p.numero ?? ''} por ${resumenItems(p.items)}.`.replace('  ', ' '),
    `Total: ${formatearCentavos(p.total)}`,
    p.porcentajeSenia > 0
      ? `Seña ${p.porcentajeSenia}%: ${formatearCentavos(p.montoSenia)} — saldo contra entrega: ${formatearCentavos(p.saldoContraEntrega)}`
      : null,
    `Válido hasta el ${formatearFecha(p.validoHasta)}.`,
    '',
    'Cualquier duda me decís. ¡Gracias!',
    config.empresa.nombre || null,
  ];

  const mensaje = lineas.filter((l) => l !== null).join('\n');
  res.json({
    telefono,
    mensaje,
    // Sin telefono el link igual sirve: abre WhatsApp para elegir el destinatario.
    url: telefono
      ? `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`
      : `https://wa.me/?text=${encodeURIComponent(mensaje)}`,
    archivo: nombreArchivo(p),
  });
});

/** WhatsApp quiere solo digitos con codigo de pais, sin +, espacios ni guiones. */
function soloDigitos(telefono: string): string {
  const d = telefono.replace(/\D/g, '');
  if (d === '') return '';
  // Un numero argentino cargado como "351 444-5566" no lleva pais: se lo agregamos.
  return d.length <= 11 && !d.startsWith('54') ? `54${d}` : d;
}

/**
 * "Juan Pérez" -> "Hola Juan". "Panadería La Esquina" -> "Hola".
 *
 * Tomar el primer token de una razon social sale mal: "Hola Panadería" suena a
 * mensaje automatico, que es justo lo que este texto tiene que no parecer. Ante la
 * duda no se personaliza, asi que solo pasan los nombres de una o dos palabras sin
 * sufijo societario, que es la forma en que se carga una persona.
 */
function saludo(razonSocial: string): string {
  const nombre = razonSocial.trim();
  if (!nombre) return 'Hola';
  const societario = /\b(s\.?\s?r\.?\s?l|s\.?\s?a|s\.?\s?a\.?\s?s|ltda|cia|compañia|compañía)\b\.?/i;
  const palabras = nombre.split(/\s+/);
  if (societario.test(nombre) || palabras.length > 2) return 'Hola';
  return `Hola ${palabras[0]}`;
}

function resumenItems(items: readonly { descripcion: string; cantidad: number }[]): string {
  const primero = items[0];
  if (!primero) return 'el trabajo';
  const base = `${primero.cantidad} × ${primero.descripcion}`;
  return items.length > 1 ? `${base} y ${items.length - 1} ítem(s) más` : base;
}
