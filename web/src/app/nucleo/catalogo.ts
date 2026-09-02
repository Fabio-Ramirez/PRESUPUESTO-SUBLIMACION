import { Injectable, computed, inject, signal } from '@angular/core';
import type { Configuracion, CostosOperativos, Equipo, InsumoConPrecio } from '@calc/shared';
import { Api } from './api.js';

/**
 * Catalogo en memoria: insumos con su precio vigente, equipos y configuracion.
 *
 * Existe para que la Calculadora pueda recalcular EN EL CLIENTE con cada tecla,
 * usando el mismo motor de /shared que la API usa al emitir. Sin esto habria un
 * pedido HTTP por pulsacion, y el precio de venta —que es el numero que el usuario
 * mira mientras mueve el margen— tardaria en actualizarse.
 *
 * Se carga una vez y se refresca a mano despues de cargar precios o editar equipos.
 */
@Injectable({ providedIn: 'root' })
export class Catalogo {
  private readonly api = inject(Api);

  readonly insumos = signal<InsumoConPrecio[]>([]);
  readonly equipos = signal<Equipo[]>([]);
  readonly configuracion = signal<Configuracion | null>(null);
  readonly cargando = signal(false);
  readonly cargado = signal(false);

  readonly insumosPorId = computed(() => new Map(this.insumos().map((i) => [i.id, i])));
  readonly equiposPorId = computed(() => new Map(this.equipos().map((e) => [e.id, e])));

  /** Cuantos insumos tienen el precio con mas de 30 dias o sin cargar. */
  readonly insumosDesactualizados = computed(
    () => this.insumos().filter((i) => i.precioDesactualizado).length,
  );

  /**
   * El tipo explicito importa: sin el, el objeto por defecto ensancha Centavos a
   * number y el motor de costeo deja de aceptar el resultado.
   */
  readonly costos = computed<CostosOperativos>(
    () => this.configuracion()?.costos ?? { valorHoraManoObra: 0 as never, costoKwh: 0 as never },
  );

  /** Idempotente: las pantallas la llaman al entrar sin coordinarse entre si. */
  async asegurarCargado(): Promise<void> {
    if (this.cargado() || this.cargando()) return;
    await this.recargar();
  }

  async recargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const [insumos, equipos, configuracion] = await Promise.all([
        this.api.insumosConPrecios(),
        this.api.equipos({ porPagina: 200 }),
        this.api.configuracion(),
      ]);
      this.insumos.set(insumos.datos);
      this.equipos.set(equipos.datos);
      this.configuracion.set(configuracion);
      this.cargado.set(true);
    } finally {
      this.cargando.set(false);
    }
  }
}
