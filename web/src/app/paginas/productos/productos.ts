import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DEFAULTS,
  ETIQUETAS_UNIDAD_USO,
  aCentavos,
  aMilicentavos,
  calcularCosteo,
  type Centavos,
  type EntradaCosteo,
  type Producto,
  type ResultadoCosteo,
} from '@calc/shared';
import { Api, type EntradaProducto } from '../../nucleo/api.js';
import { Avisos } from '../../nucleo/avisos.js';
import { Catalogo } from '../../nucleo/catalogo.js';
import { PIPES_FORMATO, pesosDeTexto, textoDePesos } from '../../nucleo/formato.js';

interface Borrador {
  nombre: string;
  categoria: string;
  insumos: { insumoId: string; cantidad: number }[];
  equipos: { equipoId: string; unidadesConsumidas: number; minutosUso: number }[];
  minutosManoObra: number;
  otrosGastosTexto: string;
  porcentajeMerma: number;
  margen: number;
  comisionPlataforma: number;
  tramosDescuento: { desdeCantidad: number; porcentaje: number }[];
}

const VACIO: Borrador = {
  nombre: '',
  categoria: 'General',
  insumos: [],
  equipos: [],
  minutosManoObra: 0,
  otrosGastosTexto: '',
  porcentajeMerma: DEFAULTS.PORCENTAJE_MERMA,
  margen: DEFAULTS.MARGEN,
  comisionPlataforma: DEFAULTS.COMISION_PLATAFORMA,
  tramosDescuento: [],
};

/**
 * ABM de productos con el costeo desglosado a la vista mientras se edita.
 *
 * El desglose se calcula en el cliente con el motor de /shared, igual que en la
 * Calculadora: cambiar una cantidad y ver el precio moverse en el momento es lo que
 * hace que valga la pena editar un producto en vez de tantear en la calculadora.
 */
@Component({
  selector: 'app-productos',
  standalone: true,
  imports: [FormsModule, ...PIPES_FORMATO],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './productos.html',
  styleUrl: './productos.scss',
})
export class Productos {
  private readonly api = inject(Api);
  private readonly avisos = inject(Avisos);
  protected readonly catalogo = inject(Catalogo);

  protected readonly etiquetasUnidad = ETIQUETAS_UNIDAD_USO;

  protected readonly productos = signal<Producto[]>([]);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly editandoId = signal<string | null>(null);
  protected readonly mostrandoForm = signal(false);
  protected readonly borrador = signal<Borrador>({ ...VACIO });

  protected readonly filtrados = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return this.productos();
    return this.productos().filter(
      (p) =>
        p.nombre.toLowerCase().includes(texto) || p.categoria.toLowerCase().includes(texto),
    );
  });

  /** El costeo del borrador que se está editando, recalculado con cada cambio. */
  protected readonly costeo = computed<ResultadoCosteo>(() => {
    const b = this.borrador();
    const insumos = this.catalogo.insumosPorId();
    const equipos = this.catalogo.equiposPorId();
    const costos = this.catalogo.costos();

    const entrada: EntradaCosteo = {
      insumos: b.insumos
        .filter((f) => f.insumoId)
        .map((f) => {
          const i = insumos.get(f.insumoId);
          return {
            insumoId: f.insumoId,
            nombre: i?.nombre ?? '(desconocido)',
            tipo: i?.tipo ?? 'OTRO',
            unidadUso: i?.unidadUso ?? 'UNIDAD',
            cantidad: f.cantidad,
            precioPorUnidadUso: i?.precioVigente?.precioPorUnidadUso ?? null,
          };
        }),
      equipos: b.equipos
        .filter((f) => f.equipoId && equipos.has(f.equipoId))
        .map((f) => {
          const e = equipos.get(f.equipoId)!;
          return {
            equipoId: f.equipoId,
            nombre: e.nombre,
            unidadesConsumidas: f.unidadesConsumidas,
            minutosUso: f.minutosUso,
            amortizacionPorUnidad: e.amortizacionPorUnidad,
            consumoWatts: e.consumoWatts,
          };
        }),
      minutosManoObra: b.minutosManoObra,
      valorHoraManoObra: aMilicentavos(costos.valorHoraManoObra),
      costoKwh: aMilicentavos(costos.costoKwh),
      otrosGastos: aMilicentavos((pesosDeTexto(b.otrosGastosTexto) ?? 0) as Centavos),
      porcentajeMerma: b.porcentajeMerma,
      margen: b.margen,
      comisionPlataforma: b.comisionPlataforma,
    };

    return calcularCosteo(entrada);
  });

  constructor() {
    void this.inicializar();
  }

  private async inicializar(): Promise<void> {
    try {
      await this.catalogo.asegurarCargado();
      await this.recargar();
    } catch (e) {
      this.avisos.error(e);
    }
  }

  private async recargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const { datos } = await this.api.productos({ porPagina: 200 });
      this.productos.set(datos);
    } finally {
      this.cargando.set(false);
    }
  }

  // --- Formulario -----------------------------------------------------------

  protected abrirNuevo(): void {
    this.editandoId.set(null);
    this.borrador.set({ ...VACIO, insumos: [], equipos: [], tramosDescuento: [] });
    this.mostrandoForm.set(true);
  }

  protected abrirEdicion(p: Producto): void {
    this.editandoId.set(p.id);
    this.borrador.set({
      nombre: p.nombre,
      categoria: p.categoria,
      insumos: p.insumos.map((i) => ({ ...i })),
      equipos: p.equipos.map((e) => ({ ...e })),
      minutosManoObra: p.minutosManoObra,
      otrosGastosTexto: textoDePesos(p.otrosGastos),
      porcentajeMerma: p.porcentajeMerma,
      margen: p.margen,
      comisionPlataforma: p.comisionPlataforma,
      tramosDescuento: p.tramosDescuento.map((t) => ({ ...t })),
    });
    this.mostrandoForm.set(true);
  }

  protected editar(cambios: Partial<Borrador>): void {
    this.borrador.update((b) => ({ ...b, ...cambios }));
  }

  protected agregarInsumo(): void {
    this.editar({ insumos: [...this.borrador().insumos, { insumoId: '', cantidad: 1 }] });
  }

  protected quitarInsumo(i: number): void {
    this.editar({ insumos: this.borrador().insumos.filter((_, k) => k !== i) });
  }

  protected cambiarInsumo(i: number, cambios: Partial<Borrador['insumos'][number]>): void {
    this.editar({
      insumos: this.borrador().insumos.map((f, k) => (k === i ? { ...f, ...cambios } : f)),
    });
  }

  protected agregarEquipo(): void {
    this.editar({
      equipos: [...this.borrador().equipos, { equipoId: '', unidadesConsumidas: 1, minutosUso: 0 }],
    });
  }

  protected quitarEquipo(i: number): void {
    this.editar({ equipos: this.borrador().equipos.filter((_, k) => k !== i) });
  }

  protected cambiarEquipo(i: number, cambios: Partial<Borrador['equipos'][number]>): void {
    this.editar({
      equipos: this.borrador().equipos.map((f, k) => (k === i ? { ...f, ...cambios } : f)),
    });
  }

  protected agregarTramo(): void {
    this.editar({
      tramosDescuento: [...this.borrador().tramosDescuento, { desdeCantidad: 10, porcentaje: 5 }],
    });
  }

  protected quitarTramo(i: number): void {
    this.editar({ tramosDescuento: this.borrador().tramosDescuento.filter((_, k) => k !== i) });
  }

  protected cambiarTramo(i: number, cambios: Partial<{ desdeCantidad: number; porcentaje: number }>): void {
    this.editar({
      tramosDescuento: this.borrador().tramosDescuento.map((t, k) =>
        k === i ? { ...t, ...cambios } : t,
      ),
    });
  }

  protected async guardar(): Promise<void> {
    const b = this.borrador();
    if (!b.nombre.trim()) return;

    const datos: EntradaProducto = {
      nombre: b.nombre.trim(),
      categoria: b.categoria.trim() || 'General',
      insumos: b.insumos.filter((i) => i.insumoId).map((i) => ({ insumo: i.insumoId, cantidad: i.cantidad })),
      equipos: b.equipos
        .filter((e) => e.equipoId)
        .map((e) => ({
          equipo: e.equipoId,
          unidadesConsumidas: e.unidadesConsumidas,
          minutosUso: e.minutosUso,
        })),
      minutosManoObra: b.minutosManoObra,
      otrosGastos: pesosDeTexto(b.otrosGastosTexto) ?? 0,
      porcentajeMerma: b.porcentajeMerma,
      margen: b.margen,
      comisionPlataforma: b.comisionPlataforma,
      tramosDescuento: b.tramosDescuento,
    };

    this.guardando.set(true);
    try {
      const id = this.editandoId();
      if (id) {
        await this.api.actualizarProducto(id, datos);
        this.avisos.exito(`"${datos.nombre}" actualizado.`);
      } else {
        await this.api.crearProducto(datos);
        this.avisos.exito(`Producto "${datos.nombre}" creado.`);
      }
      await this.recargar();
      this.mostrandoForm.set(false);
    } catch (e) {
      this.avisos.error(e, 'No se pudo guardar el producto');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async desactivar(p: Producto): Promise<void> {
    if (!confirm(`¿Dar de baja "${p.nombre}"?`)) return;
    try {
      await this.api.desactivarProducto(p.id);
      await this.recargar();
      this.avisos.exito(`"${p.nombre}" dado de baja.`);
    } catch (e) {
      this.avisos.error(e, 'No se pudo dar de baja');
    }
  }

  protected nombreInsumo(id: string): string {
    return this.catalogo.insumosPorId().get(id)?.nombre ?? '(insumo dado de baja)';
  }

  protected unidadDe(insumoId: string): string {
    const i = this.catalogo.insumosPorId().get(insumoId);
    return i ? this.etiquetasUnidad[i.unidadUso] : '';
  }
}
