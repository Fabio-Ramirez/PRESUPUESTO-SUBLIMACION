import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Avisos } from './nucleo/avisos.js';
import { Catalogo } from './nucleo/catalogo.js';
import { Confirmar } from './nucleo/confirmar.js';

interface ItemNav {
  ruta: string;
  texto: string;
  icono: string;
  /** Separador visual: agrupa la operatoria diaria y la configuracion. */
  grupo: 'trabajo' | 'datos' | 'ajustes';
}

@Component({
  selector: 'app-raiz',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly avisos = inject(Avisos);
  protected readonly catalogo = inject(Catalogo);
  protected readonly confirmar = inject(Confirmar);

  protected readonly menuAbierto = signal(false);

  protected readonly navegacion: ItemNav[] = [
    { ruta: '/calculadora', texto: 'Calculadora', icono: '🧮', grupo: 'trabajo' },
    { ruta: '/presupuestos', texto: 'Presupuestos', icono: '📄', grupo: 'trabajo' },
    { ruta: '/productos', texto: 'Productos', icono: '📦', grupo: 'datos' },
    { ruta: '/insumos', texto: 'Insumos', icono: '🧾', grupo: 'datos' },
    { ruta: '/precios', texto: 'Actualizar precios', icono: '💲', grupo: 'datos' },
    { ruta: '/stock', texto: 'Stock', icono: '🗃️', grupo: 'datos' },
    { ruta: '/equipos', texto: 'Equipos', icono: '🖨️', grupo: 'datos' },
    { ruta: '/clientes', texto: 'Clientes', icono: '👤', grupo: 'datos' },
    { ruta: '/configuracion', texto: 'Configuración', icono: '⚙️', grupo: 'ajustes' },
  ];

  protected grupo(g: ItemNav['grupo']): ItemNav[] {
    return this.navegacion.filter((n) => n.grupo === g);
  }

  protected cerrarMenu(): void {
    this.menuAbierto.set(false);
  }
}
