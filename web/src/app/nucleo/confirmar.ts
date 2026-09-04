import { Injectable, signal } from '@angular/core';

export interface OpcionesConfirmacion {
  titulo?: string;
  textoAceptar?: string;
  textoCancelar?: string;
  /** true para acciones destructivas (baja, borrar): el boton de aceptar sale rojo. */
  peligroso?: boolean;
}

export interface PedidoConfirmacion extends Required<OpcionesConfirmacion> {
  mensaje: string;
}

/**
 * Reemplazo del `confirm()` nativo del navegador.
 *
 * El dialogo del navegador ("localhost:3000 dice...") no se puede estilar y no
 * tiene nada que ver con el resto de la app. Este servicio guarda el pedido en un
 * signal que `app.html` renderiza una unica vez, como modal propio, y devuelve una
 * promesa que se resuelve cuando el usuario clickea Aceptar o Cancelar — se usa
 * exactamente como el `confirm()` viejo: `if (!(await confirmar.preguntar(...)))
 * return;`.
 */
@Injectable({ providedIn: 'root' })
export class Confirmar {
  readonly pedido = signal<PedidoConfirmacion | null>(null);
  private resolver: ((valor: boolean) => void) | null = null;

  preguntar(mensaje: string, opciones: OpcionesConfirmacion = {}): Promise<boolean> {
    // Si hubiera un pedido anterior sin resolver (no deberia pasar: es un modal
    // bloqueante), se lo da por cancelado antes de reemplazarlo.
    this.resolver?.(false);

    this.pedido.set({
      mensaje,
      titulo: opciones.titulo ?? 'Confirmar',
      textoAceptar: opciones.textoAceptar ?? 'Aceptar',
      textoCancelar: opciones.textoCancelar ?? 'Cancelar',
      peligroso: opciones.peligroso ?? false,
    });

    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  responder(valor: boolean): void {
    this.pedido.set(null);
    this.resolver?.(valor);
    this.resolver = null;
  }
}
