/**
 * Verificacion del motor contra la planilla original.
 * Corre con: npm run verificar
 * Sale con codigo 1 si algun valor no coincide.
 */
import assert from 'node:assert/strict';
import {
  calcularCosteo,
  calcularPrecioSugerido,
  calcularPrecioPorUnidadUso,
  calcularAmortizacionPorUnidad,
  calcularTotales,
  calcularSubtotalItem,
  porcentajeDeTramo,
  resolverEstadoEfectivo,
  formatearMilicentavos,
  formatearCentavos,
  pesosAMilicentavos,
  pesosACentavos,
  aCentavos,
  milicentavosAPesos,
} from '../shared/dist/index.js';

let fallas = 0;
const linea = (l = 66) => console.log('─'.repeat(l));

function chequear(etiqueta, obtenido, esperado) {
  const ok = obtenido === esperado;
  if (!ok) fallas++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${etiqueta.padEnd(34)} ${String(obtenido).padStart(13)}` +
      (ok ? '' : `   esperaba ${esperado}`),
  );
}

/* ================================================================== */
console.log('\nCASO 1 — Taza magica negra, reproduccion exacta de la planilla');
linea();

// Los insumos se cargan como se COMPRAN, no como se muestran en la planilla.
// El "$35,31" del papel es formato: la resma de 500 sale $17.653,00 -> $35,306/hoja.
const papel = calcularPrecioPorUnidadUso(pesosACentavos(17653), { cantidad: 500, unidad: 'HOJA' });
const tinta = calcularPrecioPorUnidadUso(pesosACentavos(1815), { cantidad: 100, unidad: 'ML' });
const taza = calcularPrecioPorUnidadUso(pesosACentavos(4900), { cantidad: 1, unidad: 'UNIDAD' });

// Amortizaciones derivadas de costo / vida util, no cargadas a mano.
const amortImpresora = calcularAmortizacionPorUnidad(pesosACentavos(845_000), 100_000);
const amortPlancha = calcularAmortizacionPorUnidad(pesosACentavos(299_800), 4_000);

console.log(`  papel:     $17.653,00 / 500 hojas = ${formatearMilicentavos(papel)}` +
  `   (real: ${milicentavosAPesos(papel)})`);
console.log(`  tinta:      $1.815,00 / 100 ml    = ${formatearMilicentavos(tinta)}`);
console.log(`  impresora: $845.000,00 / 100.000  = ${formatearMilicentavos(amortImpresora)}`);
console.log(`  plancha:   $299.800,00 / 4.000    = ${formatearMilicentavos(amortPlancha)}`);
console.log('');

const r = calcularCosteo({
  insumos: [
    { insumoId: '1', nombre: 'Taza magica negra', tipo: 'PRODUCTO_BASE', unidadUso: 'UNIDAD', cantidad: 1, precioPorUnidadUso: taza },
    { insumoId: '2', nombre: 'Papel de sublimacion', tipo: 'PAPEL', unidadUso: 'HOJA', cantidad: 1, precioPorUnidadUso: papel },
    { insumoId: '3', nombre: 'Tinta', tipo: 'TINTA', unidadUso: 'ML', cantidad: 1, precioPorUnidadUso: tinta },
  ],
  equipos: [
    { equipoId: 'i', nombre: 'Impresora', unidadesConsumidas: 1, minutosUso: 0, amortizacionPorUnidad: amortImpresora, consumoWatts: 30 },
    { equipoId: 'p', nombre: 'Plancha', unidadesConsumidas: 1, minutosUso: 0, amortizacionPorUnidad: amortPlancha, consumoWatts: 1400 },
  ],
  minutosManoObra: 0,
  valorHoraManoObra: 0,
  costoKwh: 0,
  otrosGastos: 0,
  porcentajeMerma: 3,
  margen: 50,
  comisionPlataforma: 0,
});

chequear('Producto base', formatearMilicentavos(r.lineasInsumo[0].costo), '$ 4.900,00');
chequear('Papel de sublimacion', formatearMilicentavos(r.lineasInsumo[1].costo), '$ 35,31');
chequear('Tinta', formatearMilicentavos(r.lineasInsumo[2].costo), '$ 18,15');
chequear('Amortizacion impresora', formatearMilicentavos(r.lineasEquipo[0].amortizacion), '$ 8,45');
chequear('Amortizacion plancha', formatearMilicentavos(r.lineasEquipo[1].amortizacion), '$ 74,95');
chequear('Subtotal', formatearMilicentavos(r.subtotalCosto), '$ 5.036,86');
chequear('Merma (3%)', formatearMilicentavos(r.merma), '$ 151,11');
chequear('Costo total x unidad', formatearMilicentavos(r.costoTotalUnitario), '$ 5.187,96');
chequear('Margen 50% -> sugerido', formatearMilicentavos(r.precioSugerido), '$ 10.375,92');

/* ================================================================== */
console.log('\nCASO 2 — Por que hacen falta los milicentavos');
linea();
// Mismo costeo pero con el papel redondeado a centavos, como se ve en la planilla.
const papelRedondeado = pesosACentavos(35.31) * 1000;
const r2 = calcularCosteo({
  insumos: [
    { insumoId: '1', nombre: 'Taza', tipo: 'PRODUCTO_BASE', unidadUso: 'UNIDAD', cantidad: 1, precioPorUnidadUso: taza },
    { insumoId: '2', nombre: 'Papel', tipo: 'PAPEL', unidadUso: 'HOJA', cantidad: 1, precioPorUnidadUso: papelRedondeado },
    { insumoId: '3', nombre: 'Tinta', tipo: 'TINTA', unidadUso: 'ML', cantidad: 1, precioPorUnidadUso: tinta },
  ],
  equipos: [
    { equipoId: 'i', nombre: 'Impresora', unidadesConsumidas: 1, minutosUso: 0, amortizacionPorUnidad: amortImpresora, consumoWatts: 30 },
    { equipoId: 'p', nombre: 'Plancha', unidadesConsumidas: 1, minutosUso: 0, amortizacionPorUnidad: amortPlancha, consumoWatts: 1400 },
  ],
  minutosManoObra: 0, valorHoraManoObra: 0, costoKwh: 0, otrosGastos: 0,
  porcentajeMerma: 3, margen: 50, comisionPlataforma: 0,
});
console.log(`  Con el papel a $35,306 (real):     ${formatearMilicentavos(r.precioSugerido)}`);
console.log(`  Con el papel a $35,31  (mostrado): ${formatearMilicentavos(r2.precioSugerido)}`);
const brecha = aCentavos(r2.precioSugerido) - aCentavos(r.precioSugerido);
console.log(`  Diferencia: ${brecha} centavos por unidad — sobre 500 tazas, ` +
  `${formatearCentavos(brecha * 500)}.`);
assert.ok(brecha !== 0, 'el caso deberia mostrar una diferencia');

/* ================================================================== */
console.log('\nCASO 3 — Margen sobre venta vs recargo sobre costo');
linea();
const costo = r.costoTotalUnitario;
console.log(`  Costo total x unidad                 ${formatearMilicentavos(costo)}`);
console.log(`  Correcto:   costo / (1 - 0,50)  =    ${formatearMilicentavos(calcularPrecioSugerido(costo, 50))}`);
console.log(`  Incorrecto: costo x 1,50        =    ${formatearMilicentavos(Math.round(costo * 1.5))}`);
chequear('margen real sobre venta', r.margenRealSobreVenta, 50);
chequear('recargo sobre costo', r.recargoSobreCosto, 100);
console.log('  Con margen 50% el precio es el DOBLE del costo, no costo x 1,5.');

// El recargo equivalente para varios margenes: es la tabla que va en la UI.
console.log('\n  margen sobre venta  ->  recargo sobre costo');
for (const m of [20, 30, 40, 50, 60, 70]) {
  const p = calcularPrecioSugerido(costo, m);
  const recargo = Math.round(((p - costo) / costo) * 1000) / 10;
  console.log(`      ${String(m).padStart(2)}%             ->      ${String(recargo).padStart(5)}%`);
}

/* ================================================================== */
console.log('\nCASO 4 — La comision de plataforma se divide, no se suma');
linea();
const COMISION = 13; // MercadoLibre
const rc = calcularCosteo({
  insumos: [{ insumoId: '1', nombre: 'Taza', tipo: 'PRODUCTO_BASE', unidadUso: 'UNIDAD', cantidad: 1, precioPorUnidadUso: taza },
            { insumoId: '2', nombre: 'Papel', tipo: 'PAPEL', unidadUso: 'HOJA', cantidad: 1, precioPorUnidadUso: papel },
            { insumoId: '3', nombre: 'Tinta', tipo: 'TINTA', unidadUso: 'ML', cantidad: 1, precioPorUnidadUso: tinta }],
  equipos: [{ equipoId: 'i', nombre: 'Impresora', unidadesConsumidas: 1, minutosUso: 0, amortizacionPorUnidad: amortImpresora, consumoWatts: 30 },
            { equipoId: 'p', nombre: 'Plancha', unidadesConsumidas: 1, minutosUso: 0, amortizacionPorUnidad: amortPlancha, consumoWatts: 1400 }],
  minutosManoObra: 0, valorHoraManoObra: 0, costoKwh: 0, otrosGastos: 0,
  porcentajeMerma: 3, margen: 50, comisionPlataforma: COMISION,
});

const bien = rc.precioVentaFinal;
const mal = Math.round(rc.precioSugerido * 1.13);
const netoBien = bien - Math.round(bien * 0.13);
const netoMal = mal - Math.round(mal * 0.13);

console.log(`  Precio sugerido (antes de comision)  ${formatearMilicentavos(rc.precioSugerido)}`);
console.log(`  Dividiendo por (1 - 0,13)            ${formatearMilicentavos(bien)}  -> te queda ${formatearMilicentavos(netoBien)}`);
console.log(`  Sumando 13% al precio                ${formatearMilicentavos(mal)}  -> te queda ${formatearMilicentavos(netoMal)}`);
chequear('dividir recupera el sugerido', formatearMilicentavos(netoBien), formatearMilicentavos(rc.precioSugerido));
console.log(`  Sumar la comision te hace perder ${formatearMilicentavos(netoBien - netoMal)} por unidad.`);

/* ================================================================== */
console.log('\nCASO 5 — Insumo sin precio: calcula igual y avisa');
linea();
const rp = calcularCosteo({
  insumos: [
    { insumoId: '1', nombre: 'Taza', tipo: 'PRODUCTO_BASE', unidadUso: 'UNIDAD', cantidad: 1, precioPorUnidadUso: taza },
    { insumoId: '9', nombre: 'Caja de carton', tipo: 'PACKAGING', unidadUso: 'UNIDAD', cantidad: 1, precioPorUnidadUso: null },
  ],
  equipos: [], minutosManoObra: 0, valorHoraManoObra: 0, costoKwh: 0, otrosGastos: 0,
  porcentajeMerma: 3, margen: 50, comisionPlataforma: 0,
});
chequear('completo', rp.completo, false);
chequear('sigue dando un precio', formatearMilicentavos(rp.precioVentaFinal), '$ 10.094,00');
console.log(`  Aviso: ${rp.advertencias[0].detalle}`);

/* ================================================================== */
console.log('\nCASO 6 — Energia y mano de obra (lo que la planilla no tenia)');
linea();
const re = calcularCosteo({
  insumos: [{ insumoId: '1', nombre: 'Taza', tipo: 'PRODUCTO_BASE', unidadUso: 'UNIDAD', cantidad: 1, precioPorUnidadUso: taza }],
  equipos: [
    { equipoId: 'i', nombre: 'Impresora', unidadesConsumidas: 1, minutosUso: 2, amortizacionPorUnidad: amortImpresora, consumoWatts: 30 },
    { equipoId: 'p', nombre: 'Plancha', unidadesConsumidas: 1, minutosUso: 5, amortizacionPorUnidad: amortPlancha, consumoWatts: 1400 },
  ],
  minutosManoObra: 6,
  valorHoraManoObra: pesosAMilicentavos(8000), // $8.000 la hora
  costoKwh: pesosAMilicentavos(120),           // $120 el kWh
  otrosGastos: 0, porcentajeMerma: 3, margen: 50, comisionPlataforma: 0,
});
// plancha: 5 min x 1400 W = 0,11667 kWh x $120 = $14,00 ; impresora: 2 min x 30 W = $0,12
chequear('mano de obra (6 min a $8.000/h)', formatearMilicentavos(re.manoObra), '$ 800,00');
chequear('energia (impresora + plancha)', formatearMilicentavos(re.energia), '$ 14,12');
chequear('amortizaciones', formatearMilicentavos(re.amortizaciones), '$ 83,40');
console.log('  Un solo "minutosEquipo" no podria repartir 2 min a 30 W y 5 min a 1400 W.');

/* ================================================================== */
console.log('\nCASO 7 — Totales del presupuesto');
linea();
const precioUnit = aCentavos(r.precioSugerido);
const items = [
  { productoId: 'p1', cantidad: 50, subtotal: calcularSubtotalItem(precioUnit, 50) },
];
const tramos = [{ desdeCantidad: 10, porcentaje: 5 }, { desdeCantidad: 50, porcentaje: 10 }];
chequear('tramo para 50 unidades', porcentajeDeTramo(50, tramos), 10);

const t = calcularTotales(items, { tipo: 'PORCENTAJE', valor: 10, automatico: true }, 'MONOTRIBUTO', 50);
console.log(`  Subtotal (50 x ${formatearCentavos(precioUnit)})    ${formatearCentavos(t.subtotal)}`);
console.log(`  Descuento por cantidad (10%)         -${formatearCentavos(t.descuento.monto)}`);
console.log(`  Neto                                  ${formatearCentavos(t.neto)}`);
console.log(`  IVA (monotributo, 0%)                 ${formatearCentavos(t.iva.monto)}`);
console.log(`  TOTAL                                 ${formatearCentavos(t.total)}`);
console.log(`  Senia 50%                             ${formatearCentavos(t.montoSenia)}`);
console.log(`  Saldo contra entrega                  ${formatearCentavos(t.saldoContraEntrega)}`);
chequear('senia + saldo = total', t.montoSenia + t.saldoContraEntrega, t.total);
chequear('subtotal - descuento = neto', t.subtotal - t.descuento.monto, t.neto);

const tRi = calcularTotales(items, null, 'RESPONSABLE_INSCRIPTO', 50);
chequear('IVA 21% de RI', tRi.iva.monto, Math.round(tRi.neto * 0.21));

/* ================================================================== */
console.log('\nCASO 8 — Vencimiento derivado, sin escribir en la base');
linea();
const emitido = new Date('2026-08-01T12:00:00Z');
const vence = new Date('2026-08-16T12:00:00Z'); // +15 dias
chequear('el mismo dia que vence: ENVIADO', resolverEstadoEfectivo('ENVIADO', vence, vence), 'ENVIADO');
chequear('al dia siguiente: VENCIDO', resolverEstadoEfectivo('ENVIADO', vence, new Date('2026-08-17T05:00:00Z')), 'VENCIDO');
chequear('un ACEPTADO no vence', resolverEstadoEfectivo('ACEPTADO', vence, new Date('2027-01-01T00:00:00Z')), 'ACEPTADO');
chequear('un BORRADOR no vence', resolverEstadoEfectivo('BORRADOR', vence, new Date('2027-01-01T00:00:00Z')), 'BORRADOR');
void emitido;

/* ================================================================== */
linea();
if (fallas === 0) {
  console.log('TODO OK — el motor reproduce la planilla y las reglas de negocio.\n');
} else {
  console.log(`${fallas} verificacion(es) fallaron.\n`);
  process.exit(1);
}
