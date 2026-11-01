import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvailabilitySearchService } from '../../../availability-search.service';
import { AvailabilitySearch, Room } from '../../../api.service';

@Component({
  selector: 'app-room-card',
  standalone: true,
  imports: [RouterLink, CurrencyPipe],
  templateUrl: './tarjeta-habitacion.component.html',
  styleUrl: './tarjeta-habitacion.component.scss',
})
export class TarjetaHabitacion {
  private readonly availability = inject(AvailabilitySearchService);

  readonly room = input.required<Room>();
  readonly imageIndex = signal(0);
  readonly galleryImages = computed(() => {
    const images = this.room().images?.map((image) => image.image_url).filter(Boolean) ?? [];
    const gallery = images.length ? images : this.room().image_url ? [this.room().image_url] : [];
    return gallery.length ? gallery : this.fallbackImages;
  });
  readonly currentImage = computed(() => this.galleryImages()[this.imageIndex() % this.galleryImages().length]);
  readonly index = input(0);
  readonly reservationSearch = input<AvailabilitySearch | null>(null);
  readonly fallbackImages = [
    '/api/web-images/hotel.png',
  ];

  selectForBooking() {
    this.availability.selectRoom(this.room().id, this.reservationSearch());
  }

  showNextImage(): void {
    this.imageIndex.update((index) => (index + 1) % this.galleryImages().length);
  }

  showPreviousImage(): void {
    this.imageIndex.update((index) => (index - 1 + this.galleryImages().length) % this.galleryImages().length);
  }
}
