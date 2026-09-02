import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ETIQUETAS_ESTADO, EstadoPresupuesto, type Presupuesto } from '@calc/shared';
import { Api } from '../../nucleo/api.js';
import { Avisos } from '../../nucleo/avisos.js';
import { PIPES_FORMATO } from '../../nucleo/formato.js';

/**
 * Listado de presupuestos.
 *
 * Se muestra `estadoEfectivo`, no `estado`: VENCIDO no está guardado en la base, se
 * deriva de la fecha al leer. Filtrar por VENCIDO le pide a la API los ENVIADO
 * pasados de fecha.
 */
@Component({
  selector: 'app-presupuestos',
  standalone: true,
  imports: [FormsModule, RouterLink, ...PIPES_FORMATO],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './presupuestos.html',
  styleUrl: './presupuestos.scss',
})
export class Presupuestos {
  private readonly api = inject(Api);
  private readonly avisos = inject(Avisos);

  protected readonly estados = Object.values(EstadoPresupuesto);
  protected readonly etiquetasEstado = ETIQUETAS_ESTADO;

  protected readonly lista = signal<Presupuesto[]>([]);
  protected readonly resumen = signal<Record<string, { cantidad: number; total: number }>>({});
  protected readonly cargando = signal(false);
  protected readonly filtroEstado = signal<string>('');
  protected readonly busqueda = signal('');

  constructor() {
    void this.recargar();
  }

  protected async recargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const [pagina, resumen] = await Promise.all([
        this.api.presupuestos({
          porPagina: 100,
          estado: this.filtroEstado() || undefined,
          busqueda: this.busqueda().trim() || undefined,
        }),
        this.api.resumenPresupuestos(),
      ]);
      this.lista.set(pagina.datos);
      this.resumen.set(resumen);
    } catch (e) {
      this.avisos.error(e, 'No se pudo cargar el listado');
    } finally {
      this.cargando.set(false);
    }
  }

  protected filtrar(estado: string): void {
    this.filtroEstado.set(estado);
    void this.recargar();
  }

  /**
   * Duplicar con precios actuales: crea uno nuevo en BORRADOR recosteado contra los
   * precios de hoy. El original no se toca, que es justamente el punto.
   */
  protected async duplicar(p: Presupuesto): Promise<void> {
    try {
      const nuevo = await this.api.duplicarPresupuesto(p.id);
      await this.recargar();
      this.avisos.exito(
        `Se creó un borrador nuevo con los precios de hoy. Total: ${
          nuevo.total !== p.total ? 'cambió' : 'igual'
        }.`,
      );
    } catch (e) {
      this.avisos.error(e, 'No se pudo duplicar');
    }
  }

  protected async emitir(p: Presupuesto): Promise<void> {
    try {
      const emitido = await this.api.emitirPresupuesto(p.id);
      await this.recargar();
      this.avisos.exito(`Emitido con el número ${emitido.numero}.`);
    } catch (e) {
      this.avisos.error(e, 'No se pudo emitir');
    }
  }

  protected async cambiarEstado(p: Presupuesto, estado: EstadoPresupuesto): Promise<void> {
    try {
      await this.api.cambiarEstado(p.id, estado);
      await this.recargar();
      this.avisos.exito(`Marcado como ${ETIQUETAS_ESTADO[estado].toLowerCase()}.`);
    } catch (e) {
      this.avisos.error(e, 'No se pudo cambiar el estado');
    }
  }

  protected async eliminar(p: Presupuesto): Promise<void> {
    if (!confirm('¿Borrar este borrador? No se puede deshacer.')) return;
    try {
      await this.api.eliminarBorrador(p.id);
      await this.recargar();
      this.avisos.exito('Borrador eliminado.');
    } catch (e) {
      this.avisos.error(e, 'No se pudo eliminar');
    }
  }

  protected urlPdf(id: string): string {
    return this.api.urlPdf(id);
  }

  protected esBorrador(p: Presupuesto): boolean {
    return p.estadoEfectivo === EstadoPresupuesto.BORRADOR;
  }

  /** Solo un ENVIADO o VENCIDO admite que el cliente conteste. */
  protected admiteRespuesta(p: Presupuesto): boolean {
    return (
      p.estadoEfectivo === EstadoPresupuesto.ENVIADO ||
      p.estadoEfectivo === EstadoPresupuesto.VENCIDO
    );
  }

  /** Indexar el mapa desde el template exige un estado ya tipado. */
  protected etiquetaDe(estado: string): string {
    return ETIQUETAS_ESTADO[estado as EstadoPresupuesto] ?? estado;
  }

  protected readonly Estado = EstadoPresupuesto;
}
