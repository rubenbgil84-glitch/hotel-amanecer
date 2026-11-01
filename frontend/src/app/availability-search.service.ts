import { Injectable, signal } from '@angular/core';
import { AvailabilitySearch, Room } from './api.service';

interface StoredAvailability {
  search: AvailabilitySearch | null;
  roomId: number | null;
  rooms?: Room[] | null;
}

const STORAGE_KEY = 'hotel-amanecer:availability';

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isAvailabilitySearch(value: unknown): value is AvailabilitySearch {
  if (typeof value !== 'object' || value === null) return false;
  const search = value as Partial<AvailabilitySearch>;
  const validDate = (date: unknown): date is string => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  const today = localDateKey(new Date());

  return validDate(search.check_in)
    && validDate(search.check_out)
    && search.check_in >= today
    && search.check_out > search.check_in
    && Number.isInteger(search.adults)
    && (search.adults ?? 0) >= 1
    && (search.adults ?? 7) <= 6
    && Number.isInteger(search.children)
    && (search.children ?? -1) >= 0
    && (search.children ?? 5) <= 4;
}

@Injectable({ providedIn: 'root' })
export class AvailabilitySearchService {
  readonly search = signal<AvailabilitySearch | null>(null);
  readonly roomId = signal<number | null>(null);
  readonly rooms = signal<Room[] | null>(null);

  constructor() {
    let stored: string | null;
    try {
      stored = sessionStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.error('No se pudo acceder al almacenamiento de sesión.', error);
      return;
    }

    if (!stored) return;

    try {
      const state: unknown = JSON.parse(stored);
      if (typeof state === 'object' && state !== null && 'search' in state) {
        const availability = state as Partial<StoredAvailability>;
        if (availability.search === null || isAvailabilitySearch(availability.search)) {
          this.search.set(availability.search);
          this.rooms.set(Array.isArray(availability.rooms) ? availability.rooms : null);
          if (Number.isInteger(availability.roomId) && (availability.roomId ?? 0) > 0) {
            this.roomId.set(availability.roomId!);
          }
          return;
        }
      }

      this.clear();
    } catch (error) {
      console.error('No se pudo leer la búsqueda de disponibilidad guardada.', error);
      this.clear();
    }
  }

  saveSearch(search: AvailabilitySearch, rooms: Room[]) {
    this.search.set(search);
    this.roomId.set(null);
    this.rooms.set(rooms);
    this.persist();
  }

  selectRoom(
    roomId: number,
    search: AvailabilitySearch | null = this.search(),
    rooms: Room[] | null = this.rooms(),
  ) {
    if (!Number.isInteger(roomId) || roomId < 1) {
      throw new Error('El identificador de habitación no es válido.');
    }

    this.search.set(search);
    this.roomId.set(roomId);
    this.rooms.set(rooms);
    this.persist();
  }

  clear() {
    this.search.set(null);
    this.roomId.set(null);
    this.rooms.set(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('No se pudo borrar la búsqueda guardada.', error);
    }
  }

  private persist() {
    const state: StoredAvailability = {
      search: this.search(),
      roomId: this.roomId(),
      rooms: this.rooms(),
    };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('No se pudo guardar la búsqueda en la sesión; continuará en memoria.', error);
    }
  }
}
