import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { calcularAmortizacionPorUnidad, type Equipo as EquipoDominio } from '@calc/shared';
import { Api } from '../../nucleo/api.js';
import { Avisos } from '../../nucleo/avisos.js';
import { Catalogo } from '../../nucleo/catalogo.js';
import { Confirmar } from '../../nucleo/confirmar.js';
import { PIPES_FORMATO, pesosDeTexto, textoDePesos } from '../../nucleo/formato.js';

/**
 * Equipos: impresora, plancha, corte.
 *
 * Se carga lo que se sabe —cuánto salió y cuántas piezas se espera que haga— y la
 * amortización por unidad se deriva. En la planilla era un monto fijo escrito a
 * mano que quedaba viejo apenas se cambiaba una máquina.
 *
 * El formulario la muestra mientras se escribe, con el mismo cálculo que usa el
 * servidor al guardar.
 */
@Component({
  selector: 'app-equipos',
  standalone: true,
  imports: [FormsModule, ...PIPES_FORMATO],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './equipos.html',
})
export class Equipos {
  private readonly api = inject(Api);
  private readonly avisos = inject(Avisos);
  private readonly confirmar = inject(Confirmar);
  protected readonly catalogo = inject(Catalogo);

  protected readonly editando = signal<EquipoDominio | null>(null);
  protected readonly mostrandoForm = signal(false);
  protected readonly guardando = signal(false);

  protected readonly nombre = signal('');
  protected readonly costoTexto = signal('');
  protected readonly vidaUtil = signal(1000);
  protected readonly consumoWatts = signal(0);

  /**
   * La amortización que va a resultar, calculada acá con la misma función de
   * /shared que corre el hook de Mongoose. No es una estimación de la UI.
   */
  protected readonly amortizacionPreview = computed(() => {
    const centavos = pesosDeTexto(this.costoTexto());
    const vida = this.vidaUtil();
    if (centavos == null || !(vida > 0)) return null;
    return calcularAmortizacionPorUnidad(centavos as never, vida);
  });

  constructor() {
    void this.catalogo.asegurarCargado().catch((e: unknown) => this.avisos.error(e));
  }

  protected abrirNuevo(): void {
    this.editando.set(null);
    this.nombre.set('');
    this.costoTexto.set('');
    this.vidaUtil.set(1000);
    this.consumoWatts.set(0);
    this.mostrandoForm.set(true);
  }

  protected abrirEdicion(equipo: EquipoDominio): void {
    this.editando.set(equipo);
    this.nombre.set(equipo.nombre);
    this.costoTexto.set(textoDePesos(equipo.costoAdquisicion));
    this.vidaUtil.set(equipo.vidaUtilUnidades);
    this.consumoWatts.set(equipo.consumoWatts);
    this.mostrandoForm.set(true);
  }

  protected async guardar(): Promise<void> {
    const centavos = pesosDeTexto(this.costoTexto());
    if (!this.nombre().trim() || centavos == null) return;

    const datos = {
      nombre: this.nombre().trim(),
      costoAdquisicion: centavos,
      vidaUtilUnidades: this.vidaUtil(),
      consumoWatts: this.consumoWatts(),
    };

    this.guardando.set(true);
    try {
      const actual = this.editando();
      if (actual) {
        await this.api.actualizarEquipo(actual.id, datos as never);
        this.avisos.exito(
          `"${datos.nombre}" actualizado. Los costeos nuevos usan la amortización nueva; ` +
            'los presupuestos ya emitidos no se mueven.',
        );
      } else {
        await this.api.crearEquipo(datos as never);
        this.avisos.exito(`Equipo "${datos.nombre}" creado.`);
      }
      await this.catalogo.recargar();
      this.mostrandoForm.set(false);
    } catch (e) {
      this.avisos.error(e, 'No se pudo guardar el equipo');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async desactivar(equipo: EquipoDominio): Promise<void> {
    const ok = await this.confirmar.preguntar(`¿Dar de baja "${equipo.nombre}"?`, {
      titulo: 'Dar de baja',
      textoAceptar: 'Dar de baja',
      peligroso: true,
    });
    if (!ok) return;
    try {
      await this.api.desactivarEquipo(equipo.id);
      await this.catalogo.recargar();
      this.avisos.exito(`"${equipo.nombre}" dado de baja.`);
    } catch (e) {
      this.avisos.error(e, 'No se pudo dar de baja');
    }
  }
}
