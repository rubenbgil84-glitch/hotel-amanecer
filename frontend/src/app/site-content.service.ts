import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { SITE_SETTING_DEFAULTS, type SiteSettings } from './site-settings.model';

@Injectable({ providedIn: 'root' })
export class SiteContentService {
  private readonly api = inject(ApiService);
  readonly settings = signal<SiteSettings>({ ...SITE_SETTING_DEFAULTS });

  load(): void {
    this.api.siteSettings().subscribe({
      next: (settings) => this.settings.set(settings),
      error: (error: unknown) => {
        console.error('No se pudo cargar la configuración pública del sitio.', error);
      },
    });
  }

  update(settings: SiteSettings): void {
    this.settings.set(settings);
  }
}
