import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ETIQUETAS_TIPO_INSUMO,
  ETIQUETAS_UNIDAD_USO,
  TipoInsumo,
  UnidadUso,
  type InsumoConPrecio,
  type PrecioInsumo,
} from '@calc/shared';
import { Api } from '../../nucleo/api.js';
import { Avisos } from '../../nucleo/avisos.js';
import { Catalogo } from '../../nucleo/catalogo.js';
import { Confirmar } from '../../nucleo/confirmar.js';
import { PIPES_FORMATO, pesosDeTexto } from '../../nucleo/formato.js';

/**
 * Listado de insumos con su precio vigente, la fecha de ese precio y el aviso
 * cuando pasó de 30 días.
 *
 * Desde acá se carga un precio suelto; la lista completa del proveedor se carga en
 * la pantalla de Actualizar precios, que es la que evita que la herramienta se
 * abandone.
 */
@Component({
  selector: 'app-insumos',
  standalone: true,
  imports: [FormsModule, RouterLink, ...PIPES_FORMATO],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './insumos.html',
  styleUrl: './insumos.scss',
})
export class Insumos {
  private readonly api = inject(Api);
  private readonly avisos = inject(Avisos);
  private readonly confirmar = inject(Confirmar);
  protected readonly catalogo = inject(Catalogo);

  protected readonly tipos = Object.values(TipoInsumo);
  protected readonly unidades = Object.values(UnidadUso);
  protected readonly etiquetasTipo = ETIQUETAS_TIPO_INSUMO;
  protected readonly etiquetasUnidad = ETIQUETAS_UNIDAD_USO;

  protected readonly busqueda = signal('');
  protected readonly filtroTipo = signal<string>('');
  protected readonly soloDesactualizados = signal(false);

  protected readonly lista = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    return this.catalogo.insumos().filter((i) => {
      if (texto && !i.nombre.toLowerCase().includes(texto)) return false;
      if (this.filtroTipo() && i.tipo !== this.filtroTipo()) return false;
      if (this.soloDesactualizados() && !i.precioDesactualizado) return false;
      return true;
    });
  });

  // --- Alta de insumo -------------------------------------------------------
  protected readonly mostrandoAlta = signal(false);
  protected readonly nuevoNombre = signal('');
  protected readonly nuevoTipo = signal<string>(TipoInsumo.OTRO);
  protected readonly nuevaUnidad = signal<string>(UnidadUso.UNIDAD);
  protected readonly guardando = signal(false);

  // --- Carga de precio ------------------------------------------------------
  protected readonly insumoEnPrecio = signal<InsumoConPrecio | null>(null);
  protected readonly precioTexto = signal('');
  protected readonly presentacionCantidad = signal(1);
  protected readonly proveedor = signal('');

  // --- Historial ------------------------------------------------------------
  protected readonly insumoEnHistorial = signal<InsumoConPrecio | null>(null);
  protected readonly historial = signal<PrecioInsumo[]>([]);

  constructor() {
    void this.catalogo.asegurarCargado().catch((e: unknown) => this.avisos.error(e));
  }

  /**
   * Sin este reset, tipo y unidad quedaban con lo ultimo elegido: crear un
   * "Producto base" y despues abrir "+ Nuevo insumo" de vuelta mostraba
   * "Producto base" precargado en vez de arrancar en blanco.
   */
  protected abrirAlta(): void {
    this.nuevoNombre.set('');
    this.nuevoTipo.set(TipoInsumo.OTRO);
    this.nuevaUnidad.set(UnidadUso.UNIDAD);
    this.mostrandoAlta.set(true);
  }

  protected async crear(): Promise<void> {
    const nombre = this.nuevoNombre().trim();
    if (!nombre) return;
    this.guardando.set(true);
    try {
      await this.api.crearInsumo({
        nombre,
        tipo: this.nuevoTipo() as TipoInsumo,
        unidadUso: this.nuevaUnidad() as UnidadUso,
      });
      await this.catalogo.recargar();
      this.avisos.exito(`Insumo "${nombre}" creado. Ahora cargale un precio.`);
      this.nuevoNombre.set('');
      this.mostrandoAlta.set(false);
    } catch (e) {
      this.avisos.error(e, 'No se pudo crear el insumo');
    } finally {
      this.guardando.set(false);
    }
  }

  protected abrirPrecio(insumo: InsumoConPrecio): void {
    this.insumoEnPrecio.set(insumo);
    this.precioTexto.set('');
    // Arranca con la última presentación cargada: la resma sigue siendo de 500.
    this.presentacionCantidad.set(insumo.precioVigente?.presentacion.cantidad ?? 1);
    this.proveedor.set(insumo.precioVigente?.proveedor ?? '');
  }

  /**
   * Carga un precio NUEVO. El anterior no se toca: es lo que hace que un
   * presupuesto de hace dos meses siga diciendo lo que decía.
   */
  protected async guardarPrecio(): Promise<void> {
    const insumo = this.insumoEnPrecio();
    const centavos = pesosDeTexto(this.precioTexto());
    if (!insumo || centavos == null) return;

    this.guardando.set(true);
    try {
      await this.api.cargarPrecio(insumo.id, {
        presentacion: { cantidad: this.presentacionCantidad(), unidad: insumo.unidadUso },
        precioPresentacion: centavos,
        ...(this.proveedor().trim() ? { proveedor: this.proveedor().trim() } : {}),
      });
      await this.catalogo.recargar();
      this.avisos.exito(`Precio de "${insumo.nombre}" actualizado.`);
      this.insumoEnPrecio.set(null);
    } catch (e) {
      this.avisos.error(e, 'No se pudo cargar el precio');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async verHistorial(insumo: InsumoConPrecio): Promise<void> {
    this.insumoEnHistorial.set(insumo);
    this.historial.set([]);
    try {
      const { datos } = await this.api.historialPrecios(insumo.id);
      this.historial.set(datos);
    } catch (e) {
      this.avisos.error(e, 'No se pudo leer el historial');
    }
  }

  protected async desactivar(insumo: InsumoConPrecio): Promise<void> {
    const ok = await this.confirmar.preguntar(
      `¿Dar de baja "${insumo.nombre}"? Sale de los listados pero no se borra.`,
      { titulo: 'Dar de baja', textoAceptar: 'Dar de baja', peligroso: true },
    );
    if (!ok) return;
    try {
      await this.api.desactivarInsumo(insumo.id);
      await this.catalogo.recargar();
      this.avisos.exito(`"${insumo.nombre}" dado de baja.`);
    } catch (e) {
      this.avisos.error(e, 'No se pudo dar de baja');
    }
  }

  /** Texto del aviso de antigüedad, o null si el precio está fresco. */
  protected avisoPrecio(insumo: InsumoConPrecio): string | null {
    if (!insumo.precioVigente) return 'Sin precio cargado';
    if (!insumo.precioDesactualizado) return null;
    return `Hace ${insumo.diasDesdeUltimoPrecio} días`;
  }
}
