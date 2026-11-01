import { Component, computed, input, signal } from '@angular/core';

@Component({
  selector: 'app-room-gallery',
  standalone: true,
  templateUrl: './room-gallery.component.html',
  styleUrl: './room-gallery.component.scss',
})
export class RoomGallery {
  readonly imageUrls = input<string[]>([]);
  readonly fallbackImage = input('/api/web-images/hotel.png');
  readonly alt = input('Habitación');
  readonly loading = input<'eager' | 'lazy'>('lazy');
  readonly variant = input<'card' | 'summary' | 'detail'>('card');
  readonly activeIndex = signal(0);
  readonly images = computed(() => {
    const images = [...new Set(this.imageUrls().filter((image) => typeof image === 'string' && image.length > 0))];
    return images.length ? images : [this.fallbackImage()];
  });
  readonly currentImage = computed(() => this.images()[this.activeIndex() % this.images().length]);

  selectImage(index: number): void {
    this.activeIndex.set(index);
  }

  showNextImage(): void {
    this.activeIndex.update((index) => (index + 1) % this.images().length);
  }

  showPreviousImage(): void {
    this.activeIndex.update((index) => (index - 1 + this.images().length) % this.images().length);
  }
}
