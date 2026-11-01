import { Component, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { AvailabilitySearchService } from '../../availability-search.service';
import { ApiService, AvailabilitySearch, Room } from '../../api.service';
import { TarjetaHabitacion } from '../habitaciones/tarjetas/tarjeta-habitacion.component';

type AvailabilityState =
  | { status: 'invalid' }
  | { status: 'loading'; search: AvailabilitySearch }
  | { status: 'loaded'; search: AvailabilitySearch; rooms: Room[] }
  | { status: 'error'; search: AvailabilitySearch };

@Component({
  selector: 'app-reservas',
  standalone: true,
  imports: [RouterLink, TarjetaHabitacion],
  templateUrl: './reservas.component.html',
  styleUrl: './reservas.component.scss',
})
export class Reservas {
  private readonly api = inject(ApiService);
  private readonly availability = inject(AvailabilitySearchService);

  readonly state = toSignal(
    toObservable(this.availability.search).pipe(
      switchMap((search) => {
        if (!search) return of({ status: 'invalid' } as const);

        const cachedRooms = this.availability.rooms();
        if (cachedRooms) {
          return of({ status: 'loaded', search, rooms: cachedRooms } as const);
        }

        return this.api.availableRooms(search).pipe(
          map((rooms) => ({ status: 'loaded', search, rooms }) as const),
          startWith({ status: 'loading', search } as const),
          catchError(() => of({ status: 'error', search } as const)),
        );
      }),
    ),
    {
      initialValue: this.availability.search()
        ? { status: 'loading', search: this.availability.search()! } as const
        : { status: 'invalid' } as const,
    },
  );
}
