import { CurrencyPipe, DatePipe } from '@angular/common';
import type { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, type ReservationDetails as ReservationDetailsData } from '../../api.service';
import { SiteContentService } from '../../site-content.service';
import { RoomGallery } from '../compartidos/room-gallery/room-gallery.component';

@Component({
  selector: 'app-reserva-detalle',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, RouterLink, RoomGallery],
  templateUrl: './reserva-detalle.component.html',
  styleUrl: './reserva-detalle.component.scss',
})
export class ReservaDetalle {
  private readonly api = inject(ApiService);
  readonly siteContent = inject(SiteContentService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly booking = signal<ReservationDetailsData | null>(null);
  readonly status = signal<'loading' | 'ready' | 'invalid'>('loading');
  readonly token = signal('');
  readonly roomGalleryImages = computed(() => this.booking()?.room_images.map((image) => image.image_url) ?? []);

  documentTypeLabel(value: string | null): string {
    return ({
      identity: 'DNI / NIE / otro',
      dni: 'DNI',
      tie: 'NIE',
      passport: 'Pasaporte',
    } as Record<string, string>)[value ?? ''] ?? value ?? '';
  }

  preferredBedLabel(value: string | null): string {
    return ({
      individual: 'Individual',
      any: 'Sin preferencia',
      double: 'Doble',
      twin: 'Dos camas',
    } as Record<string, string>)[value ?? ''] ?? value ?? '';
  }

  sexLabel(value: string | null): string {
    return ({
      female: 'Mujer',
      male: 'Hombre',
      other: 'Otro',
    } as Record<string, string>)[value ?? ''] ?? value ?? '';
  }

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const token = params.get('token') ?? '';
      this.token.set(token);
      this.booking.set(null);
      this.status.set('loading');
      if (!/^(?:[\w-]{43}|\d+\.[\w-]{43})$/.test(token)) {
        this.status.set('invalid');
        return;
      }

      this.api.reservationDetails(token)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (booking) => {
            this.booking.set(booking);
            this.status.set('ready');
          },
          error: (error: HttpErrorResponse) => {
            console.error('No se pudieron cargar los datos de la reserva.', error);
            this.status.set('invalid');
          },
        });
    });
  }
}
