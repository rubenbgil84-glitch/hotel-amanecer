import { CurrencyPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
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
  readonly index = input(0);
  readonly reservationSearch = input<AvailabilitySearch | null>(null);
  readonly fallbackImages = [
    '/api/web-images/hotel.png',
  ];

  selectForBooking() {
    this.availability.selectRoom(this.room().id, this.reservationSearch());
  }
}
