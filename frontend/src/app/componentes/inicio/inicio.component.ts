import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../api.service';
import { SiteContentService } from '../../site-content.service';
import type { PublishedTestimonial } from '../../site-settings.model';
import { TarjetaHabitacion } from '../habitaciones/tarjetas/tarjeta-habitacion.component';
import { BusquedaDisponibilidad } from './busqueda-disponibilidad.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [BusquedaDisponibilidad, TarjetaHabitacion, RouterLink],
  templateUrl: './inicio.component.html',
  styleUrl: './inicio.component.scss',
})
export class Home {
  private readonly api = inject(ApiService);
  readonly siteContent = inject(SiteContentService);
  readonly testimonials = signal<PublishedTestimonial[]>([]);
  // undefined = cargando, null = error, array = datos
  readonly rooms = toSignal(this.api.rooms().pipe(catchError(() => of(null))));

  constructor() {
    this.api.testimonials().subscribe({
      next: (testimonials) => this.testimonials.set(testimonials),
      error: (error: unknown) => {
        console.error('No se pudieron cargar las opiniones publicadas.', error);
      },
    });
  }

  travelTypeLabel(testimonial: PublishedTestimonial): string {
    if (testimonial.travel_type === 'other') return testimonial.travel_type_other ?? 'Otro';
    return ({
      work: 'Viaje de trabajo',
      family: 'Escapada familiar',
      couple: 'Viaje en pareja',
      friends: 'Viaje con amigos',
      camino: 'Camino de Santiago',
      solo: 'Viaje en solitario',
    } as Record<string, string>)[testimonial.travel_type] ?? testimonial.travel_type;
  }

  submittedAtLabel(testimonial: PublishedTestimonial): string {
    const submittedAt = new Date(testimonial.fecha);
    if (Number.isNaN(submittedAt.getTime())) return '';
    return submittedAt.toLocaleDateString('es-ES');
  }
}
