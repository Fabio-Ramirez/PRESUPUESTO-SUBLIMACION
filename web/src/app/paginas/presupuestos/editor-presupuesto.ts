import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  aCentavos,
  calcularSubtotalItem,
  porcentajeDeTramo,
  type Centavos,
  type Cliente,
  type Producto,
} from '@calc/shared';
import { Api, type EntradaPresupuesto } from '../../nucleo/api.js';
import { Avisos } from '../../nucleo/avisos.js';
import { Catalogo } from '../../nucleo/catalogo.js';
import { PIPES_FORMATO, pesosDeTexto, textoDePesos } from '../../nucleo/formato.js';

interface FilaItem {
  productoId: string;
  descripcion: string;
  cantidad: number;
  /** Vacío = usar el precio que calcula el motor para ese producto. */
  precioTexto: string;
}

/**
 * Alta de presupuesto (borrador).
 *
 * Los totales que se ven acá son una previsualización: el número que vale lo calcula
 * el servidor al guardar, con el mismo motor de /shared. Se muestran igual para que
 * el usuario no tenga que guardar a ciegas para ver cuánto da.
 */
@Component({
  selector: 'app-editor-presupuesto',
  standalone: true,
  imports: [FormsModule, RouterLink, ...PIPES_FORMATO],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor-presupuesto.html',
  styleUrl: './editor-presupuesto.scss',
})
export class EditorPresupuesto {
  private readonly api = inject(Api);
  private readonly avisos = inject(Avisos);
  private readonly router = inject(Router);
  protected readonly catalogo = inject(Catalogo);

  protected readonly clientes = signal<Cliente[]>([]);
  protected readonly productos = signal<Producto[]>([]);
  /** Precio de venta por producto, ya costeado por la API. */
  protected readonly preciosPorProducto = signal(new Map<string, Centavos>());

  protected readonly clienteId = signal('');
  protected readonly items = signal<FilaItem[]>([
    { productoId: '', descripcion: '', cantidad: 1, precioTexto: '' },
  ]);
  protected readonly validezDias = signal(15);
  protected readonly porcentajeSenia = signal(50);
  protected readonly condiciones = signal('');
  protected readonly notasInternas = signal('');
  protected readonly sinDescuento = signal(false);

  protected readonly guardando = signal(false);
  protected readonly cargando = signal(true);

  protected readonly productosPorId = computed(() => new Map(this.productos().map((p) => [p.id, p])));

  /** Precio unitario efectivo de una fila: el escrito a mano o el del producto. */
  protected precioDe(fila: FilaItem): Centavos {
    const manual = pesosDeTexto(fila.precioTexto);
    if (manual !== null) return manual as Centavos;
    return this.preciosPorProducto().get(fila.productoId) ?? (0 as Centavos);
  }

  protected subtotalDe(fila: FilaItem): Centavos {
    return calcularSubtotalItem(this.precioDe(fila), fila.cantidad);
  }

  protected readonly subtotal = computed(() =>
    this.items().reduce((t, f) => t + this.subtotalDe(f), 0),
  );

  /**
   * El descuento por tramos que va a aplicar el servidor, calculado acá con la
   * misma función de /shared para que no sea una sorpresa al guardar.
   */
  protected readonly descuentoEstimado = computed(() => {
    if (this.sinDescuento()) return 0;
    let monto = 0;
    for (const fila of this.items()) {
      const producto = this.productosPorId().get(fila.productoId);
      const tramos =
        producto?.tramosDescuento?.length
          ? producto.tramosDescuento
          : (this.catalogo.configuracion()?.presupuestos.tramosDescuentoPorDefecto ?? []);
      const pct = porcentajeDeTramo(fila.cantidad, tramos);
      if (pct > 0) monto += Math.round((this.subtotalDe(fila) * pct) / 100);
    }
    return monto;
  });

  protected readonly total = computed(() => this.subtotal() - this.descuentoEstimado());
  protected readonly montoSenia = computed(() =>
    Math.round((this.total() * this.porcentajeSenia()) / 100),
  );

  protected readonly puedeGuardar = computed(
    () =>
      this.clienteId() !== '' &&
      this.items().some((f) => f.productoId || (f.descripcion.trim() && f.precioTexto)),
  );

  constructor() {
    void this.inicializar();
  }

  private async inicializar(): Promise<void> {
    try {
      await this.catalogo.asegurarCargado();
      const [clientes, productos] = await Promise.all([
        this.api.clientes({ porPagina: 200 }),
        this.api.productos({ porPagina: 200 }),
      ]);
      this.clientes.set(clientes.datos);
      this.productos.set(productos.datos);

      const config = this.catalogo.configuracion();
      if (config) {
        this.validezDias.set(config.presupuestos.validezDiasPorDefecto);
        this.porcentajeSenia.set(config.presupuestos.porcentajeSeniaPorDefecto);
        this.condiciones.set(config.presupuestos.condicionesGeneralesPorDefecto);
      }

      // Los precios se piden a la API porque el costeo de cada producto necesita
      // sus insumos y equipos resueltos; se hace una sola vez, al abrir.
      const precios = new Map<string, Centavos>();
      await Promise.all(
        productos.datos.map(async (p) => {
          try {
            const { costeo } = await this.api.costeoDeProducto(p.id);
            precios.set(p.id, aCentavos(costeo.precioVentaFinal));
          } catch {
            // Un producto que no cotiza no puede romper la pantalla entera.
          }
        }),
      );
      this.preciosPorProducto.set(precios);
    } catch (e) {
      this.avisos.error(e);
    } finally {
      this.cargando.set(false);
    }
  }

  protected agregarItem(): void {
    this.items.update((f) => [...f, { productoId: '', descripcion: '', cantidad: 1, precioTexto: '' }]);
  }

  protected quitarItem(i: number): void {
    this.items.update((f) => f.filter((_, k) => k !== i));
  }

  protected editarItem(i: number, cambios: Partial<FilaItem>): void {
    this.items.update((f) => f.map((fila, k) => (k === i ? { ...fila, ...cambios } : fila)));
  }

  /** Al elegir producto se copia su nombre como descripción, editable después. */
  protected elegirProducto(i: number, productoId: string): void {
    const producto = this.productosPorId().get(productoId);
    this.editarItem(i, {
      productoId,
      descripcion: producto?.nombre ?? '',
      precioTexto: '',
    });
  }

  protected precioSugeridoTexto(fila: FilaItem): string {
    const p = this.preciosPorProducto().get(fila.productoId);
    return p === undefined ? '' : textoDePesos(p);
  }

  protected async guardar(emitirDespues: boolean): Promise<void> {
    const datos: EntradaPresupuesto = {
      clienteId: this.clienteId(),
      items: this.items()
        .filter((f) => f.productoId || f.descripcion.trim())
        .map((f) => {
          const manual = pesosDeTexto(f.precioTexto);
          return {
            ...(f.productoId ? { productoId: f.productoId } : {}),
            ...(f.descripcion.trim() ? { descripcion: f.descripcion.trim() } : {}),
            cantidad: f.cantidad,
            ...(manual !== null ? { precioUnitario: manual } : {}),
          };
        }),
      validezDias: this.validezDias(),
      porcentajeSenia: this.porcentajeSenia(),
      condicionesGenerales: this.condiciones(),
      ...(this.notasInternas().trim() ? { notasInternas: this.notasInternas().trim() } : {}),
      ...(this.sinDescuento() ? { sinDescuento: true } : {}),
    };

    this.guardando.set(true);
    try {
      const borrador = await this.api.crearPresupuesto(datos);
      if (emitirDespues) {
        const emitido = await this.api.emitirPresupuesto(borrador.id);
        this.avisos.exito(`Presupuesto ${emitido.numero} emitido.`);
      } else {
        this.avisos.exito('Borrador guardado. Podés previsualizarlo antes de emitir.');
      }
      void this.router.navigate(['/presupuestos', borrador.id]);
    } catch (e) {
      this.avisos.error(e, 'No se pudo guardar el presupuesto');
    } finally {
      this.guardando.set(false);
    }
  }
}
