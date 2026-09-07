/**
 * Verificacion end-to-end de la API contra un Mongo real.
 *
 * Usa la base `sublimacion_test` y la borra al arrancar. Corre con:
 *   npm run verificar:api
 */
/**
 * Base dedicada, NUNCA "sublimacion_demo" ni "sublimacion" a secas.
 *
 * Este script arranca con dropDatabase(). Un nombre que un humano pudiera estar
 * usando para probar la app a mano es una trampa: si alguna vez volviera a
 * coincidir, correr la verificacion borraria trabajo real sin avisar. Que sea
 * literalmente "_test" es la unica garantia de que eso no vuelva a pasar.
 */
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/sublimacion_test';
process.env.NODE_ENV = 'test';

/**
 * Puerto dedicado a esta verificacion, en una variable con nombre PROPIO
 * (`VERIFICAR_API_PORT`), no la generica `PORT`.
 *
 * Usar `PORT` a secas es lo que rompio esto: en Windows es comun que quede seteada
 * por otra herramienta (IIS Express, algun launcher, un dev server previo) con un
 * valor que `Number()` no puede convertir, y entonces `listen(NaN)` explota con un
 * stack de Node que no dice nada sobre la causa real. Se valida ademas de forma
 * explicita, para que un valor invalido falle con un mensaje legible.
 */
const puerto = Number(process.env.VERIFICAR_API_PORT ?? 3999);
if (!Number.isInteger(puerto) || puerto <= 0 || puerto >= 65536) {
  throw new Error(
    `VERIFICAR_API_PORT tiene un valor invalido: "${process.env.VERIFICAR_API_PORT}". ` +
      'Tiene que ser un entero entre 1 y 65535, o no estar seteada (usa 3999 por defecto).',
  );
}

const { crearApp } = await import('../api/dist/app.js');
const { desconectar } = await import('../api/dist/db.js');
// Generar PDFs deja Chromium vivo (a proposito: se reusa entre pedidos). Sin
// cerrarlo, el proceso del script nunca termina.
const { cerrarNavegador } = await import('../api/dist/pdf/generador.js');
const mongoose = (await import('mongoose')).default;
const { formatearCentavos, pesosACentavos } = await import('../shared/dist/index.js');

let fallas = 0;
const linea = () => console.log('─'.repeat(70));
function chequear(etiqueta, obtenido, esperado) {
  const ok = String(obtenido) === String(esperado);
  if (!ok) fallas++;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta.padEnd(48)} ${String(obtenido)}` +
    (ok ? '' : `   esperaba ${esperado}`));
}

// Se conecta en crudo, se limpia y RECIEN AHI se crean los indices. Usar conectar()
// aca fallaria: intentaria indexar la base sucia de la corrida anterior.
await mongoose.connect(process.env.MONGO_URI);
await mongoose.connection.dropDatabase();
await mongoose.syncIndexes();
const servidor = crearApp().listen(puerto);
const BASE = `http://127.0.0.1:${puerto}/api`;

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
  const texto = await r.text();
  const json = texto ? JSON.parse(texto) : null;
  return { estado: r.status, json };
}
const ok = async (m, r, c) => {
  const res = await api(m, r, c);
  if (res.estado >= 400) throw new Error(`${m} ${r} -> ${res.estado} ${JSON.stringify(res.json)}`);
  return res.json;
};

try {
  /* ============================================================== */
  console.log('\nCONFIGURACION — singleton unico (empresa + costos + defaults)');
  linea();
  const cfg = await ok('PUT', '/configuracion', {
    empresa: {
      nombre: 'Sublimarte',
      cuit: '20-12345678-9',
      direccion: 'San Martin 450',
      whatsapp: '+54 9 351 555-1234',
      email: 'hola@sublimarte.com.ar',
      condicionIva: 'MONOTRIBUTO',
    },
    costos: { valorHoraManoObra: pesosACentavos(8000), costoKwh: pesosACentavos(120) },
    presupuestos: { validezDiasPorDefecto: 15, porcentajeSeniaPorDefecto: 50, puntoVenta: 1 },
  });
  chequear('empresa guardada', cfg.empresa.nombre, 'Sublimarte');
  chequear('costos guardados', cfg.costos.valorHoraManoObra, 800000);

  // Un PUT parcial no debe borrar lo que no vino.
  const cfg2 = await ok('PUT', '/configuracion', { costos: { costoKwh: pesosACentavos(130) } });
  chequear('PUT parcial no borra la empresa', cfg2.empresa.nombre, 'Sublimarte');
  chequear('PUT parcial no borra el otro costo', cfg2.costos.valorHoraManoObra, 800000);
  await ok('PUT', '/configuracion', { costos: { costoKwh: pesosACentavos(120) } });

  /* ============================================================== */
  console.log('\nINSUMOS Y PRECIOS — el historico');
  linea();
  const taza = await ok('POST', '/insumos', { nombre: 'Taza magica negra', tipo: 'PRODUCTO_BASE', unidadUso: 'UNIDAD' });
  const papel = await ok('POST', '/insumos', { nombre: 'Papel de sublimacion', tipo: 'PAPEL', unidadUso: 'HOJA' });
  const tinta = await ok('POST', '/insumos', { nombre: 'Tinta sublimatica', tipo: 'TINTA', unidadUso: 'ML' });

  await ok('POST', `/insumos/${taza.id}/precios`, {
    presentacion: { cantidad: 1, unidad: 'UNIDAD' }, precioPresentacion: pesosACentavos(4900), proveedor: 'Insumos SRL',
  });
  const pPapel = await ok('POST', `/insumos/${papel.id}/precios`, {
    presentacion: { cantidad: 500, unidad: 'HOJA' }, precioPresentacion: pesosACentavos(17653), proveedor: 'Insumos SRL',
  });
  await ok('POST', `/insumos/${tinta.id}/precios`, {
    presentacion: { cantidad: 100, unidad: 'ML' }, precioPresentacion: pesosACentavos(1815),
  });
  chequear('resma 500 a $17.653 -> por hoja (milicentavos)', pPapel.precioPorUnidadUso, 3530600);

  const conPrecios = await ok('GET', '/insumos/con-precios');
  chequear('los 3 insumos con su precio vigente', conPrecios.datos.length, 3);
  chequear('precio de hoy no esta desactualizado', conPrecios.datos[0].precioDesactualizado, false);
  chequear('dias desde el ultimo precio', conPrecios.datos[0].diasDesdeUltimoPrecio, 0);

  /* ============================================================== */
  console.log('\nEQUIPOS — amortizacion derivada');
  linea();
  const impresora = await ok('POST', '/equipos', {
    nombre: 'Impresora Epson L1300', costoAdquisicion: pesosACentavos(845000),
    vidaUtilUnidades: 100000, consumoWatts: 30,
  });
  const plancha = await ok('POST', '/equipos', {
    nombre: 'Plancha para tazas', costoAdquisicion: pesosACentavos(299800),
    vidaUtilUnidades: 4000, consumoWatts: 1400,
  });
  chequear('amortizacion impresora', impresora.amortizacionPorUnidad, 845000);
  chequear('amortizacion plancha', plancha.amortizacionPorUnidad, 7495000);

  /* ============================================================== */
  console.log('\nPRODUCTO Y COSTEO — el ejemplo de la planilla, por HTTP');
  linea();
  const producto = await ok('POST', '/productos', {
    nombre: 'Taza magica negra — sublimacion full color',
    categoria: 'Tazas',
    insumos: [
      { insumo: taza.id, cantidad: 1 },
      { insumo: papel.id, cantidad: 1 },
      { insumo: tinta.id, cantidad: 1 },
    ],
    // minutosUso en 0 para reproducir la planilla, que no contemplaba energia.
    equipos: [
      { equipo: impresora.id, unidadesConsumidas: 1, minutosUso: 0 },
      { equipo: plancha.id, unidadesConsumidas: 1, minutosUso: 0 },
    ],
    minutosManoObra: 0,
    porcentajeMerma: 3,
    margen: 50,
    tramosDescuento: [{ desdeCantidad: 10, porcentaje: 5 }, { desdeCantidad: 50, porcentaje: 10 }],
  });

  const { costeo } = await ok('GET', `/productos/${producto.id}/costeo`);
  chequear('subtotal', formatearCentavos(Math.round(costeo.subtotalCosto / 1000)), '$ 5.036,86');
  chequear('merma 3%', formatearCentavos(Math.round(costeo.merma / 1000)), '$ 151,11');
  chequear('costo total unitario', formatearCentavos(Math.round(costeo.costoTotalUnitario / 1000)), '$ 5.187,96');
  chequear('precio sugerido (margen 50%)', formatearCentavos(Math.round(costeo.precioSugerido / 1000)), '$ 10.375,92');
  chequear('recargo sobre costo', costeo.recargoSobreCosto, 100);
  chequear('costeo completo', costeo.completo, true);

  // La comision es del canal: se pisa por query, sin duplicar el producto.
  const ml = await ok('GET', `/productos/${producto.id}/costeo?comisionPlataforma=13`);
  chequear('mismo producto por ML (13%)', formatearCentavos(Math.round(ml.costeo.precioVentaFinal / 1000)), '$ 11.926,35');

  /* ============================================================== */
  console.log('\nPRESUPUESTO — borrador, emision y congelamiento');
  linea();
  const cliente = await ok('POST', '/clientes', {
    nombreRazonSocial: 'Panaderia La Esquina', cuitDni: '30-71234567-4',
    direccion: 'Belgrano 1200', localidad: 'Cordoba', telefono: '351 444-5566',
  });

  const borrador = await ok('POST', '/presupuestos', {
    clienteId: cliente.id,
    items: [{ productoId: producto.id, cantidad: 50 }],
  });
  chequear('nace en BORRADOR', borrador.estado, 'BORRADOR');
  chequear('BORRADOR sin numero', borrador.numero, 'null');
  chequear('precio unitario tomado del motor', formatearCentavos(borrador.items[0].precioUnitario), '$ 10.375,92');
  chequear('costo del momento congelado', formatearCentavos(borrador.items[0].costoUnitarioAlMomento), '$ 5.187,96');
  chequear('desglose del costeo guardado', borrador.items[0].costeoAlMomento.detalleInsumos.length, 3);
  chequear('subtotal (50 unidades)', formatearCentavos(borrador.subtotal), '$ 518.796,00');
  chequear('descuento automatico por tramo (10%)', formatearCentavos(borrador.descuento.monto), '$ 51.879,60');
  chequear('el descuento se marca automatico', borrador.descuento.automatico, true);
  chequear('neto', formatearCentavos(borrador.neto), '$ 466.916,40');
  chequear('IVA monotributo', formatearCentavos(borrador.iva.monto), '$ 0,00');
  chequear('total', formatearCentavos(borrador.total), '$ 466.916,40');
  chequear('senia 50%', formatearCentavos(borrador.montoSenia), '$ 233.458,20');
  chequear('saldo contra entrega', formatearCentavos(borrador.saldoContraEntrega), '$ 233.458,20');
  chequear('cliente copiado, no referenciado', borrador.cliente.nombreRazonSocial, 'Panaderia La Esquina');

  const emitido = await ok('POST', `/presupuestos/${borrador.id}/emitir`);
  chequear('numero asignado al emitir', emitido.numero, '001-001');
  chequear('estado ENVIADO', emitido.estado, 'ENVIADO');
  chequear('estado efectivo vigente', emitido.estadoEfectivo, 'ENVIADO');

  const intentoEditar = await api('PUT', `/presupuestos/${emitido.id}`, {
    clienteId: cliente.id, items: [{ productoId: producto.id, cantidad: 99 }],
  });
  chequear('editar un emitido -> 409', intentoEditar.estado, 409);
  console.log(`     ${intentoEditar.json.error}`);

  const intentoBorrar = await api('DELETE', `/presupuestos/${emitido.id}`);
  chequear('borrar un emitido -> 409', intentoBorrar.estado, 409);

  /* ============================================================== */
  console.log('\nAUMENTO DE PRECIOS — el presupuesto emitido no se mueve');
  linea();
  await ok('POST', `/insumos/${taza.id}/precios`, {
    presentacion: { cantidad: 1, unidad: 'UNIDAD' }, precioPresentacion: pesosACentavos(6300),
  });
  const historial = await ok('GET', `/insumos/${taza.id}/precios`);
  chequear('el precio viejo sigue en el historico', historial.datos.length, 2);
  chequear('el vigente es el mas nuevo', formatearCentavos(historial.datos[0].precioPresentacion), '$ 6.300,00');

  const releido = await ok('GET', `/presupuestos/${emitido.id}`);
  chequear('el emitido conserva su precio unitario', formatearCentavos(releido.items[0].precioUnitario), '$ 10.375,92');
  chequear('el emitido conserva su total', formatearCentavos(releido.total), '$ 466.916,40');

  const duplicado = await ok('POST', `/presupuestos/${emitido.id}/duplicar`);
  chequear('el duplicado nace BORRADOR', duplicado.estado, 'BORRADOR');
  chequear('el duplicado no tiene numero todavia', duplicado.numero, 'null');
  chequear('el duplicado apunta al original', duplicado.duplicadoDeId, emitido.id);
  const subioA = formatearCentavos(duplicado.items[0].precioUnitario);
  chequear('el duplicado se recotizo mas caro', duplicado.total > releido.total, true);
  console.log(`     $ 10.375,92 -> ${subioA} por unidad, tras subir la taza de $4.900 a $6.300`);

  const emitido2 = await ok('POST', `/presupuestos/${duplicado.id}/emitir`);
  chequear('numeracion correlativa', emitido2.numero, '001-002');

  await ok('POST', `/presupuestos/${emitido.id}/estado`, { estado: 'ACEPTADO' });
  const aceptado = await ok('GET', `/presupuestos/${emitido.id}`);
  chequear('cambio de estado a ACEPTADO', aceptado.estado, 'ACEPTADO');

  const reenviar = await api('POST', `/presupuestos/${emitido.id}/estado`, { estado: 'RECHAZADO' });
  chequear('un ACEPTADO no pasa a RECHAZADO -> 409', reenviar.estado, 409);

  /* ============================================================== */
  console.log('\nCARGA MASIVA DE PRECIOS — la lista del proveedor de una vez');
  linea();
  const lote = await ok('POST', '/insumos/precios/lote', {
    precios: [
      { insumoId: papel.id, presentacion: { cantidad: 500, unidad: 'HOJA' }, precioPresentacion: pesosACentavos(19800), proveedor: 'Insumos SRL' },
      { insumoId: tinta.id, presentacion: { cantidad: 100, unidad: 'ML' }, precioPresentacion: pesosACentavos(2100), proveedor: 'Insumos SRL' },
    ],
  });
  chequear('precios cargados en un solo pedido', lote.cargados, 2);

  const loteMalo = await api('POST', '/insumos/precios/lote', {
    precios: [
      { insumoId: papel.id, presentacion: { cantidad: 500, unidad: 'HOJA' }, precioPresentacion: pesosACentavos(1) },
      { insumoId: '507f1f77bcf86cd799439011', presentacion: { cantidad: 1, unidad: 'UNIDAD' }, precioPresentacion: 100 },
    ],
  });
  chequear('un insumo inexistente aborta el lote entero', loteMalo.estado, 400);
  const papelDespues = await ok('GET', `/insumos/${papel.id}/precios`);
  chequear('no se cargo nada del lote fallido', papelDespues.datos.length, 2);

  /* ============================================================== */
  console.log('\nSTOCK — entradas y salidas a mano, siempre historico');
  linea();
  await ok('POST', `/insumos/${papel.id}/stock`, { tipo: 'ENTRADA', cantidad: 500, motivo: 'Compra a proveedor' });
  await ok('POST', `/insumos/${papel.id}/stock`, { tipo: 'SALIDA', cantidad: 30, motivo: 'Se uso en un trabajo' });

  const conStock = await ok('GET', '/insumos/con-precios');
  const papelConStock = conStock.datos.find((i) => i.id === papel.id);
  chequear('stock actual = entradas - salidas', papelConStock.stockActual, 470);
  chequear('sin minimo cargado, no es stock bajo', papelConStock.stockBajo, false);

  await ok('PATCH', `/insumos/${papel.id}`, { stockMinimo: 500 });
  const conMinimo = await ok('GET', '/insumos/con-precios');
  chequear(
    'con minimo 500 y stock 470, SI es stock bajo',
    conMinimo.datos.find((i) => i.id === papel.id).stockBajo,
    true,
  );

  const soloBajo = await ok('GET', '/insumos/con-precios?soloStockBajo=true');
  chequear('filtro soloStockBajo trae solo ese insumo', soloBajo.datos.length, 1);
  chequear('y es el correcto', soloBajo.datos[0].id, papel.id);

  const historialStock = await ok('GET', `/insumos/${papel.id}/stock`);
  chequear('historial: 2 movimientos', historialStock.datos.length, 2);
  chequear('el mas nuevo primero (la salida)', historialStock.datos[0].tipo, 'SALIDA');

  // Una salida mayor al stock disponible no se bloquea: es una senal real
  // (se cargo de menos, o se perdio mas de lo registrado), no un error de carga.
  await ok('POST', `/insumos/${papel.id}/stock`, { tipo: 'SALIDA', cantidad: 1000 });
  const conStockNegativo = await ok('GET', '/insumos/con-precios');
  chequear(
    'una salida mayor al stock disponible se permite (stock negativo)',
    conStockNegativo.datos.find((i) => i.id === papel.id).stockActual,
    -530,
  );

  const movimientoInvalido = await api('POST', `/insumos/${papel.id}/stock`, { tipo: 'SALIDA', cantidad: 0 });
  chequear('cantidad 0 se rechaza -> 400', movimientoInvalido.estado, 400);

  await ok('PATCH', `/insumos/${papel.id}`, { stockMinimo: 0 });

  /* ============================================================== */
  console.log('\nCOSTEO PARCIAL — un insumo sin precio no rompe nada');
  linea();
  const caja = await ok('POST', '/insumos', { nombre: 'Caja de carton', tipo: 'PACKAGING', unidadUso: 'UNIDAD' });
  const parcial = await ok('POST', '/costeo', {
    insumos: [{ insumoId: taza.id, cantidad: 1 }, { insumoId: caja.id, cantidad: 1 }],
    equipos: [], margen: 50,
  });
  chequear('devuelve precio igual', parcial.precioVentaFinal > 0, true);
  chequear('marcado como incompleto', parcial.completo, false);
  console.log(`     ${parcial.advertencias[0].detalle}`);

  /* ============================================================== */
  console.log('\nVALIDACIONES');
  linea();
  const margen100 = await api('POST', '/productos', { nombre: 'Imposible', margen: 100 });
  chequear('margen 100% rechazado -> 400', margen100.estado, 400);
  console.log(`     ${margen100.json.detalles[0].mensaje}`);

  const decimales = await api('POST', '/equipos', {
    nombre: 'Con centavos rotos', costoAdquisicion: 1000.5, vidaUtilUnidades: 10,
  });
  chequear('monto con decimales rechazado -> 400', decimales.estado, 400);

  const duplicado2 = await api('POST', '/insumos', { nombre: 'Taza magica negra', tipo: 'OTRO', unidadUso: 'UNIDAD' });
  chequear('nombre de insumo repetido -> 409', duplicado2.estado, 409);
  console.log(`     ${duplicado2.json.error}`);

  /**
   * Dos clientes SIN CUIT tienen que poder coexistir (el consumidor final se
   * carga sin CUIT). Con un indice sparse compuesto mal armado, el segundo
   * chocaba contra el primero con un 409 falso — bug real que encontramos
   * probando la app en la practica.
   */
  const consumidor1 = await ok('POST', '/clientes', { nombreRazonSocial: 'Consumidor Final' });
  const consumidor2 = await api('POST', '/clientes', { nombreRazonSocial: 'Consumidor Final 2' });
  chequear('segundo cliente sin CUIT no choca con el primero', consumidor2.estado, 201);
  // Un CUIT SI repetido tiene que seguir rechazandose.
  await ok('POST', '/clientes', { nombreRazonSocial: 'Con Cuit', cuitDni: '20-11111111-1' });
  const cuitRepetido = await api('POST', '/clientes', {
    nombreRazonSocial: 'Otro con el mismo CUIT',
    cuitDni: '20-11111111-1',
  });
  chequear('CUIT repetido si se rechaza -> 409', cuitRepetido.estado, 409);

  const sinCliente = await api('POST', '/presupuestos', { items: [{ productoId: producto.id, cantidad: 1 }] });
  chequear('presupuesto sin cliente -> 400', sinCliente.estado, 400);

  const inexistente = await api('GET', '/productos/507f1f77bcf86cd799439011');
  chequear('producto inexistente -> 404', inexistente.estado, 404);

  const idRoto = await api('GET', '/productos/no-es-un-id');
  chequear('id invalido -> 400', idRoto.estado, 400);

  /* ============================================================== */
  console.log('\nLISTADOS');
  linea();
  const resumen = await ok('GET', '/presupuestos/resumen');
  chequear('resumen: 1 aceptado', resumen.ACEPTADO.cantidad, 1);
  chequear('resumen: 1 enviado', resumen.ENVIADO.cantidad, 1);

  const enviados = await ok('GET', '/presupuestos?estado=ENVIADO');
  chequear('filtro por estado efectivo', enviados.datos.length, 1);

  const busqueda = await ok('GET', '/presupuestos?busqueda=Panaderia');
  chequear('busqueda por nombre de cliente', busqueda.total, 2);

  await ok('DELETE', `/insumos/${caja.id}`);
  const activos = await ok('GET', '/insumos');
  chequear('baja logica: sale del listado', activos.datos.some((i) => i.id === caja.id), false);
  const todos = await ok('GET', '/insumos?soloActivos=false');
  chequear('baja logica: el registro sigue existiendo', todos.datos.some((i) => i.id === caja.id), true);

  // Un cliente dado de baja tiene que poder reactivarse: es la unica forma de
  // recuperar uno que desapareció del listado por error (o a proposito).
  await ok('DELETE', `/clientes/${consumidor1.id}`);
  const clientesActivos = await ok('GET', '/clientes');
  chequear(
    'cliente de baja sale del listado normal',
    clientesActivos.datos.some((c) => c.id === consumidor1.id),
    false,
  );
  const clientesTodos = await ok('GET', '/clientes?soloActivos=false');
  chequear(
    'con soloActivos=false sigue apareciendo',
    clientesTodos.datos.some((c) => c.id === consumidor1.id),
    true,
  );
  await ok('PATCH', `/clientes/${consumidor1.id}`, { activo: true });
  const clientesReactivado = await ok('GET', '/clientes');
  chequear(
    'reactivado, vuelve al listado normal',
    clientesReactivado.datos.some((c) => c.id === consumidor1.id),
    true,
  );

  /* ============================================================== */
  console.log('\nPDF Y COMPARTIR — las salidas del presupuesto');
  linea();
  const rPdf = await fetch(BASE + '/presupuestos/' + emitido.id + '/pdf');
  const buf = Buffer.from(await rPdf.arrayBuffer());
  chequear('GET /pdf responde 200', rPdf.status, 200);
  chequear('content-type es application/pdf', rPdf.headers.get('content-type'), 'application/pdf');
  chequear('es un PDF valido', buf.subarray(0, 5).toString('latin1'), '%PDF-');
  chequear('descarga como adjunto', rPdf.headers.get('content-disposition').startsWith('attachment'), true);
  chequear('nombre de archivo con numero y cliente',
    /filename="Presupuesto-001-001-Panaderia-La-Esquina.pdf"/.test(rPdf.headers.get('content-disposition')), true);
  chequear('un emitido se cachea para siempre',
    rPdf.headers.get('cache-control').includes('immutable'), true);

  const rInline = await fetch(BASE + '/presupuestos/' + emitido.id + '/pdf?descargar=false');
  chequear('descargar=false lo sirve inline (para el iframe)',
    rInline.headers.get('content-disposition').startsWith('inline'), true);

  // Previsualizar ANTES de emitir: el borrador tambien tiene que generar PDF.
  const borradorNuevo = await ok('POST', '/presupuestos', {
    clienteId: cliente.id, items: [{ productoId: producto.id, cantidad: 3 }],
  });
  const rBorrador = await fetch(BASE + '/presupuestos/' + borradorNuevo.id + '/pdf?descargar=false');
  chequear('un BORRADOR se puede previsualizar', rBorrador.status, 200);
  chequear('el borrador no se cachea', rBorrador.headers.get('cache-control'), 'no-store');

  const rHtml = await fetch(BASE + '/presupuestos/' + emitido.id + '/vista-previa');
  const htmlVista = await rHtml.text();
  chequear('vista previa HTML responde 200', rHtml.status, 200);
  chequear('la vista previa trae el total', htmlVista.includes('$ 466.916,40'), true);

  const wa = await ok('GET', '/presupuestos/' + emitido.id + '/whatsapp');
  chequear('telefono normalizado con codigo de pais', wa.telefono, '543514445566');
  chequear('el link es de wa.me', wa.url.startsWith('https://wa.me/543514445566?text='), true);
  chequear('el mensaje trae el total', wa.mensaje.includes('$ 466.916,40'), true);
  chequear('el mensaje trae la senia', wa.mensaje.includes('Seña 50%'), true);
  chequear('el mensaje trae el vencimiento', wa.mensaje.includes('Válido hasta el'), true);
  chequear('no tutea a una razon social', wa.mensaje.startsWith('Hola, '), true);
  console.log('     ---------------------------------------------');
  console.log(wa.mensaje.split('\n').map((l) => '     ' + l).join('\n'));
  console.log('     ---------------------------------------------');
} finally {
  servidor.close();
  await Promise.all([desconectar(), cerrarNavegador()]);
}

linea();
if (fallas === 0) {
  console.log('TODO OK — la API cumple las reglas de negocio end-to-end.\n');
} else {
  console.log(`${fallas} verificacion(es) fallaron.\n`);
  process.exit(1);
}
