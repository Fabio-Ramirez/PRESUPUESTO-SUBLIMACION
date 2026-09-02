import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ETIQUETAS_UNIDAD_USO, type InsumoConPrecio } from '@calc/shared';
import { Api } from '../../nucleo/api.js';
import { Avisos } from '../../nucleo/avisos.js';
import { Catalogo } from '../../nucleo/catalogo.js';
import { PIPES_FORMATO, pesosDeTexto } from '../../nucleo/formato.js';

interface FilaPrecio {
  insumo: InsumoConPrecio;
  cantidadTexto: string;
  precioTexto: string;
}

/**
 * Actualizar precios: la lista completa del proveedor de una sola vez.
 *
 * Es la pantalla que decide si la herramienta se sigue usando. Actualizar treinta
 * insumos de a uno no lo hace nadie, y un costeo con precios de hace tres meses no
 * sirve para nada.
 *
 * Se escriben solo las filas que se tocan; el resto se ignora.
 */
@Component({
  selector: 'app-precios',
  standalone: true,
  imports: [FormsModule, ...PIPES_FORMATO],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './precios.html',
  styleUrl: './precios.scss',
})
export class Precios {
  private readonly api = inject(Api);
  private readonly avisos = inject(Avisos);
  protected readonly catalogo = inject(Catalogo);

  protected readonly etiquetasUnidad = ETIQUETAS_UNIDAD_USO;
  protected readonly proveedor = signal('');
  protected readonly soloDesactualizados = signal(false);
  protected readonly guardando = signal(false);

  /** Una fila por insumo, con la presentación anterior ya puesta. */
  protected readonly filas = signal<FilaPrecio[]>([]);

  protected readonly visibles = computed(() =>
    this.soloDesactualizados()
      ? this.filas().filter((f) => f.insumo.precioDesactualizado)
      : this.filas(),
  );

  /** Solo cuentan las filas con un precio escrito y válido. */
  protected readonly aCargar = computed(() =>
    this.filas().filter((f) => pesosDeTexto(f.precioTexto) !== null),
  );

  protected readonly hayCambios = computed(() => this.aCargar().length > 0);

  constructor() {
    void this.inicializar();
  }

  private async inicializar(): Promise<void> {
    try {
      await this.catalogo.asegurarCargado();
      this.reiniciarFilas();
    } catch (e) {
      this.avisos.error(e);
    }
  }

  private reiniciarFilas(): void {
    this.filas.set(
      this.catalogo.insumos().map((insumo) => ({
        insumo,
        // La presentación no suele cambiar: la resma sigue siendo de 500 hojas.
        cantidadTexto: String(insumo.precioVigente?.presentacion.cantidad ?? 1),
        precioTexto: '',
      })),
    );
  }

  protected escribirPrecio(insumoId: string, texto: string): void {
    this.filas.update((f) =>
      f.map((fila) => (fila.insumo.id === insumoId ? { ...fila, precioTexto: texto } : fila)),
    );
  }

  protected escribirCantidad(insumoId: string, texto: string): void {
    this.filas.update((f) =>
      f.map((fila) => (fila.insumo.id === insumoId ? { ...fila, cantidadTexto: texto } : fila)),
    );
  }

  /** Precio por unidad de uso que resultaría de lo escrito. Se ve mientras se tipea. */
  protected previsualizar(fila: FilaPrecio): number | null {
    const centavos = pesosDeTexto(fila.precioTexto);
    const cantidad = Number(fila.cantidadTexto.replace(',', '.'));
    if (centavos == null || !(cantidad > 0)) return null;
    return Math.round((centavos * 1000) / cantidad);
  }

  /** Cuánto varía respecto del precio vigente, en porcentaje. */
  protected variacion(fila: FilaPrecio): number | null {
    const nuevo = this.previsualizar(fila);
    const anterior = fila.insumo.precioVigente?.precioPorUnidadUso;
    if (nuevo == null || !anterior) return null;
    return Math.round(((nuevo - anterior) / anterior) * 1000) / 10;
  }

  protected async guardar(): Promise<void> {
    const lineas = this.aCargar();
    if (lineas.length === 0) return;

    const precios = lineas.map((f) => ({
      insumoId: f.insumo.id,
      presentacion: {
        cantidad: Number(f.cantidadTexto.replace(',', '.')) || 1,
        unidad: f.insumo.unidadUso,
      },
      precioPresentacion: pesosDeTexto(f.precioTexto)!,
      ...(this.proveedor().trim() ? { proveedor: this.proveedor().trim() } : {}),
    }));

    this.guardando.set(true);
    try {
      // Un solo pedido: la API valida todo antes de escribir nada, así que o
      // entran los N precios o no entra ninguno.
      const { cargados } = await this.api.cargarPreciosEnLote(precios);
      await this.catalogo.recargar();
      this.reiniciarFilas();
      this.avisos.exito(`${cargados} precio(s) actualizados.`);
    } catch (e) {
      this.avisos.error(e, 'No se cargó ningún precio');
    } finally {
      this.guardando.set(false);
    }
  }

  protected limpiar(): void {
    this.reiniciarFilas();
  }
}
