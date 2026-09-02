import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  Cliente,
  Configuracion,
  Equipo,
  EstadoPresupuesto,
  Insumo,
  InsumoConPrecio,
  PrecioInsumo,
  Presupuesto,
  Producto,
  ResultadoCosteo,
  UnidadUso,
} from '@calc/shared';

/**
 * Cliente HTTP.
 *
 * Los tipos de retorno son los de /shared, los mismos que devuelve la API: no hay
 * interfaces duplicadas del lado del front, asi que renombrar un campo del dominio
 * rompe la compilacion de los dos lados a la vez.
 */

export interface Pagina<T> {
  datos: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

type Filtros = Record<string, string | number | boolean | undefined>;

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  // --- Insumos --------------------------------------------------------------

  insumos(filtros: Filtros = {}): Promise<Pagina<Insumo>> {
    return this.get<Pagina<Insumo>>('/insumos', filtros);
  }

  /** Con precio vigente, su antiguedad y el aviso de mas de 30 dias. */
  insumosConPrecios(filtros: Filtros = {}): Promise<{ datos: InsumoConPrecio[] }> {
    return this.get('/insumos/con-precios', filtros);
  }

  crearInsumo(datos: Partial<Insumo>): Promise<Insumo> {
    return this.post('/insumos', datos);
  }

  actualizarInsumo(id: string, datos: Partial<Insumo>): Promise<Insumo> {
    return this.patch(`/insumos/${id}`, datos);
  }

  desactivarInsumo(id: string): Promise<Insumo> {
    return this.delete(`/insumos/${id}`);
  }

  historialPrecios(insumoId: string): Promise<{ datos: PrecioInsumo[] }> {
    return this.get(`/insumos/${insumoId}/precios`);
  }

  cargarPrecio(insumoId: string, datos: EntradaPrecio): Promise<PrecioInsumo> {
    return this.post(`/insumos/${insumoId}/precios`, datos);
  }

  /** La lista entera del proveedor de una sola vez. */
  cargarPreciosEnLote(
    precios: (EntradaPrecio & { insumoId: string })[],
  ): Promise<{ cargados: number; precios: PrecioInsumo[] }> {
    return this.post('/insumos/precios/lote', { precios });
  }

  // --- Equipos --------------------------------------------------------------

  equipos(filtros: Filtros = {}): Promise<Pagina<Equipo>> {
    return this.get('/equipos', filtros);
  }

  crearEquipo(datos: Partial<Equipo>): Promise<Equipo> {
    return this.post('/equipos', datos);
  }

  actualizarEquipo(id: string, datos: Partial<Equipo>): Promise<Equipo> {
    return this.patch(`/equipos/${id}`, datos);
  }

  desactivarEquipo(id: string): Promise<Equipo> {
    return this.delete(`/equipos/${id}`);
  }

  // --- Productos ------------------------------------------------------------

  productos(filtros: Filtros = {}): Promise<Pagina<Producto>> {
    return this.get('/productos', filtros);
  }

  producto(id: string): Promise<Producto> {
    return this.get(`/productos/${id}`);
  }

  crearProducto(datos: EntradaProducto): Promise<Producto> {
    return this.post('/productos', datos);
  }

  actualizarProducto(id: string, datos: Partial<EntradaProducto>): Promise<Producto> {
    return this.patch(`/productos/${id}`, datos);
  }

  desactivarProducto(id: string): Promise<Producto> {
    return this.delete(`/productos/${id}`);
  }

  costeoDeProducto(
    id: string,
    overrides: Filtros = {},
  ): Promise<{ producto: Producto; costeo: ResultadoCosteo }> {
    return this.get(`/productos/${id}/costeo`, overrides);
  }

  /**
   * Costeo de una receta que todavia no es producto.
   *
   * La Calculadora NO usa esto en cada tecla: recalcula localmente con el motor de
   * /shared. Queda para el primer render y para confirmar contra el servidor.
   */
  costear(receta: RecetaAdHoc): Promise<ResultadoCosteo> {
    return this.post('/costeo', receta);
  }

  // --- Clientes -------------------------------------------------------------

  clientes(filtros: Filtros = {}): Promise<Pagina<Cliente>> {
    return this.get('/clientes', filtros);
  }

  crearCliente(datos: Partial<Cliente>): Promise<Cliente> {
    return this.post('/clientes', datos);
  }

  actualizarCliente(id: string, datos: Partial<Cliente>): Promise<Cliente> {
    return this.patch(`/clientes/${id}`, datos);
  }

  desactivarCliente(id: string): Promise<Cliente> {
    return this.delete(`/clientes/${id}`);
  }

  // --- Presupuestos ---------------------------------------------------------

  presupuestos(filtros: Filtros = {}): Promise<Pagina<Presupuesto>> {
    return this.get('/presupuestos', filtros);
  }

  presupuesto(id: string): Promise<Presupuesto> {
    return this.get(`/presupuestos/${id}`);
  }

  resumenPresupuestos(): Promise<Record<string, { cantidad: number; total: number }>> {
    return this.get('/presupuestos/resumen');
  }

  crearPresupuesto(datos: EntradaPresupuesto): Promise<Presupuesto> {
    return this.post('/presupuestos', datos);
  }

  actualizarPresupuesto(id: string, datos: EntradaPresupuesto): Promise<Presupuesto> {
    return this.put(`/presupuestos/${id}`, datos);
  }

  /** BORRADOR -> ENVIADO. Es donde se asigna el numero correlativo. */
  emitirPresupuesto(id: string): Promise<Presupuesto> {
    return this.post(`/presupuestos/${id}/emitir`, {});
  }

  cambiarEstado(id: string, estado: EstadoPresupuesto): Promise<Presupuesto> {
    return this.post(`/presupuestos/${id}/estado`, { estado });
  }

  duplicarPresupuesto(id: string): Promise<Presupuesto> {
    return this.post(`/presupuestos/${id}/duplicar`, {});
  }

  eliminarBorrador(id: string): Promise<void> {
    return this.delete(`/presupuestos/${id}`);
  }

  /** URL del PDF. `inline` sirve para el <iframe> de la previsualizacion. */
  urlPdf(id: string, inline = false): string {
    return `${this.base}/presupuestos/${id}/pdf${inline ? '?descargar=false' : ''}`;
  }

  whatsapp(id: string): Promise<{ url: string; mensaje: string; telefono: string; archivo: string }> {
    return this.get(`/presupuestos/${id}/whatsapp`);
  }

  // --- Configuracion --------------------------------------------------------

  configuracion(): Promise<Configuracion> {
    return this.get('/configuracion');
  }

  guardarConfiguracion(datos: EntradaConfiguracion): Promise<Configuracion> {
    return this.put('/configuracion', datos);
  }

  // --- Primitivas -----------------------------------------------------------

  private get<T>(ruta: string, filtros: Filtros = {}): Promise<T> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filtros)) {
      if (v !== undefined && v !== '') params = params.set(k, String(v));
    }
    return firstValueFrom(this.http.get<T>(this.base + ruta, { params }));
  }

  private post<T>(ruta: string, cuerpo: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.base + ruta, cuerpo));
  }

  private put<T>(ruta: string, cuerpo: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>(this.base + ruta, cuerpo));
  }

  private patch<T>(ruta: string, cuerpo: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(this.base + ruta, cuerpo));
  }

  private delete<T>(ruta: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(this.base + ruta));
  }
}

/* ------------------------------------------------------------------ */
/* Formas de entrada                                                   */
/* ------------------------------------------------------------------ */

export interface EntradaPrecio {
  presentacion: { cantidad: number; unidad: UnidadUso };
  /** En centavos enteros. */
  precioPresentacion: number;
  proveedor?: string;
}

/**
 * El producto viaja con `insumo`/`equipo` (no `insumoId`) porque asi lo espera el
 * esquema Mongoose del lado del servidor.
 */
export interface EntradaProducto {
  nombre: string;
  categoria: string;
  insumos: { insumo: string; cantidad: number }[];
  equipos: { equipo: string; unidadesConsumidas: number; minutosUso: number }[];
  minutosManoObra: number;
  otrosGastos: number;
  porcentajeMerma: number;
  margen: number;
  comisionPlataforma: number;
  tramosDescuento: { desdeCantidad: number; porcentaje: number }[];
}

export interface RecetaAdHoc {
  insumos: { insumoId: string; cantidad: number }[];
  equipos: { equipoId: string; unidadesConsumidas: number; minutosUso: number }[];
  minutosManoObra: number;
  otrosGastos: number;
  porcentajeMerma: number;
  margen: number;
  comisionPlataforma: number;
}

export interface EntradaPresupuesto {
  clienteId?: string;
  clienteManual?: { nombreRazonSocial: string; telefono?: string; email?: string };
  items: { productoId?: string; descripcion?: string; cantidad: number; precioUnitario?: number }[];
  validezDias?: number;
  porcentajeSenia?: number;
  condicionesGenerales?: string;
  notasInternas?: string;
  descuento?: { tipo: 'PORCENTAJE' | 'MONTO'; valor: number };
  sinDescuento?: boolean;
}

export interface EntradaConfiguracion {
  empresa?: Partial<Configuracion['empresa']>;
  costos?: Partial<Configuracion['costos']>;
  presupuestos?: Partial<Omit<Configuracion['presupuestos'], 'proximoNumeroPresupuesto'>>;
}
