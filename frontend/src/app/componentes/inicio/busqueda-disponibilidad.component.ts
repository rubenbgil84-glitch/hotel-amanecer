import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AvailabilitySearchService } from '../../availability-search.service';
import { ApiService } from '../../api.service';
import { CalendarioRango, DateRange } from '../compartidos/calendario-rango/calendario-rango.component';

@Component({
  selector: 'app-availability-search',
  standalone: true,
  imports: [ReactiveFormsModule, CalendarioRango],
  templateUrl: './busqueda-disponibilidad.component.html',
  styleUrl: './busqueda-disponibilidad.component.scss',
})
export class BusquedaDisponibilidad {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly availability = inject(AvailabilitySearchService);
  private readonly api = inject(ApiService);

  readonly error = signal('');
  readonly searching = signal(false);
  readonly adultsOptions = Array.from({ length: 13 }, (_, index) => index + 1);
  readonly childrenOptions = Array.from({ length: 13 }, (_, index) => index);

  readonly form = this.fb.group({
    date_range: new FormControl<DateRange | null>(
      this.availability.search()
        ? {
          check_in: this.availability.search()!.check_in,
          check_out: this.availability.search()!.check_out,
        }
        : null,
      Validators.required,
    ),
    adults: [2, [Validators.required, Validators.min(1), Validators.max(13)]],
    children: [0, [Validators.required, Validators.min(0), Validators.max(12)]],
  });

  async search() {
    if (this.searching()) return;
    this.error.set('');
    if (this.form.invalid) {
      this.error.set('Elige las fechas y el número de huéspedes para consultar disponibilidad.');
      this.form.markAllAsTouched();
      return;
    }

    const { date_range, adults, children } = this.form.getRawValue();
    if (!date_range) return;
    if (adults + children > 13) {
      this.error.set('La reserva admite hasta 13 huéspedes.');
      return;
    }

    try {
      this.searching.set(true);
      const search = { ...date_range, adults, children };
      const rooms = await firstValueFrom(this.api.availableRooms(search));
      this.availability.saveSearch(search, rooms);

      try {
        const navigated = await this.router.navigate(['/reservas']);
        if (!navigated && !this.router.url.startsWith('/reservas')) {
          window.location.assign('/reservas/');
        }
      } catch (error) {
        console.error('No se pudo navegar a los resultados de disponibilidad.', error);
        if (!this.router.url.startsWith('/reservas')) {
          window.location.assign('/reservas/');
        } else {
          this.error.set('La búsqueda se completó, pero no se pudo actualizar la página de resultados.');
        }
      }
    } catch (error) {
      console.error('No se pudo consultar la disponibilidad.', error);
      this.error.set(
        error instanceof HttpErrorResponse
          ? error.error?.errors?.[0] ?? 'No se pudo consultar la disponibilidad. Comprueba que el servicio esté en marcha.'
          : 'No se pudo consultar la disponibilidad. Comprueba que el servicio esté en marcha.',
      );
    } finally {
      this.searching.set(false);
    }
  }
}
