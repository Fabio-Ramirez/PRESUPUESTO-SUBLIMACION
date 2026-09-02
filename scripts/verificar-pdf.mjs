/**
 * Verifica el motor de PDF: SCSS compilado, HTML renderizado y PDF real.
 * Deja los archivos en scripts/salida/ para poder mirarlos.
 *
 *   npm run verificar:pdf
 */
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/sublimacion_test_pdf';
process.env.NODE_ENV = 'test';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { cssDelPresupuesto } = await import('../api/dist/pdf/estilos.js');
const { generarPdf, htmlDelPresupuesto, nombreArchivo, cerrarNavegador } = await import(
  '../api/dist/pdf/generador.js'
);
const { pesosACentavos } = await import('../shared/dist/index.js');

const salida = join(dirname(fileURLToPath(import.meta.url)), 'salida');
mkdirSync(salida, { recursive: true });

let fallas = 0;
const linea = () => console.log('─'.repeat(70));
function chequear(etiqueta, obtenido, esperado) {
  const ok = String(obtenido) === String(esperado);
  if (!ok) fallas++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta.padEnd(50)} ${String(obtenido)}` +
    (ok ? '' : `   esperaba ${esperado}`));
}
function contiene(etiqueta, texto, fragmento) {
  const ok = texto.includes(fragmento);
  if (!ok) fallas++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}`);
}

const config = {
  id: 'c1', organizacionId: 'org-unica', creadoEn: '', actualizadoEn: '',
  empresa: {
    nombre: 'Sublimarte',
    cuit: '20-12345678-9',
    direccion: 'San Martín 450, Córdoba',
    whatsapp: '+54 9 351 555-1234',
    email: 'hola@sublimarte.com.ar',
    condicionIva: 'MONOTRIBUTO',
  },
  costos: { valorHoraManoObra: 800000, costoKwh: 12000 },
  presupuestos: {
    condicionesGeneralesPorDefecto: '', validezDiasPorDefecto: 15,
    porcentajeSeniaPorDefecto: 50, tramosDescuentoPorDefecto: [],
    puntoVenta: 1, proximoNumeroPresupuesto: 2,
  },
};

const presupuesto = {
  id: 'p1', organizacionId: 'org-unica', creadoEn: '', actualizadoEn: '',
  numero: '001-001',
  fecha: '2026-08-31T12:00:00.000Z',
  validezDias: 15,
  validoHasta: '2026-09-15T12:00:00.000Z',
  cliente: {
    clienteId: 'cl1',
    nombreRazonSocial: 'Panadería La Esquina S.R.L.',
    cuitDni: '30-71234567-4',
    direccion: 'Belgrano 1200',
    localidad: 'Córdoba',
    telefono: '351 444-5566',
    email: 'compras@laesquina.com.ar',
    activo: true,
  },
  items: [
    { productoId: 'pr1', descripcion: 'Taza mágica negra — sublimación full color',
      cantidad: 50, precioUnitario: 1037592, subtotal: 51879600,
      costoUnitarioAlMomento: 518796, costeoIncompleto: false },
    { productoId: 'pr2', descripcion: 'Remera algodón blanca — estampa A4 frente',
      cantidad: 20, precioUnitario: 1450000, subtotal: 29000000,
      costoUnitarioAlMomento: 725000, costeoIncompleto: false },
  ],
  subtotal: 80879600,
  descuento: { tipo: 'PORCENTAJE', valor: 10, monto: 8087960, automatico: true },
  neto: 72791640,
  iva: { condicion: 'MONOTRIBUTO', alicuota: 0, monto: 0 },
  total: 72791640,
  porcentajeSenia: 50,
  montoSenia: 36395820,
  saldoContraEntrega: 36395820,
  condicionesGenerales:
    'Los precios se mantienen dentro del plazo de validez indicado.\n' +
    'El trabajo se inicia una vez acreditada la seña.\n' +
    'Plazo de entrega estimado: 7 días hábiles desde la aprobación del diseño.\n' +
    'Los archivos deben entregarse en alta resolución (300 dpi).',
  estado: 'ENVIADO',
  estadoEfectivo: 'ENVIADO',
};

try {
  console.log('\nSCSS — compilacion y tokens compartidos');
  linea();
  const css = cssDelPresupuesto();
  chequear('el SCSS compila', css.length > 1000, true);
  contiene('usa el color de marca de los tokens', css, '#1f5f8b');
  contiene('el mixin de importes aplica cifras tabulares', css, 'tabular-nums');
  contiene('la pagina es A4 con margenes de @page', css, 'size: A4');
  contiene('los fondos se imprimen (print-color-adjust)', css, 'print-color-adjust: exact');
  contiene('la tabla repite encabezado entre paginas', css, 'table-header-group');
  contiene('genera una clase por estado desde el mapa', css, '.sello--VENCIDO');

  console.log('\nHTML — contenido del documento');
  linea();
  const html = htmlDelPresupuesto(presupuesto, config);
  writeFileSync(join(salida, 'presupuesto.html'), html);

  contiene('CSS embebido, sin recursos externos', html, '<style>');
  chequear('no pide ningun archivo externo', /<link|src="http/.test(html), false);

  contiene('encabezado: nombre de la empresa', html, 'Sublimarte');
  contiene('encabezado: CUIT del emisor', html, 'CUIT 20-12345678-9');
  contiene('encabezado: WhatsApp', html, '+54 9 351 555-1234');
  contiene('encabezado: numero de presupuesto', html, '001-001');
  contiene('encabezado: fecha en DD/MM/AAAA', html, '31/08/2026');
  contiene('encabezado: validez en dias', html, '15 días');
  contiene('encabezado: valido hasta', html, '15/09/2026');

  contiene('cliente: razon social', html, 'Panadería La Esquina S.R.L.');
  contiene('cliente: CUIT/DNI', html, '30-71234567-4');
  contiene('cliente: localidad', html, 'Córdoba');
  contiene('cliente: email', html, 'compras@laesquina.com.ar');

  contiene('tabla: descripcion del item', html, 'Taza mágica negra');
  contiene('tabla: precio unitario', html, '$ 10.375,92');
  contiene('tabla: subtotal del item', html, '$ 518.796,00');

  contiene('totales: subtotal', html, '$ 808.796,00');
  contiene('totales: descuento por cantidad', html, '$ 80.879,60');
  contiene('totales: neto', html, '$ 727.916,40');
  contiene('totales: TOTAL', html, 'TOTAL');
  chequear('monotributo no imprime un IVA de $ 0,00', html.includes('IVA'), false);

  contiene('pago: senia con su porcentaje', html, 'Seña o anticipo (50%)');
  contiene('pago: monto de la senia', html, '$ 363.958,20');
  contiene('pago: saldo contra entrega', html, 'Saldo contra entrega');

  contiene('condiciones generales al pie', html, 'acreditada la seña');
  chequear('un ENVIADO vigente no lleva sello', html.includes('class="sello'), false);

  console.log('\nHTML — escape y casos borde');
  linea();
  const riesgoso = {
    ...presupuesto,
    numero: null,
    estado: 'BORRADOR',
    estadoEfectivo: 'BORRADOR',
    cliente: { ...presupuesto.cliente, nombreRazonSocial: 'Gráfica <b>Ñandú</b> & Cía' },
    descuento: null,
    iva: { condicion: 'RESPONSABLE_INSCRIPTO', alicuota: 21, monto: 16984716 },
    total: 97864316,
    condicionesGenerales: '',
    porcentajeSenia: 0,
  };
  const html2 = htmlDelPresupuesto(riesgoso, config);
  writeFileSync(join(salida, 'presupuesto-borrador.html'), html2);

  contiene('escapa el HTML del nombre del cliente', html2, 'Gráfica &lt;b&gt;Ñandú&lt;/b&gt; &amp; Cía');
  chequear('no inyecta markup', html2.includes('<b>Ñandú</b>'), false);
  contiene('un BORRADOR lleva sello visible', html2, 'sello--BORRADOR');
  chequear('borrador sin numero no dibuja el renglon', html2.includes('<div class=' + String.fromCharCode(34) + 'comprobante__numero'), false);
  contiene('responsable inscripto SI discrimina IVA', html2, 'IVA 21%');
  chequear('sin descuento no imprime la fila', html2.includes('Descuento por cantidad'), false);
  chequear('sin senia no imprime condiciones de pago', html2.includes('Seña o anticipo'), false);
  chequear('sin condiciones generales no imprime la seccion',
    html2.includes('Condiciones generales'), false);

  console.log('\nPDF — generacion real con Chromium');
  linea();
  const t0 = Date.now();
  const pdf = await generarPdf(presupuesto, config);
  const primero = Date.now() - t0;
  writeFileSync(join(salida, nombreArchivo(presupuesto)), Buffer.from(pdf));

  const cabecera = Buffer.from(pdf.slice(0, 5)).toString('latin1');
  chequear('el archivo es un PDF valido', cabecera, '%PDF-');
  chequear('tiene contenido real (> 10 KB)', pdf.byteLength > 10_000, true);

  const t1 = Date.now();
  await generarPdf(riesgoso, config);
  const segundo = Date.now() - t1;
  chequear('el navegador se reusa (2do PDF mas rapido)', segundo < primero, true);
  console.log(`     primero ${primero} ms (incluye arrancar Chromium) · segundo ${segundo} ms`);

  chequear('nombre de archivo listo para compartir',
    nombreArchivo(presupuesto), 'Presupuesto-001-001-Panaderia-La-Esquina-S-R-L.pdf');
  chequear('un borrador se nombra como borrador',
    nombreArchivo(riesgoso), 'Presupuesto-borrador-Grafica-b-Nandu-b-Cia.pdf');

  console.log(`\n  Archivos en scripts/salida/`);
} finally {
  await cerrarNavegador();
}

linea();
if (fallas === 0) {
  console.log('TODO OK — el PDF sale con el layout y los datos que corresponden.\n');
} else {
  console.log(`${fallas} verificacion(es) fallaron.\n`);
  process.exit(1);
}
