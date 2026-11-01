import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class RoomCatalogFilterService {
  readonly selectedCategory = signal<string | null>(null);

  select(category: string): void {
    this.selectedCategory.set(category);
  }

  clear(): void {
    this.selectedCategory.set(null);
  }
}
