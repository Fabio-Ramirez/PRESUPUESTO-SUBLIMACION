import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';

export interface Aviso {
  id: number;
  tipo: 'exito' | 'error' | 'info';
  texto: string;
  detalles?: string[];
}

/**
 * Avisos al usuario.
 *
 * Concentra ademas la traduccion de los errores HTTP: la API ya devuelve mensajes
 * escritos para leer ("El presupuesto 001-001 ya fue emitido y no se modifica"),
 * asi que lo unico que hay que hacer es no taparlos con un "Error 409".
 */
@Injectable({ providedIn: 'root' })
export class Avisos {
  private siguiente = 1;
  readonly lista = signal<Aviso[]>([]);

  exito(texto: string): void {
    this.mostrar({ tipo: 'exito', texto });
  }

  info(texto: string): void {
    this.mostrar({ tipo: 'info', texto });
  }

  error(e: unknown, contexto?: string): void {
    const { texto, detalles } = this.traducir(e, contexto);
    this.mostrar({ tipo: 'error', texto, ...(detalles ? { detalles } : {}) });
  }

  cerrar(id: number): void {
    this.lista.update((l) => l.filter((a) => a.id !== id));
  }

  private mostrar(aviso: Omit<Aviso, 'id'>): void {
    const id = this.siguiente++;
    this.lista.update((l) => [...l, { ...aviso, id }]);
    // Los errores se quedan hasta que el usuario los cierre: suelen pedir una
    // accion, y uno que se va solo a los 4 segundos es un error que no se leyo.
    if (aviso.tipo !== 'error') {
      setTimeout(() => this.cerrar(id), 4000);
    }
  }

  private traducir(e: unknown, contexto?: string): { texto: string; detalles?: string[] } {
    const prefijo = contexto ? `${contexto}: ` : '';

    if (e instanceof HttpErrorResponse) {
      if (e.status === 0) {
        return { texto: 'No se pudo conectar con el servidor. ¿Está levantada la API?' };
      }
      const cuerpo = e.error as { error?: string; detalles?: { campo: string; mensaje: string }[] };
      const texto = prefijo + (cuerpo?.error ?? `Error ${e.status}.`);
      const detalles = cuerpo?.detalles?.map((d) => `${d.campo}: ${d.mensaje}`);
      return detalles?.length ? { texto, detalles } : { texto };
    }

    if (e instanceof Error) return { texto: prefijo + e.message };
    return { texto: prefijo + 'Ocurrió un error inesperado.' };
  }
}
