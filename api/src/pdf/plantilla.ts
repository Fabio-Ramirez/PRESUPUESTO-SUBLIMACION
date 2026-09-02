import {
  ETIQUETAS_ESTADO,
  EstadoPresupuesto,
  aCentavos,
  formatearCentavos,
  formatearFecha,
  formatearPorcentaje,
  type Configuracion,
  type Presupuesto,
} from '@calc/shared';

/**
 * Plantilla del presupuesto.
 *
 * Es una funcion TypeScript y no un archivo .html con placeholders a proposito:
 * recibe `Presupuesto` tipado, asi que renombrar un campo del dominio rompe la
 * compilacion en vez de dejar un "undefined" impreso en el PDF que ve el cliente.
 *
 * El diseño se itera en `estilos.scss`, que es donde uno realmente quiere estar
 * cuando ajusta un layout.
 */
export function renderizarPresupuesto(
  presupuesto: Presupuesto,
  config: Configuracion,
  css: string,
): string {
  const p = presupuesto;
  const e = config.empresa;

  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<title>Presupuesto ${esc(p.numero ?? 'borrador')}</title>
<style>${css}</style>
</head>
<body>
${encabezado(p, e)}
${seccionCliente(p)}
${seccionTrabajo(p)}
${totales(p)}
${condicionesPago(p)}
${condicionesGenerales(p)}
${pie(e)}
</body>
</html>`;
}

/* ------------------------------------------------------------------ */

function encabezado(p: Presupuesto, e: Configuracion['empresa']): string {
  const datos = [
    e.cuit && `CUIT ${esc(e.cuit)}`,
    e.direccion && esc(e.direccion),
    e.whatsapp && `WhatsApp ${esc(e.whatsapp)}`,
    e.email && esc(e.email),
  ]
    .filter(Boolean)
    .join('<br>');

  return `<header class="encabezado">
  <div class="emisor">
    ${e.logo ? `<img class="emisor__logo" src="${esc(e.logo)}" alt="">` : ''}
    <div>
      <div class="emisor__nombre">${esc(e.nombre || 'Sin nombre configurado')}</div>
      <div class="emisor__datos">${datos}</div>
    </div>
  </div>
  <div class="comprobante">
    <div class="comprobante__titulo">Presupuesto</div>
    ${
      // Sin numero (borrador) no se dibuja el renglon: un guion suelto en el lugar
      // del numero se lee como un error de impresion. El sello BORRADOR lo explica.
      p.numero ? `<div class="comprobante__numero">${esc(p.numero)}</div>` : ''
    }
    <dl class="comprobante__meta">
      <dt>Fecha</dt><dd>${formatearFecha(p.fecha)}</dd>
      <dt>Validez</dt><dd>${p.validezDias} días</dd>
      <dt>Válido hasta</dt><dd>${formatearFecha(p.validoHasta)}</dd>
    </dl>
    ${sello(p)}
  </div>
</header>`;
}

/**
 * El sello solo se dibuja cuando el estado agrega informacion. Un ENVIADO vigente
 * es el caso normal y no necesita anuncio; un BORRADOR o un VENCIDO impreso sin
 * distinguirse de uno vigente si es un problema.
 */
function sello(p: Presupuesto): string {
  if (p.estadoEfectivo === EstadoPresupuesto.ENVIADO) return '';
  return `<div class="sello sello--${p.estadoEfectivo}">${ETIQUETAS_ESTADO[p.estadoEfectivo]}</div>`;
}

function seccionCliente(p: Presupuesto): string {
  const c = p.cliente;
  const campo = (etiqueta: string, valor: string | undefined) =>
    valor
      ? `<div class="cliente__campo">
        <span class="cliente__etiqueta">${etiqueta}</span>
        <span class="cliente__valor">${esc(valor)}</span>
      </div>`
      : '';

  return `<section class="seccion">
  <h2 class="seccion__titulo">Datos del cliente</h2>
  <div class="cliente">
    <div class="cliente__campo cliente__campo--ancho">
      <span class="cliente__etiqueta">Cliente</span>
      <span class="cliente__valor">${esc(c.nombreRazonSocial)}</span>
    </div>
    ${campo('CUIT / DNI', c.cuitDni)}
    ${campo('Teléfono', c.telefono)}
    ${campo('Dirección', c.direccion)}
    ${campo('Localidad', c.localidad)}
    ${campo('Email', c.email)}
  </div>
</section>`;
}

function seccionTrabajo(p: Presupuesto): string {
  const filas = p.items
    .map(
      (i) => `<tr>
      <td class="trabajo__descripcion">${esc(i.descripcion)}</td>
      <td class="trabajo__cantidad">${formatearCantidad(i.cantidad)}</td>
      <td class="trabajo__precio">${formatearCentavos(i.precioUnitario)}</td>
      <td class="trabajo__subtotal">${formatearCentavos(i.subtotal)}</td>
    </tr>`,
    )
    .join('\n');

  return `<section class="seccion">
  <h2 class="seccion__titulo">Detalle del trabajo</h2>
  <table class="trabajo">
    <thead>
      <tr>
        <th>Descripción</th>
        <th class="trabajo__cantidad">Cant.</th>
        <th class="trabajo__precio">P. unitario</th>
        <th class="trabajo__subtotal">Subtotal</th>
      </tr>
    </thead>
    <tbody>
${filas}
    </tbody>
  </table>
</section>`;
}

function totales(p: Presupuesto): string {
  const fila = (etiqueta: string, monto: string, clase = '') =>
    `<tr class="${clase}"><td>${etiqueta}</td><td>${monto}</td></tr>`;

  const partes = [fila('Subtotal', formatearCentavos(p.subtotal))];

  if (p.descuento && p.descuento.monto > 0) {
    const detalle =
      p.descuento.tipo === 'PORCENTAJE'
        ? `Descuento por cantidad (${formatearPorcentaje(p.descuento.valor)})`
        : 'Descuento por cantidad';
    partes.push(
      fila(detalle, `− ${formatearCentavos(p.descuento.monto)}`, 'totales__descuento'),
    );
    partes.push(fila('Neto', formatearCentavos(p.neto), 'totales__neto'));
  }

  // El IVA solo se muestra si se discrimina: un monotributista imprimiendo
  // "IVA $ 0,00" confunde mas de lo que aclara.
  if (p.iva.alicuota > 0) {
    partes.push(fila(`IVA ${formatearPorcentaje(p.iva.alicuota)}`, formatearCentavos(p.iva.monto)));
  }

  partes.push(fila('TOTAL', formatearCentavos(p.total), 'totales__total'));

  return `<div class="totales">
  <table class="totales__tabla">
    ${partes.join('\n    ')}
  </table>
</div>`;
}

function condicionesPago(p: Presupuesto): string {
  if (p.porcentajeSenia <= 0) return '';
  return `<section class="seccion">
  <h2 class="seccion__titulo">Condiciones de pago</h2>
  <div class="pago">
    <div class="pago__item">
      <span class="pago__etiqueta">Seña o anticipo (${formatearPorcentaje(p.porcentajeSenia)})</span>
      <span class="pago__monto">${formatearCentavos(p.montoSenia)}</span>
    </div>
    <div class="pago__item">
      <span class="pago__etiqueta">Saldo contra entrega</span>
      <span class="pago__monto">${formatearCentavos(p.saldoContraEntrega)}</span>
    </div>
  </div>
</section>`;
}

function condicionesGenerales(p: Presupuesto): string {
  if (!p.condicionesGenerales.trim()) return '';
  return `<section class="seccion">
  <h2 class="seccion__titulo">Condiciones generales</h2>
  <div class="condiciones">${esc(p.condicionesGenerales)}</div>
</section>`;
}

function pie(e: Configuracion['empresa']): string {
  const contacto = [e.whatsapp, e.email].filter(Boolean).join(' · ');
  return `<footer class="pie">
  ${esc(e.nombre)}${contacto ? ` · ${esc(contacto)}` : ''}
</footer>`;
}

/* ------------------------------------------------------------------ */

/**
 * Escape de HTML. Todo lo que viene del usuario pasa por aca: el nombre de un
 * cliente con "&" o "<" no puede romper el documento, y un texto pegado desde
 * otro lado no puede inyectar markup en el PDF.
 */
function esc(v: string | number | null | undefined): string {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 50 → "50" ; 2,5 → "2,5". Sin decimales inutiles en la columna de cantidad. */
function formatearCantidad(n: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(n);
}

export const _internos = { esc, formatearCantidad, aCentavos };
