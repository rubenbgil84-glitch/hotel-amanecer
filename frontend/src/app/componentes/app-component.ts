import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService, type Room } from '../api.service';
import { SiteContentService } from '../site-content.service';
import { RoomCatalogFilterService } from '../room-catalog-filter.service';
import { parseSocialLinks } from '../site-settings.model';

const cookiePreferenceKey = 'hotel-cookie-preference-v1';
const cookiePreferenceLifetimeMs = 180 * 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app-component.html',
  styleUrl: './app-component.scss',
})
export class App {
  readonly siteContent = inject(SiteContentService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly roomCatalogFilter = inject(RoomCatalogFilterService);
  readonly year = new Date().getFullYear();
  readonly menuOpen = signal(false);
  private readonly activeRooms = signal<Room[]>([]);
  readonly roomTypes = computed(() => {
    const categories = new Map<string, number>();
    for (const room of this.activeRooms()) {
      if (room.pricing_type !== 'standard') continue;
      const name = room.catalog_category.trim();
      categories.set(name, (categories.get(name) ?? 0) + 1);
    }
    return [...categories].map(([name, count]) => ({ name, count }));
  });
  readonly hasActiveRuralHouse = computed(() =>
    this.activeRooms().some((room) => room.pricing_type === 'rural_house'),
  );
  readonly showCookieBanner = signal(false);
  readonly cookiePreferenceError = signal('');
  readonly socialLinks = computed(() => parseSocialLinks(this.siteContent.settings().social_links));
  readonly hotelStars = computed(() =>
    Array.from({ length: Math.min(5, Math.max(0, Number(this.siteContent.settings().hotel_stars) || 0)) }, (_, index) => index + 1),
  );
  readonly phoneHref = computed(
    () => `tel:${this.siteContent.settings().site_phone.replace(/[^\d+]/g, '')}`,
  );
  readonly mobilePhoneHref = computed(
    () => `tel:${this.siteContent.settings().site_mobile_phone.replace(/[^\d+]/g, '')}`,
  );
  readonly emailHref = computed(() => `mailto:${this.siteContent.settings().site_email}`);
  readonly receptionSchedule = computed(() => {
    const settings = this.siteContent.settings();
    return settings.reception_24h === 'true'
      ? 'Recepción abierta las 24 horas.'
      : `Recepción: de ${settings.reception_opening_time} a ${settings.reception_closing_time}.`;
  });

  constructor() {
    this.siteContent.load();
    this.loadRoomTypes();
    this.loadCookiePreference();
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      const url = event.urlAfterRedirects.split(/[?#]/, 1)[0];
      if (url !== '/habitaciones' && !url.startsWith('/habitaciones/')) {
        this.roomCatalogFilter.clear();
      }
    });
  }

  toggleMenu() {
    this.menuOpen.update((open) => !open);
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  selectRoomCategory(category: string): void {
    this.roomCatalogFilter.select(category);
  }

  showAllRooms(): void {
    this.roomCatalogFilter.clear();
  }

  socialBadge(id: string): string {
    if (id === 'instagram') return '◎';
    if (id === 'facebook') return 'f';
    if (id === 'x' || id === 'twitter') return 'X';
    return '↗';
  }

  chooseCookiePreference(choice: 'accepted' | 'rejected'): void {
    const preference = {
      choice,
      expiresAt: Date.now() + cookiePreferenceLifetimeMs,
    };
    try {
      window.localStorage.setItem(cookiePreferenceKey, JSON.stringify(preference));
      this.cookiePreferenceError.set('');
      this.showCookieBanner.set(false);
    } catch (error) {
      console.error('No se pudo guardar la preferencia de cookies.', error);
      this.cookiePreferenceError.set('No se pudo guardar la elección en este navegador. Puedes continuar sin guardarla; el aviso volverá a aparecer en otra visita.');
    }
  }

  continueWithoutSavingCookiePreference(): void {
    this.showCookieBanner.set(false);
    this.cookiePreferenceError.set('');
  }

  reopenCookiePreferences(): void {
    this.showCookieBanner.set(true);
  }

  private loadRoomTypes(): void {
    this.api.rooms().subscribe({
      next: (rooms) => this.activeRooms.set(rooms),
      error: (error: unknown) => console.error('No se pudieron cargar los tipos de habitación del pie de página.', error),
    });
  }

  private loadCookiePreference(): void {
    try {
      const saved = window.localStorage.getItem(cookiePreferenceKey);
      if (!saved) {
        this.showCookieBanner.set(true);
        return;
      }
      const preference: unknown = JSON.parse(saved);
      if (
        typeof preference !== 'object' ||
        preference === null ||
        !('expiresAt' in preference) ||
        typeof preference.expiresAt !== 'number' ||
        preference.expiresAt <= Date.now() ||
        !('choice' in preference) ||
        !['accepted', 'rejected'].includes(String(preference.choice))
      ) {
        window.localStorage.removeItem(cookiePreferenceKey);
        this.showCookieBanner.set(true);
        return;
      }
      this.showCookieBanner.set(false);
    } catch (error) {
      console.error('No se pudo leer la preferencia de cookies.', error);
      this.cookiePreferenceError.set('No se pudo leer la elección guardada. Puedes elegir de nuevo; si el navegador no permite guardarla, el aviso puede volver a aparecer.');
      this.showCookieBanner.set(true);
    }
  }
}
