import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../api.service';
import { RoomCatalogFilterService } from '../../room-catalog-filter.service';
import { TarjetaHabitacion } from './tarjetas/tarjeta-habitacion.component';

@Component({
  selector: 'app-rooms',
  standalone: true,
  imports: [RouterLink, TarjetaHabitacion],
  templateUrl: './habitaciones.component.html',
  styleUrl: './habitaciones.component.scss',
})
export class Rooms {
  private readonly route = inject(ActivatedRoute);
  private readonly catalogFilter = inject(RoomCatalogFilterService);
  readonly isRuralPage = this.route.snapshot.routeConfig?.path === 'casa-rural';
  readonly selectedCategory = this.catalogFilter.selectedCategory;
  readonly rooms = toSignal(inject(ApiService).rooms().pipe(catchError(() => of(null))));
  readonly hotelRooms = computed(() => {
    if (this.isRuralPage) return [];
    const category = this.selectedCategory();
    return this.rooms()?.filter((room) =>
      room.pricing_type === 'standard' &&
      (!category || room.catalog_category === category),
    ) ?? [];
  });
  readonly ruralHouses = computed(() => this.rooms()?.filter((room) => room.pricing_type === 'rural_house') ?? []);

  clearCategoryFilter(): void {
    this.catalogFilter.clear();
  }
}
