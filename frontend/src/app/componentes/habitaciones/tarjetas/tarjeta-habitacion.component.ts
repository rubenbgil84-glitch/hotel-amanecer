import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvailabilitySearchService } from '../../../availability-search.service';
import { AvailabilitySearch, Room } from '../../../api.service';
import { RoomGallery } from '../../compartidos/room-gallery/room-gallery.component';

@Component({
  selector: 'app-room-card',
  standalone: true,
  imports: [RouterLink, CurrencyPipe, RoomGallery],
  templateUrl: './tarjeta-habitacion.component.html',
  styleUrl: './tarjeta-habitacion.component.scss',
})
export class TarjetaHabitacion {
  private readonly availability = inject(AvailabilitySearchService);

  readonly room = input.required<Room>();
  readonly galleryImages = computed(() => {
    const images = this.room().images?.map((image) => image.image_url).filter((image): image is string => Boolean(image)) ?? [];
    const imageUrl = this.room().image_url;
    const gallery = images.length ? images : imageUrl ? [imageUrl] : [];
    return gallery.length ? gallery : this.fallbackImages;
  });
  readonly index = input(0);
  readonly reservationSearch = input<AvailabilitySearch | null>(null);
  readonly fallbackImages = [
    '/api/web-images/hotel.png',
  ];

  selectForBooking() {
    this.availability.selectRoom(this.room().id, this.reservationSearch());
  }
}
