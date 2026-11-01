import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, type AdminRoom } from '../../api.service';
import type { SiteClosure } from '../../site-settings.model';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss',
})
export class AdminDashboard {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly loggingOut = signal(false);
  readonly error = signal('');
  readonly upcomingClosures = signal<SiteClosure[]>([]);
  readonly rooms = signal<AdminRoom[] | null>(null);
  readonly roomStatsError = signal('');
  readonly activeRoomCount = computed(() => this.rooms()?.filter((room) => room.is_active).length ?? 0);
  readonly inactiveRoomCount = computed(() => this.rooms()?.filter((room) => !room.is_active).length ?? 0);

  constructor() {
    this.api.adminClosures(true).subscribe({
      next: (closures) => this.upcomingClosures.set(closures),
      error: (error: HttpErrorResponse) => {
        console.error('No se pudieron consultar los próximos cierres del hotel.', error);
        this.error.set('No se pudieron consultar los periodos de cierre.');
      },
    });
    this.api.adminRooms().subscribe({
      next: (rooms) => this.rooms.set(rooms),
      error: (error: HttpErrorResponse) => {
        console.error('No se pudieron consultar las habitaciones del panel.', error);
        this.roomStatsError.set('No se pudo consultar el número de habitaciones activas e inactivas.');
      },
    });
  }

  logout(): void {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    this.error.set('');
    this.api.adminLogout().subscribe({
      next: () => void this.router.navigate(['/carmen-admin']),
      error: (error: HttpErrorResponse) => {
        console.error('No se pudo cerrar la sesión de administración.', error);
        this.error.set('No se pudo cerrar la sesión. Inténtalo de nuevo.');
        this.loggingOut.set(false);
      },
    });
  }
}
