import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CondicionIva, formatearNumeroPresupuesto } from '@calc/shared';
import { Api, type EntradaConfiguracion } from '../../nucleo/api.js';
import { Avisos } from '../../nucleo/avisos.js';
import { Catalogo } from '../../nucleo/catalogo.js';
import { PIPES_FORMATO, pesosDeTexto, textoDePesos } from '../../nucleo/formato.js';

/**
 * Configuración: datos del emisor, costos operativos y valores por defecto.
 *
 * Es un único singleton. `proximoNumeroPresupuesto` se muestra pero no se edita:
 * lo maneja el servidor con un incremento atómico, y dejarlo escribir a mano sería
 * la forma más fácil de romper la correlatividad.
 */
@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [FormsModule, ...PIPES_FORMATO],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './configuracion.html',
  styleUrl: './configuracion.scss',
})
export class ConfiguracionPagina {
  private readonly api = inject(Api);
  private readonly avisos = inject(Avisos);
  private readonly catalogo = inject(Catalogo);

  protected readonly condiciones = Object.values(CondicionIva);
  protected readonly etiquetasIva: Record<string, string> = {
    MONOTRIBUTO: 'Monotributo (no discrimina IVA)',
    EXENTO: 'Exento',
    RESPONSABLE_INSCRIPTO: 'Responsable inscripto (IVA 21%)',
  };

  protected readonly cargando = signal(true);
  protected readonly guardando = signal(false);

  // Empresa
  protected readonly nombre = signal('');
  protected readonly cuit = signal('');
  protected readonly direccion = signal('');
  protected readonly whatsapp = signal('');
  protected readonly email = signal('');
  protected readonly condicionIva = signal<string>(CondicionIva.MONOTRIBUTO);
  protected readonly logo = signal<string | null>(null);

  // Costos
  protected readonly valorHoraTexto = signal('');
  protected readonly costoKwhTexto = signal('');

  // Defaults de presupuesto
  protected readonly validezDias = signal(15);
  protected readonly porcentajeSenia = signal(50);
  protected readonly condicionesGenerales = signal('');
  protected readonly puntoVenta = signal(1);
  protected readonly tramos = signal<{ desdeCantidad: number; porcentaje: number }[]>([]);
  protected readonly proximoNumero = signal(1);

  protected readonly numeroEjemplo = computed(() =>
    formatearNumeroPresupuesto(this.puntoVenta(), this.proximoNumero()),
  );

  constructor() {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      const c = await this.api.configuracion();
      this.nombre.set(c.empresa.nombre);
      this.cuit.set(c.empresa.cuit);
      this.direccion.set(c.empresa.direccion);
      this.whatsapp.set(c.empresa.whatsapp);
      this.email.set(c.empresa.email);
      this.condicionIva.set(c.empresa.condicionIva);
      this.logo.set(c.empresa.logo ?? null);
      this.valorHoraTexto.set(textoDePesos(c.costos.valorHoraManoObra));
      this.costoKwhTexto.set(textoDePesos(c.costos.costoKwh));
      this.validezDias.set(c.presupuestos.validezDiasPorDefecto);
      this.porcentajeSenia.set(c.presupuestos.porcentajeSeniaPorDefecto);
      this.condicionesGenerales.set(c.presupuestos.condicionesGeneralesPorDefecto);
      this.puntoVenta.set(c.presupuestos.puntoVenta);
      this.tramos.set(c.presupuestos.tramosDescuentoPorDefecto.map((t) => ({ ...t })));
      this.proximoNumero.set(c.presupuestos.proximoNumeroPresupuesto);
    } catch (e) {
      this.avisos.error(e, 'No se pudo cargar la configuración');
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * El logo se guarda como data URI dentro de la configuración: el PDF queda
   * autocontenido y no depende de que un archivo siga existiendo en el servidor.
   */
  protected async elegirLogo(evento: Event): Promise<void> {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    if (!archivo) return;
    if (archivo.size > 400_000) {
      this.avisos.error(new Error('El logo tiene que pesar menos de 400 KB.'));
      return;
    }
    const lector = new FileReader();
    lector.onload = () => this.logo.set(String(lector.result));
    lector.readAsDataURL(archivo);
  }

  protected agregarTramo(): void {
    this.tramos.update((t) => [...t, { desdeCantidad: 10, porcentaje: 5 }]);
  }

  protected quitarTramo(i: number): void {
    this.tramos.update((t) => t.filter((_, k) => k !== i));
  }

  protected cambiarTramo(i: number, cambios: Partial<{ desdeCantidad: number; porcentaje: number }>): void {
    this.tramos.update((t) => t.map((tr, k) => (k === i ? { ...tr, ...cambios } : tr)));
  }

  protected async guardar(): Promise<void> {
    const datos: EntradaConfiguracion = {
      empresa: {
        nombre: this.nombre().trim(),
        cuit: this.cuit().trim(),
        direccion: this.direccion().trim(),
        whatsapp: this.whatsapp().trim(),
        email: this.email().trim(),
        condicionIva: this.condicionIva() as CondicionIva,
        ...(this.logo() ? { logo: this.logo()! } : {}),
      },
      costos: {
        valorHoraManoObra: (pesosDeTexto(this.valorHoraTexto()) ?? 0) as never,
        costoKwh: (pesosDeTexto(this.costoKwhTexto()) ?? 0) as never,
      },
      presupuestos: {
        validezDiasPorDefecto: this.validezDias(),
        porcentajeSeniaPorDefecto: this.porcentajeSenia(),
        condicionesGeneralesPorDefecto: this.condicionesGenerales(),
        puntoVenta: this.puntoVenta(),
        tramosDescuentoPorDefecto: this.tramos(),
      },
    };

    this.guardando.set(true);
    try {
      await this.api.guardarConfiguracion(datos);
      // El catálogo cachea los costos operativos: si no se refresca, la calculadora
      // sigue costeando con el valor hora viejo.
      await this.catalogo.recargar();
      this.avisos.exito('Configuración guardada.');
    } catch (e) {
      this.avisos.error(e, 'No se pudo guardar');
    } finally {
      this.guardando.set(false);
    }
  }
}
