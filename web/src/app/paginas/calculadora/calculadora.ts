import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  DEFAULTS,
  ETIQUETAS_UNIDAD_USO,
  aCentavos,
  aMilicentavos,
  calcularCosteo,
  calcularSubtotalItem,
  type Centavos,
  type EntradaCosteo,
  type ResultadoCosteo,
} from '@calc/shared';
import { Api, type EntradaProducto } from '../../nucleo/api.js';
import { Avisos } from '../../nucleo/avisos.js';
import { Catalogo } from '../../nucleo/catalogo.js';
import { PIPES_FORMATO, pesosDeTexto, textoDePesos } from '../../nucleo/formato.js';

interface FilaInsumo {
  insumoId: string;
  cantidad: number;
}

interface FilaEquipo {
  equipoId: string;
  unidadesConsumidas: number;
  minutosUso: number;
}

/**
 * La Calculadora: los cuatro bloques de la planilla, recalculados en vivo.
 *
 * El costeo corre EN EL CLIENTE con `calcularCosteo`, el mismo motor de /shared que
 * usa la API al emitir un presupuesto. Por eso el precio de venta se actualiza en el
 * mismo frame en que se mueve el margen, y por eso no puede diferir de lo que
 * despues queda congelado en el presupuesto.
 */
@Component({
  selector: 'app-calculadora',
  standalone: true,
  imports: [FormsModule, ...PIPES_FORMATO],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calculadora.html',
  styleUrl: './calculadora.scss',
})
export class Calculadora {
  private readonly api = inject(Api);
  private readonly avisos = inject(Avisos);
  private readonly router = inject(Router);
  protected readonly catalogo = inject(Catalogo);

  protected readonly etiquetasUnidad = ETIQUETAS_UNIDAD_USO;

  // --- Bloque 1: insumos ----------------------------------------------------
  protected readonly filasInsumo = signal<FilaInsumo[]>([]);

  // --- Bloque 2: produccion -------------------------------------------------
  protected readonly filasEquipo = signal<FilaEquipo[]>([]);
  protected readonly minutosManoObra = signal(0);
  protected readonly otrosGastosTexto = signal('');

  // --- Bloque 3: precio y rentabilidad --------------------------------------
  protected readonly porcentajeMerma = signal<number>(DEFAULTS.PORCENTAJE_MERMA);
  protected readonly margen = signal<number>(DEFAULTS.MARGEN);
  // Los tipos explicitos importan: DEFAULTS es `as const`, asi que sin ellos el
  // signal queda cerrado en el literal (0, 3, 50) y no acepta otro valor.
  protected readonly comisionPlataforma = signal<number>(DEFAULTS.COMISION_PLATAFORMA);

  // --- Bloque 4: cotizacion -------------------------------------------------
  protected readonly cantidadCotizada = signal(1);

  protected readonly nombreProducto = signal('');
  protected readonly guardando = signal(false);

  /** Canales frecuentes. Sin entidad propia todavia: son atajos del selector. */
  protected readonly canales = [
    { nombre: 'Venta directa / efectivo', comision: 0 },
    { nombre: 'MercadoPago (link)', comision: 6.9 },
    { nombre: 'MercadoLibre clásica', comision: 13 },
    { nombre: 'MercadoLibre premium', comision: 17.5 },
  ];

  /**
   * El costeo completo. Todo lo que se muestra en pantalla sale de aca, asi que un
   * cambio en cualquier campo actualiza los cuatro bloques a la vez.
   */
  protected readonly costeo = computed<ResultadoCosteo>(() => {
    const insumos = this.catalogo.insumosPorId();
    const equipos = this.catalogo.equiposPorId();
    const costos = this.catalogo.costos();

    const entrada: EntradaCosteo = {
      insumos: this.filasInsumo()
        .filter((f) => f.insumoId)
        .map((f) => {
          const i = insumos.get(f.insumoId);
          return {
            insumoId: f.insumoId,
            nombre: i?.nombre ?? '(sin nombre)',
            tipo: i?.tipo ?? 'OTRO',
            unidadUso: i?.unidadUso ?? 'UNIDAD',
            cantidad: f.cantidad,
            precioPorUnidadUso: i?.precioVigente?.precioPorUnidadUso ?? null,
          };
        }),
      equipos: this.filasEquipo()
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
      minutosManoObra: this.minutosManoObra(),
      valorHoraManoObra: aMilicentavos(costos.valorHoraManoObra),
      costoKwh: aMilicentavos(costos.costoKwh),
      otrosGastos: aMilicentavos((pesosDeTexto(this.otrosGastosTexto()) ?? 0) as Centavos),
      porcentajeMerma: this.porcentajeMerma(),
      margen: this.margen(),
      comisionPlataforma: this.comisionPlataforma(),
    };

    return calcularCosteo(entrada);
  });

  /** El precio que se lleva al presupuesto: centavos, redondeado una sola vez. */
  protected readonly precioUnitario = computed(() => aCentavos(this.costeo().precioVentaFinal));

  protected readonly totalCotizado = computed(() =>
    calcularSubtotalItem(this.precioUnitario(), this.cantidadCotizada()),
  );

  protected readonly gananciaTotal = computed(() =>
    calcularSubtotalItem(
      (this.precioUnitario() - aCentavos(this.costeo().costoTotalUnitario)) as Centavos,
      this.cantidadCotizada(),
    ),
  );

  /**
   * El contraejemplo del error clasico, calculado con los numeros que el usuario
   * tiene delante. Es mas convincente que una nota generica.
   */
  protected readonly precioSiSeMultiplicara = computed(() =>
    aCentavos(
      Math.round(this.costeo().costoTotalUnitario * (1 + this.margen() / 100)) as never,
    ),
  );

  /**
   * Recargo equivalente al margen, calculado solo desde el porcentaje.
   *
   * El del costeo devuelve 0 mientras no hay costo (evita dividir por cero), y ahi
   * el cartel diria "margen 50% = recargo 0%", que es justo lo contrario de lo que
   * tiene que enseñar. Este vale desde el primer render.
   */
  protected readonly recargoEquivalente = computed(() => {
    const m = this.margen();
    if (m <= 0 || m >= 100) return 0;
    return Math.round((m / (100 - m)) * 1000) / 10;
  });

  protected readonly hayReceta = computed(
    () => this.filasInsumo().length > 0 || this.filasEquipo().length > 0,
  );

  constructor() {
    void this.catalogo.asegurarCargado().catch((e: unknown) => this.avisos.error(e));
  }

  // --- Edicion de filas -----------------------------------------------------

  protected agregarInsumo(): void {
    this.filasInsumo.update((f) => [...f, { insumoId: '', cantidad: 1 }]);
  }

  protected quitarInsumo(indice: number): void {
    this.filasInsumo.update((f) => f.filter((_, i) => i !== indice));
  }

  protected cambiarInsumo(indice: number, insumoId: string): void {
    this.filasInsumo.update((f) =>
      f.map((fila, i) => (i === indice ? { ...fila, insumoId } : fila)),
    );
  }

  protected cambiarCantidad(indice: number, cantidad: number): void {
    this.filasInsumo.update((f) =>
      f.map((fila, i) => (i === indice ? { ...fila, cantidad: cantidad || 0 } : fila)),
    );
  }

  protected agregarEquipo(): void {
    this.filasEquipo.update((f) => [
      ...f,
      { equipoId: '', unidadesConsumidas: 1, minutosUso: 0 },
    ]);
  }

  protected quitarEquipo(indice: number): void {
    this.filasEquipo.update((f) => f.filter((_, i) => i !== indice));
  }

  protected actualizarEquipo(indice: number, cambios: Partial<FilaEquipo>): void {
    this.filasEquipo.update((f) =>
      f.map((fila, i) => (i === indice ? { ...fila, ...cambios } : fila)),
    );
  }

  protected unidadDe(insumoId: string): string {
    const i = this.catalogo.insumosPorId().get(insumoId);
    return i ? this.etiquetasUnidad[i.unidadUso] : '';
  }

  protected precioUnitarioDe(insumoId: string): number | null {
    return this.catalogo.insumosPorId().get(insumoId)?.precioVigente?.precioPorUnidadUso ?? null;
  }

  protected limpiar(): void {
    this.filasInsumo.set([]);
    this.filasEquipo.set([]);
    this.minutosManoObra.set(0);
    this.otrosGastosTexto.set('');
    this.porcentajeMerma.set(DEFAULTS.PORCENTAJE_MERMA);
    this.margen.set(DEFAULTS.MARGEN);
    this.comisionPlataforma.set(DEFAULTS.COMISION_PLATAFORMA);
    this.cantidadCotizada.set(1);
    this.nombreProducto.set('');
  }

  // --- Guardar como producto ------------------------------------------------

  /**
   * Convierte lo que hay en pantalla en un producto reutilizable. Es el puente
   * entre "estoy tanteando un precio" y "esto lo hago seguido".
   */
  protected async guardarComoProducto(): Promise<void> {
    const nombre = this.nombreProducto().trim();
    if (!nombre) {
      this.avisos.error(new Error('Ponele un nombre al producto para poder guardarlo.'));
      return;
    }

    const datos: EntradaProducto = {
      nombre,
      categoria: 'General',
      insumos: this.filasInsumo()
        .filter((f) => f.insumoId)
        .map((f) => ({ insumo: f.insumoId, cantidad: f.cantidad })),
      equipos: this.filasEquipo()
        .filter((f) => f.equipoId)
        .map((f) => ({
          equipo: f.equipoId,
          unidadesConsumidas: f.unidadesConsumidas,
          minutosUso: f.minutosUso,
        })),
      minutosManoObra: this.minutosManoObra(),
      otrosGastos: pesosDeTexto(this.otrosGastosTexto()) ?? 0,
      porcentajeMerma: this.porcentajeMerma(),
      margen: this.margen(),
      comisionPlataforma: this.comisionPlataforma(),
      tramosDescuento: [],
    };

    this.guardando.set(true);
    try {
      const producto = await this.api.crearProducto(datos);
      this.avisos.exito(`Producto "${producto.nombre}" guardado.`);
      this.nombreProducto.set('');
    } catch (e) {
      this.avisos.error(e, 'No se pudo guardar el producto');
    } finally {
      this.guardando.set(false);
    }
  }

  protected irACotizar(): void {
    void this.router.navigate(['/presupuestos/nuevo']);
  }

  protected readonly textoDePesos = textoDePesos;
}
