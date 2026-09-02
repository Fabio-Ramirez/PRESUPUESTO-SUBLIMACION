/**
 * Verifica los esquemas Mongoose sin conectar a Mongo: la validacion, los hooks
 * pre('validate') y los virtuals corren en memoria.
 */
import {
  EquipoModel,
  PrecioInsumoModel,
  ProductoModel,
  PresupuestoModel,
} from '../api/dist/models/index.js';
import { formatearMilicentavos, formatearFecha, pesosACentavos } from '../shared/dist/index.js';
import { Types } from 'mongoose';

let fallas = 0;
const linea = () => console.log('─'.repeat(66));
function chequear(etiqueta, obtenido, esperado) {
  const ok = String(obtenido) === String(esperado);
  if (!ok) fallas++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta.padEnd(46)} ${String(obtenido)}` +
    (ok ? '' : `   esperaba ${esperado}`));
}
const oid = () => new Types.ObjectId();

console.log('\nEQUIPO — la amortizacion se deriva, no se carga');
linea();
const impresora = new EquipoModel({
  nombre: 'Impresora Epson L1300',
  costoAdquisicion: pesosACentavos(845_000),
  vidaUtilUnidades: 100_000,
  consumoWatts: 30,
});
await impresora.validate();
chequear('amortizacion por unidad', formatearMilicentavos(impresora.amortizacionPorUnidad), '$ 8,45');

// Se recalcula al editar: si no, todos los costeos siguientes mienten.
impresora.costoAdquisicion = pesosACentavos(1_200_000);
await impresora.validate();
chequear('recalcula al cambiar el costo', formatearMilicentavos(impresora.amortizacionPorUnidad), '$ 12,00');

const roto = new EquipoModel({ nombre: 'X', costoAdquisicion: 100, vidaUtilUnidades: 0, consumoWatts: 0 });
const errEquipo = await roto.validate().then(() => null, (e) => e);
chequear('vida util 0 es invalida', errEquipo?.errors?.vidaUtilUnidades != null, true);

console.log('\nPRECIO INSUMO — precio por unidad de uso derivado');
linea();
const precio = new PrecioInsumoModel({
  insumo: oid(),
  presentacion: { cantidad: 500, unidad: 'HOJA' },
  precioPresentacion: pesosACentavos(17_653),
  proveedor: 'Sublimarte',
});
await precio.validate();
chequear('resma de 500 a $17.653 -> por hoja', formatearMilicentavos(precio.precioPorUnidadUso), '$ 35,31');
chequear('guardado en milicentavos (exacto)', precio.precioPorUnidadUso, 3_530_600);

console.log('\nPRODUCTO — topes que evitan dividir por cero');
linea();
const base = { nombre: 'Taza magica', categoria: 'Tazas', insumos: [], equipos: [] };
const p100 = new ProductoModel({ ...base, margen: 100 });
const errMargen = await p100.validate().then(() => null, (e) => e);
chequear('margen 100% rechazado', errMargen?.errors?.margen != null, true);
console.log(`     ${errMargen.errors.margen.message}`);

const pOk = new ProductoModel({ ...base, nombre: 'Taza ok' });
await pOk.validate();
chequear('defaults: merma 3 / margen 50 / comision 0',
  `${pOk.porcentajeMerma}/${pOk.margen}/${pOk.comisionPlataforma}`, '3/50/0');

const pTramos = new ProductoModel({
  ...base, nombre: 'Taza tramos',
  tramosDescuento: [{ desdeCantidad: 50, porcentaje: 10 }, { desdeCantidad: 10, porcentaje: 5 }],
});
await pTramos.validate();
chequear('tramos ordenados por cantidad',
  pTramos.tramosDescuento.map((t) => t.desdeCantidad).join(','), '10,50');

const pDup = new ProductoModel({
  ...base, nombre: 'Taza dup',
  tramosDescuento: [{ desdeCantidad: 10, porcentaje: 5 }, { desdeCantidad: 10, porcentaje: 8 }],
});
const errDup = await pDup.validate().then(() => null, (e) => e);
chequear('dos tramos desde la misma cantidad: error', errDup?.errors?.tramosDescuento != null, true);

console.log('\nPRESUPUESTO — validoHasta y estado efectivo');
linea();
const pres = new PresupuestoModel({
  fecha: new Date('2026-08-01T12:00:00Z'),
  validezDias: 15,
  cliente: { nombreRazonSocial: 'Juan Perez' },
  iva: { condicion: 'MONOTRIBUTO', alicuota: 0, monto: 0 },
  items: [{ descripcion: 'Taza magica full color', cantidad: 50,
            precioUnitario: 1_037_592, subtotal: 51_879_600, costoUnitarioAlMomento: 518_796 }],
});
await pres.validate();
chequear('validoHasta = fecha + 15 dias', formatearFecha(pres.validoHasta), '16/08/2026');
chequear('nace BORRADOR', pres.estado, 'BORRADOR');
chequear('BORRADOR sin numero asignado', pres.numero, 'null');
chequear('un BORRADOR vencido sigue BORRADOR', pres.estadoEfectivo, 'BORRADOR');

pres.estado = 'ENVIADO';
chequear('ENVIADO pasado de fecha -> VENCIDO', pres.estadoEfectivo, 'VENCIDO');

const vigente = new PresupuestoModel({
  fecha: new Date(), validezDias: 15, estado: 'ENVIADO',
  cliente: { nombreRazonSocial: 'Ana Gomez' },
  iva: { condicion: 'MONOTRIBUTO', alicuota: 0, monto: 0 },
});
await vigente.validate();
chequear('ENVIADO en fecha sigue ENVIADO', vigente.estadoEfectivo, 'ENVIADO');

console.log('\nMONTOS — solo enteros');
linea();
const decimal = new EquipoModel({
  nombre: 'Plancha', costoAdquisicion: 299_800.5, vidaUtilUnidades: 4000, consumoWatts: 1400,
});
const errDec = await decimal.validate().then(() => null, (e) => e);
chequear('un monto con decimales se rechaza', errDec?.errors?.costoAdquisicion != null, true);
console.log(`     ${errDec.errors.costoAdquisicion.message}`);

linea();
if (fallas === 0) {
  console.log('TODO OK — los esquemas validan y derivan lo que corresponde.\n');
} else {
  console.log(`${fallas} verificacion(es) fallaron.\n`);
  process.exit(1);
}
