import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { ETIQUETAS_ESTADO, EstadoPresupuesto, type Presupuesto } from '@calc/shared';
import { Api } from '../../nucleo/api.js';
import { Avisos } from '../../nucleo/avisos.js';
import { PIPES_FORMATO } from '../../nucleo/formato.js';

/**
 * Detalle del presupuesto con previsualización del PDF antes de emitir.
 *
 * La previsualización es el PDF de verdad servido inline, no una maqueta HTML: si
 * lo que se ve acá no fuera exactamente lo que recibe el cliente, previsualizar no
 * serviría de nada.
 */
@Component({
  selector: 'app-detalle-presupuesto',
  standalone: true,
  imports: [RouterLink, ...PIPES_FORMATO],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './detalle-presupuesto.html',
  styleUrl: './detalle-presupuesto.scss',
})
export class DetallePresupuesto {
  private readonly api = inject(Api);
  private readonly avisos = inject(Avisos);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  /** Llega por `withComponentInputBinding` desde la ruta /presupuestos/:id. */
  readonly id = input.required<string>();

  protected readonly etiquetasEstado = ETIQUETAS_ESTADO;
  protected readonly Estado = EstadoPresupuesto;

  protected readonly presupuesto = signal<Presupuesto | null>(null);
  protected readonly cargando = signal(true);
  protected readonly trabajando = signal(false);
  protected readonly mostrandoPdf = signal(false);
  protected readonly whatsapp = signal<{ url: string; mensaje: string; archivo: string } | null>(
    null,
  );

  /**
   * El iframe necesita una URL marcada como confiable. Es una ruta propia de la
   * API, no viene de ningún lado externo.
   */
  protected readonly urlPreview = computed<SafeResourceUrl | null>(() => {
    const p = this.presupuesto();
    if (!p) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.api.urlPdf(p.id, true));
  });

  protected readonly esBorrador = computed(
    () => this.presupuesto()?.estadoEfectivo === EstadoPresupuesto.BORRADOR,
  );

  protected readonly admiteRespuesta = computed(() => {
    const e = this.presupuesto()?.estadoEfectivo;
    return e === EstadoPresupuesto.ENVIADO || e === EstadoPresupuesto.VENCIDO;
  });

  /**
   * Margen real del trabajo, con el costo congelado al momento de emitir.
   * Es la pregunta que la planilla no podía responder.
   */
  protected readonly rentabilidad = computed(() => {
    const p = this.presupuesto();
    if (!p) return null;
    let costo = 0;
    let parcial = false;
    for (const item of p.items) {
      costo += item.costoUnitarioAlMomento * item.cantidad;
      if (item.costeoIncompleto) parcial = true;
    }
    if (costo === 0) return null;
    const ganancia = p.neto - costo;
    return {
      costo,
      ganancia,
      margen: p.neto > 0 ? Math.round((ganancia / p.neto) * 1000) / 10 : 0,
      parcial,
    };
  });

  constructor() {
    // El input de ruta ya está disponible en el constructor con signals.
    queueMicrotask(() => void this.cargar());
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.presupuesto.set(await this.api.presupuesto(this.id()));
    } catch (e) {
      this.avisos.error(e, 'No se pudo cargar el presupuesto');
    } finally {
      this.cargando.set(false);
    }
  }

  protected async emitir(): Promise<void> {
    const p = this.presupuesto();
    if (!p) return;
    this.trabajando.set(true);
    try {
      const emitido = await this.api.emitirPresupuesto(p.id);
      this.presupuesto.set(emitido);
      this.avisos.exito(`Emitido con el número ${emitido.numero}. Sus números ya no cambian.`);
    } catch (e) {
      this.avisos.error(e, 'No se pudo emitir');
    } finally {
      this.trabajando.set(false);
    }
  }

  protected async cambiarEstado(estado: EstadoPresupuesto): Promise<void> {
    const p = this.presupuesto();
    if (!p) return;
    this.trabajando.set(true);
    try {
      this.presupuesto.set(await this.api.cambiarEstado(p.id, estado));
      this.avisos.exito(`Marcado como ${ETIQUETAS_ESTADO[estado].toLowerCase()}.`);
    } catch (e) {
      this.avisos.error(e, 'No se pudo cambiar el estado');
    } finally {
      this.trabajando.set(false);
    }
  }

  protected async duplicar(): Promise<void> {
    const p = this.presupuesto();
    if (!p) return;
    this.trabajando.set(true);
    try {
      const nuevo = await this.api.duplicarPresupuesto(p.id);
      this.avisos.exito('Borrador nuevo creado con los precios de hoy.');
      void this.router.navigate(['/presupuestos', nuevo.id]);
    } catch (e) {
      this.avisos.error(e, 'No se pudo duplicar');
    } finally {
      this.trabajando.set(false);
    }
  }

  /**
   * WhatsApp no deja adjuntar un archivo desde una URL, así que el flujo real es:
   * descargar el PDF, abrir el chat con el mensaje ya escrito, adjuntarlo ahí.
   */
  protected async prepararWhatsapp(): Promise<void> {
    const p = this.presupuesto();
    if (!p) return;
    try {
      this.whatsapp.set(await this.api.whatsapp(p.id));
    } catch (e) {
      this.avisos.error(e, 'No se pudo armar el mensaje');
    }
  }

  protected copiarMensaje(): void {
    const wa = this.whatsapp();
    if (!wa) return;
    void navigator.clipboard
      .writeText(wa.mensaje)
      .then(() => this.avisos.exito('Mensaje copiado.'))
      .catch(() => this.avisos.error(new Error('No se pudo copiar al portapapeles.')));
  }

  protected urlDescarga(): string {
    const p = this.presupuesto();
    return p ? this.api.urlPdf(p.id) : '';
  }
}
