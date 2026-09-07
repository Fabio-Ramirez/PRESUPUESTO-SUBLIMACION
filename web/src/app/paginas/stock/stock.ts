import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ETIQUETAS_MOVIMIENTO_STOCK,
  ETIQUETAS_UNIDAD_USO,
  TipoMovimientoStock,
  type InsumoConPrecio,
  type MovimientoStock,
} from '@calc/shared';
import { Api } from '../../nucleo/api.js';
import { Avisos } from '../../nucleo/avisos.js';
import { Catalogo } from '../../nucleo/catalogo.js';
import { PIPES_FORMATO } from '../../nucleo/formato.js';

/**
 * Stock de insumos.
 *
 * Manual a proposito: el mismo insumo se puede consumir fuera de un presupuesto,
 * o producirse antes de cotizar, asi que descontarlo solo al emitir seria adivinar.
 * Cada entrada y salida queda en un historico que nunca se pisa — el stock actual
 * es la suma de todo ese historico, igual que el precio vigente es el mas nuevo
 * de su propio historico.
 */
@Component({
  selector: 'app-stock',
  standalone: true,
  imports: [FormsModule, ...PIPES_FORMATO],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stock.html',
  styleUrl: './stock.scss',
})
export class Stock {
  private readonly api = inject(Api);
  private readonly avisos = inject(Avisos);
  protected readonly catalogo = inject(Catalogo);

  protected readonly etiquetasUnidad = ETIQUETAS_UNIDAD_USO;
  protected readonly etiquetasMovimiento = ETIQUETAS_MOVIMIENTO_STOCK;

  protected readonly busqueda = signal('');
  protected readonly soloStockBajo = signal(false);
  protected readonly guardando = signal(false);

  protected readonly lista = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    return this.catalogo.insumos().filter((i) => {
      if (texto && !i.nombre.toLowerCase().includes(texto)) return false;
      if (this.soloStockBajo() && !i.stockBajo) return false;
      return true;
    });
  });

  // --- Registrar movimiento ---------------------------------------------
  protected readonly insumoEnMovimiento = signal<InsumoConPrecio | null>(null);
  protected readonly tipoMovimiento = signal<TipoMovimientoStock>(TipoMovimientoStock.ENTRADA);
  protected readonly cantidadTexto = signal('');
  protected readonly motivo = signal('');

  // --- Historial -----------------------------------------------------------
  protected readonly insumoEnHistorial = signal<InsumoConPrecio | null>(null);
  protected readonly historial = signal<MovimientoStock[]>([]);

  // --- Minimo editable ------------------------------------------------------
  protected readonly minimoTexto = signal<Record<string, string>>({});

  constructor() {
    void this.catalogo.asegurarCargado().catch((e: unknown) => this.avisos.error(e));
  }

  protected abrirMovimiento(insumo: InsumoConPrecio, tipo: TipoMovimientoStock): void {
    this.insumoEnMovimiento.set(insumo);
    this.tipoMovimiento.set(tipo);
    this.cantidadTexto.set('');
    this.motivo.set('');
  }

  protected async guardarMovimiento(): Promise<void> {
    const insumo = this.insumoEnMovimiento();
    const cantidad = Number(this.cantidadTexto().replace(',', '.'));
    if (!insumo || !(cantidad > 0)) return;

    this.guardando.set(true);
    try {
      await this.api.registrarMovimientoStock(insumo.id, {
        tipo: this.tipoMovimiento(),
        cantidad,
        ...(this.motivo().trim() ? { motivo: this.motivo().trim() } : {}),
      });
      await this.catalogo.recargar();
      const verbo = this.tipoMovimiento() === TipoMovimientoStock.ENTRADA ? 'cargada' : 'registrada';
      this.avisos.exito(`Salida/entrada ${verbo} para "${insumo.nombre}".`);
      this.insumoEnMovimiento.set(null);
    } catch (e) {
      this.avisos.error(e, 'No se pudo registrar el movimiento');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async verHistorial(insumo: InsumoConPrecio): Promise<void> {
    this.insumoEnHistorial.set(insumo);
    this.historial.set([]);
    try {
      const { datos } = await this.api.historialStock(insumo.id);
      this.historial.set(datos);
    } catch (e) {
      this.avisos.error(e, 'No se pudo leer el historial');
    }
  }

  /** Texto del input de minimo para un insumo: el escrito, o el guardado si no se toco. */
  protected minimoDe(insumo: InsumoConPrecio): string {
    return this.minimoTexto()[insumo.id] ?? String(insumo.stockMinimo ?? '');
  }

  protected escribirMinimo(insumoId: string, texto: string): void {
    this.minimoTexto.update((m) => ({ ...m, [insumoId]: texto }));
  }

  /** Se guarda al salir del campo: no hace falta un boton aparte por fila. */
  protected async guardarMinimo(insumo: InsumoConPrecio): Promise<void> {
    const texto = this.minimoTexto()[insumo.id];
    if (texto === undefined) return; // no se toco, no hay nada que guardar
    const valor = texto.trim() === '' ? 0 : Number(texto.replace(',', '.'));
    if (!(valor >= 0) || valor === (insumo.stockMinimo ?? 0)) return;

    try {
      await this.api.actualizarInsumo(insumo.id, { stockMinimo: valor });
      await this.catalogo.recargar();
      this.avisos.exito(`Mínimo de "${insumo.nombre}" actualizado.`);
    } catch (e) {
      this.avisos.error(e, 'No se pudo actualizar el mínimo');
      // Se descarta el valor invalido escrito, para no dejar el input mintiendo.
      this.minimoTexto.update((m) => {
        const { [insumo.id]: _quitado, ...resto } = m;
        return resto;
      });
    }
  }
}
