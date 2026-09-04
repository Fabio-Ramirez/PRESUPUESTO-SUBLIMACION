# Calculadora PRO de Sublimación

Reemplaza la planilla de Excel de costeo de artículos sublimados: costo de producción,
precio de venta con margen, y presupuesto en PDF para mandar por WhatsApp.

## Estado

Las cuatro fases están hechas.

| Fase | |
|---|---|
| 1 | `/shared` (tipos + motor de cálculo) y esquemas Mongoose |
| 2 | API — Express 5 + Mongoose |
| 3 | Motor de PDF — Puppeteer + plantilla HTML/SCSS |
| 4 | Front — Angular 22, standalone, signals, `@if` / `@for` |

## Estructura

```
estilos/         tokens y mixins SCSS compartidos entre el PDF y el front
  _tokens.scss      colores, tipografía, espaciado, colores por estado
  _mixins.scss      importe, etiqueta, panel, chip, sin-cortar
shared/          tipos del dominio + motor de cálculo (lo usan API y front)
  src/dinero.ts     centavos y milicentavos, formato es-AR
  src/enums.ts      enums y valores por defecto
  src/modelo.ts     interfaces del dominio (contrato de transporte)
  src/calculo/
    costeo.ts       el motor: insumos -> costo -> precio sugerido -> precio final
    derivados.ts    campos que nunca se cargan a mano + fechas de Argentina
    presupuesto.ts  totales, descuentos por tramo, estados
api/
  src/models/       esquemas Mongoose
  src/servicios/    reglas de negocio (costeo, presupuestos, precios)
  src/rutas/        endpoints REST
  src/http/         validación (zod), errores, CRUD genérico
  src/dto/          mappers documento -> contrato de /shared
  src/pdf/          plantilla.ts (HTML tipado), estilos.scss, generador.ts
web/
  src/app/nucleo/     cliente HTTP tipado, pipes de formato, catálogo, avisos
  src/app/paginas/    calculadora, insumos, precios, equipos, productos,
                      presupuestos, clientes, configuración
scripts/
  verificar-planilla.mjs   reproduce el ejemplo del Excel, fila por fila
  verificar-esquemas.mjs   valida hooks y derivados sin conectar a Mongo
  verificar-api.mjs        flujo completo end-to-end contra Mongo real
  verificar-pdf.mjs        SCSS, HTML y PDF real (deja archivos en salida/)
```

## Correr

Hace falta MongoDB corriendo en `localhost:27017`.

```bash
npm install
```

API (puerto 3000):

```bash
npm run api
```

Front (puerto 4200, con proxy a la API):

```bash
npm run web
```

## Verificar

```bash
npm run verificar:todo
```

Corre las cuatro suites y compila el front. `npm run verificar` corre solo las dos que
no necesitan base de datos. Salen con código 1 si algún número no coincide.

## Decisiones que conviene conocer antes de tocar el código

**Dos unidades de dinero, no una.** Lo facturable va en centavos enteros. Lo que sale
de una división —precio por hoja, amortización por unidad— va en *milicentavos*
(centavo/1000). La planilla original arrastra decimales ocultos: el papel que muestra
`$35,31` vale `$35,306`. Sin la precisión sub-centavo el costo se corre, y el error se
duplica al dividir por `(1 − margen)`. Detalle en `shared/src/dinero.ts`.

**El motor vive en `/shared`, no en la API.** La calculadora del front lo corre con
cada tecla y la API lo corre al emitir. Duplicado, tarde o temprano divergen y el
presupuesto emitido deja de coincidir con lo que el usuario vio en pantalla.

**El margen se divide, no se multiplica.** `precio = costo / (1 − margen)`. Con 50% el
precio es el doble del costo. Lo mismo la comisión de plataforma, que se cobra sobre el
precio final: sumarla al costo recupera de menos.

**Los precios de insumo son inmutables.** No se editan ni se borran; se agrega uno nuevo.
El esquema bloquea `update` y `delete` a nivel de modelo, no solo en el service.

**Un presupuesto emitido no se recalcula.** Congela cliente, precios y costos. Para
recotizar existe "duplicar con precios actuales". El hook `pre('save')` rechaza cambios
en los campos congelados, con una única excepción: la asignación de `numero` durante la
propia emisión.

**VENCIDO es derivado, no persistido.** Se calcula al leer con un virtual. Marcarlo en
cada consulta convertiría un listado de 200 presupuestos en 200 escrituras.

**Los estilos viven en `estilos/`, no dentro de la API ni del front.** Los tokens SCSS
son los mismos para el PDF y para la pantalla: el mapa `$estados` genera las clases del
sello del PDF y los chips del listado, así que un `VENCIDO` no puede ser naranja en un
lado y rojo en el otro. Angular los toma por `stylePreprocessorOptions.includePaths`.
Los colores se comparten; las escalas tipográficas no, porque el papel se mide en `pt`
y la pantalla en `rem`.

**El SCSS del PDF se compila en runtime.** En desarrollo se toca un color y el siguiente
PDF ya sale distinto; en producción se compila una vez y queda cacheado.

**Una sola instancia de Chromium para todo el proceso.** Arrancarlo cuesta ~1,3 s;
generar una página en uno ya abierto, ~0,5 s. Se cierra en el apagado ordenado.

**El front es zoneless.** Todo se apoya en signals, así que no hay nada que zone.js
tenga que parchear.

**"Emitido", no "Enviado".** Asignar el número correlativo no implica que el
presupuesto se haya mandado por algún canal — esa es una acción manual (WhatsApp,
email) que el sistema no puede confirmar. El valor interno del enum sigue siendo
`ENVIADO` por compatibilidad con la numeración y las transiciones ya definidas; solo
cambió la palabra que ve el usuario (`ETIQUETAS_ESTADO` en `shared/src/enums.ts`).

## Fuera de alcance

Facturación electrónica AFIP, stock, órdenes de producción, cobros y pagos,
multi-usuario, app mobile. Los esquemas ya llevan `organizacionId` con índices
compuestos, así que agregar multi-usuario será llenar el campo, no migrar colecciones.
