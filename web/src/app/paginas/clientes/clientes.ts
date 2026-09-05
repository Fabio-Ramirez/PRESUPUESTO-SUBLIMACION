import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Cliente } from '@calc/shared';
import { Api } from '../../nucleo/api.js';
import { Avisos } from '../../nucleo/avisos.js';
import { Confirmar } from '../../nucleo/confirmar.js';

interface Borrador {
  nombreRazonSocial: string;
  cuitDni: string;
  direccion: string;
  localidad: string;
  telefono: string;
  email: string;
}

const VACIO: Borrador = {
  nombreRazonSocial: '',
  cuitDni: '',
  direccion: '',
  localidad: '',
  telefono: '',
  email: '',
};

/** ABM de clientes. Los datos se copian al presupuesto al emitirlo, no se referencian. */
@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cabecera">
      <div>
        <h1 class="titulo-pagina">Clientes</h1>
        <p class="subtitulo">
          Los datos se copian dentro de cada presupuesto al emitirlo, así que editar un cliente no
          cambia lo que ya se mandó.
        </p>
      </div>
      <button type="button" class="boton boton--primario" (click)="abrirNuevo()">
        + Nuevo cliente
      </button>
    </header>

    <div class="filtros">
      <input
        type="search"
        class="control"
        placeholder="Buscar por nombre, CUIT o email…"
        [ngModel]="busqueda()"
        (ngModelChange)="busqueda.set($event)"
      />
      <label class="campo campo--en-linea">
        <input
          type="checkbox"
          [ngModel]="mostrarInactivos()"
          (ngModelChange)="alternarInactivos($event)"
        />
        <span>Mostrar los dados de baja</span>
      </label>
    </div>

    <!--
      Un cliente "de baja" puede seguir apareciendo en presupuestos viejos: esos
      datos quedan copiados adentro del presupuesto al emitirlo y no dependen de
      que el cliente siga activo. Si aparece ahí pero no en esta lista, es
      justamente porque esta dado de baja — tildar la casilla de arriba lo muestra.
    -->
    <div class="tarjeta">
      <div class="tabla-scroll">
        <table class="tabla">
          <thead>
            <tr>
              <th>Nombre o razón social</th>
              <th>CUIT / DNI</th>
              <th>Localidad</th>
              <th>Teléfono</th>
              <th>Email</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (c of filtrados(); track c.id) {
              <tr [class.fila-inactiva]="!c.activo">
                <td>
                  <strong>{{ c.nombreRazonSocial }}</strong>
                  @if (!c.activo) {
                    <span class="chip-baja">de baja</span>
                  }
                </td>
                <td class="suave">{{ c.cuitDni || '—' }}</td>
                <td class="suave">{{ c.localidad || '—' }}</td>
                <td class="suave">{{ c.telefono || '—' }}</td>
                <td class="suave">{{ c.email || '—' }}</td>
                <td class="tabla__acciones">
                  <button
                    type="button"
                    class="boton boton--secundario boton--chico"
                    (click)="abrirEdicion(c)"
                  >
                    Editar
                  </button>
                  @if (c.activo) {
                    <button
                      type="button"
                      class="boton boton--peligro boton--chico"
                      (click)="desactivar(c)"
                    >
                      Baja
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="boton boton--secundario boton--chico"
                      (click)="reactivar(c)"
                    >
                      Reactivar
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="vacio">
                  @if (cargando()) {
                    Cargando…
                  } @else if (mostrandoInactivosSinResultado()) {
                    No hay clientes dados de baja.
                  } @else {
                    Todavía no hay clientes cargados.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    @if (mostrandoForm()) {
      <div class="modal" (click)="mostrandoForm.set(false)">
        <div class="modal__caja" (click)="$event.stopPropagation()">
          <h2 class="modal__titulo">{{ editandoId() ? 'Editar cliente' : 'Nuevo cliente' }}</h2>

          <label class="campo">
            <span class="etiqueta">Nombre o razón social</span>
            <input
              type="text"
              class="control"
              [ngModel]="borrador().nombreRazonSocial"
              (ngModelChange)="editar({ nombreRazonSocial: $event })"
            />
          </label>

          <div class="grilla">
            <label class="campo">
              <span class="etiqueta">CUIT / DNI</span>
              <input
                type="text"
                class="control"
                [ngModel]="borrador().cuitDni"
                (ngModelChange)="editar({ cuitDni: $event })"
              />
            </label>
            <label class="campo">
              <span class="etiqueta">Teléfono</span>
              <input
                type="tel"
                class="control"
                placeholder="351 444-5566"
                [ngModel]="borrador().telefono"
                (ngModelChange)="editar({ telefono: $event })"
              />
              <small class="tenue">Con esto se arma el link de WhatsApp.</small>
            </label>
            <label class="campo">
              <span class="etiqueta">Dirección</span>
              <input
                type="text"
                class="control"
                [ngModel]="borrador().direccion"
                (ngModelChange)="editar({ direccion: $event })"
              />
            </label>
            <label class="campo">
              <span class="etiqueta">Localidad</span>
              <input
                type="text"
                class="control"
                [ngModel]="borrador().localidad"
                (ngModelChange)="editar({ localidad: $event })"
              />
            </label>
          </div>

          <label class="campo">
            <span class="etiqueta">Email</span>
            <input
              type="email"
              class="control"
              [ngModel]="borrador().email"
              (ngModelChange)="editar({ email: $event })"
            />
          </label>

          <div class="modal__acciones">
            <button type="button" class="boton boton--secundario" (click)="mostrandoForm.set(false)">
              Cancelar
            </button>
            <button
              type="button"
              class="boton boton--primario"
              [disabled]="!borrador().nombreRazonSocial.trim() || guardando()"
              (click)="guardar()"
            >
              Guardar
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    @use 'tokens' as t;

    .grilla {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: t.$p-3;
    }

    .fila-inactiva {
      opacity: 0.65;
    }

    /// Etiqueta de "dado de baja". No es un estado de presupuesto (no usa el mapa
    /// $estados del PDF), asi que tiene su propio estilo en vez de pedirle prestado
    /// el color a un chip--RECHAZADO que significa otra cosa.
    .chip-baja {
      display: inline-block;
      margin-left: t.$p-2;
      padding: 2px t.$p-2;
      border-radius: 999px;
      font-size: t.$p-texto-xs;
      font-weight: t.$peso-fuerte;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: t.$tinta-tenue;
      border: 1px solid t.$borde-fuerte;
    }
  `,
})
export class Clientes {
  private readonly api = inject(Api);
  private readonly avisos = inject(Avisos);
  private readonly confirmar = inject(Confirmar);

  protected readonly lista = signal<Cliente[]>([]);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly busqueda = signal('');
  /**
   * Por defecto solo activos, igual que antes. Al tildar esto se piden TAMBIEN
   * los dados de baja: es la unica forma de encontrar un cliente que desapareció
   * de esta lista pero sigue apareciendo en presupuestos viejos (ese dato queda
   * copiado adentro del presupuesto, no depende de que el cliente siga activo).
   */
  protected readonly mostrarInactivos = signal(false);

  protected readonly mostrandoForm = signal(false);
  protected readonly editandoId = signal<string | null>(null);
  protected readonly borrador = signal<Borrador>({ ...VACIO });

  protected readonly filtrados = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return this.lista();
    return this.lista().filter((c) =>
      [c.nombreRazonSocial, c.cuitDni, c.email, c.localidad]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(texto)),
    );
  });

  /** Distingue "no hay clientes" de "no hay ninguno de baja", para el mensaje vacío. */
  protected mostrandoInactivosSinResultado(): boolean {
    return this.mostrarInactivos() && this.lista().length === 0;
  }

  constructor() {
    void this.recargar();
  }

  private async recargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const { datos } = await this.api.clientes({
        porPagina: 300,
        // false = trae activos E inactivos juntos; true (el default) trae solo activos.
        soloActivos: !this.mostrarInactivos(),
      });
      this.lista.set(datos);
    } catch (e) {
      this.avisos.error(e, 'No se pudo cargar el listado');
    } finally {
      this.cargando.set(false);
    }
  }

  protected alternarInactivos(valor: boolean): void {
    this.mostrarInactivos.set(valor);
    void this.recargar();
  }

  protected abrirNuevo(): void {
    this.editandoId.set(null);
    this.borrador.set({ ...VACIO });
    this.mostrandoForm.set(true);
  }

  protected abrirEdicion(c: Cliente): void {
    this.editandoId.set(c.id);
    this.borrador.set({
      nombreRazonSocial: c.nombreRazonSocial,
      cuitDni: c.cuitDni ?? '',
      direccion: c.direccion ?? '',
      localidad: c.localidad ?? '',
      telefono: c.telefono ?? '',
      email: c.email ?? '',
    });
    this.mostrandoForm.set(true);
  }

  protected editar(cambios: Partial<Borrador>): void {
    this.borrador.update((b) => ({ ...b, ...cambios }));
  }

  protected async guardar(): Promise<void> {
    const b = this.borrador();
    if (!b.nombreRazonSocial.trim()) return;

    // Los vacíos no se mandan: un CUIT en blanco chocaría con el índice único.
    const datos: Partial<Cliente> = { nombreRazonSocial: b.nombreRazonSocial.trim() };
    for (const campo of ['cuitDni', 'direccion', 'localidad', 'telefono', 'email'] as const) {
      const v = b[campo].trim();
      if (v) datos[campo] = v;
    }

    this.guardando.set(true);
    try {
      const id = this.editandoId();
      if (id) {
        await this.api.actualizarCliente(id, datos);
        this.avisos.exito('Cliente actualizado.');
      } else {
        await this.api.crearCliente(datos);
        this.avisos.exito('Cliente creado.');
      }
      await this.recargar();
      this.mostrandoForm.set(false);
    } catch (e) {
      this.avisos.error(e, 'No se pudo guardar el cliente');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async desactivar(c: Cliente): Promise<void> {
    const ok = await this.confirmar.preguntar(`¿Dar de baja a "${c.nombreRazonSocial}"?`, {
      titulo: 'Dar de baja',
      textoAceptar: 'Dar de baja',
      peligroso: true,
    });
    if (!ok) return;
    try {
      await this.api.desactivarCliente(c.id);
      await this.recargar();
      this.avisos.exito('Cliente dado de baja.');
    } catch (e) {
      this.avisos.error(e, 'No se pudo dar de baja');
    }
  }

  protected async reactivar(c: Cliente): Promise<void> {
    try {
      await this.api.actualizarCliente(c.id, { activo: true });
      await this.recargar();
      this.avisos.exito(`"${c.nombreRazonSocial}" reactivado.`);
    } catch (e) {
      this.avisos.error(e, 'No se pudo reactivar');
    }
  }
}
