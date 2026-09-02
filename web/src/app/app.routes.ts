import type { Routes } from '@angular/router';

/**
 * Todas las pantallas se cargan por demanda. La Calculadora es la principal y la
 * ruta por defecto: es la pantalla donde el usuario pasa el dia.
 */
export const rutas: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'calculadora' },
  {
    path: 'calculadora',
    title: 'Calculadora',
    loadComponent: () => import('./paginas/calculadora/calculadora.js').then((m) => m.Calculadora),
  },
  {
    path: 'insumos',
    title: 'Insumos',
    loadComponent: () => import('./paginas/insumos/insumos.js').then((m) => m.Insumos),
  },
  {
    path: 'precios',
    title: 'Actualizar precios',
    loadComponent: () => import('./paginas/precios/precios.js').then((m) => m.Precios),
  },
  {
    path: 'equipos',
    title: 'Equipos',
    loadComponent: () => import('./paginas/equipos/equipos.js').then((m) => m.Equipos),
  },
  {
    path: 'productos',
    title: 'Productos',
    loadComponent: () => import('./paginas/productos/productos.js').then((m) => m.Productos),
  },
  {
    path: 'presupuestos',
    title: 'Presupuestos',
    loadComponent: () =>
      import('./paginas/presupuestos/presupuestos.js').then((m) => m.Presupuestos),
  },
  {
    path: 'presupuestos/nuevo',
    title: 'Nuevo presupuesto',
    loadComponent: () =>
      import('./paginas/presupuestos/editor-presupuesto.js').then((m) => m.EditorPresupuesto),
  },
  {
    path: 'presupuestos/:id',
    title: 'Presupuesto',
    loadComponent: () =>
      import('./paginas/presupuestos/detalle-presupuesto.js').then((m) => m.DetallePresupuesto),
  },
  {
    path: 'clientes',
    title: 'Clientes',
    loadComponent: () => import('./paginas/clientes/clientes.js').then((m) => m.Clientes),
  },
  {
    path: 'configuracion',
    title: 'Configuración',
    loadComponent: () =>
      import('./paginas/configuracion/configuracion.js').then((m) => m.ConfiguracionPagina),
  },
  { path: '**', redirectTo: 'calculadora' },
];
