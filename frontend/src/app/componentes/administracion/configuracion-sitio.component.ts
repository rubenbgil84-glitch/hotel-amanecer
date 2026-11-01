import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../api.service';
import { hotelDateKey } from '../../date-only';
import type { VatRate } from '../../api.service';
import { SiteContentService } from '../../site-content.service';
import {
  SITE_SETTING_DEFAULTS,
  parseAboutServices,
  parseConfiguredSocialLinks,
  type AboutService,
  type AdminTestimonial,
  type SocialLink,
  type SiteClosure,
  type SiteClosureInput,
  type SiteSettingKey,
  type SiteSettings,
} from '../../site-settings.model';

interface SettingField {
  key: SiteSettingKey;
  label: string;
  type: 'text' | 'textarea' | 'url' | 'email' | 'tel' | 'time' | 'number' | 'select' | 'image';
}

interface SettingGroup {
  title: string;
  fields: SettingField[];
}

const field = (key: SiteSettingKey, label: string, type: SettingField['type'] = 'text'): SettingField => ({
  key,
  label,
  type,
});

@Component({
  selector: 'app-configuracion-sitio',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './configuracion-sitio.component.html',
  styleUrl: './configuracion-sitio.component.scss',
})
export class ConfiguracionSitio {
  private readonly api = inject(ApiService);
  private readonly siteContent = inject(SiteContentService);
  private socialIdCounter = 0;

  readonly groups: SettingGroup[] = [
    {
      title: 'Datos del hotel',
      fields: [
        field('site_name', 'Nombre del sitio'),
        field('site_phone', 'Teléfono', 'tel'),
        field('site_mobile_phone', 'Segundo teléfono / móvil', 'tel'),
        field('site_email', 'Email de contacto', 'email'),
        field('site_address', 'Dirección', 'textarea'),
        field('site_map_url', 'Enlace de indicaciones', 'url'),
        field('hotel_stars', 'Número de estrellas (0 para ocultar)', 'number'),
        field('reception_24h', 'Recepción 24 horas', 'select'),
        field('reception_opening_time', 'Horario de apertura', 'time'),
        field('reception_closing_time', 'Horario de cierre', 'time'),
        field('brand_tagline', 'Eslogan junto al nombre'),
        field('footer_tagline', 'Eslogan del pie de página', 'textarea'),
      ],
    },
    {
      title: 'Precios de suplementos',
      fields: [
        field('breakfast_price', 'Precio del desayuno por persona y noche (€)', 'number'),
        field('pets_price', 'Suplemento de mascotas por estancia (€)', 'number'),
      ],
    },
    {
      title: 'Portada',
      fields: [
        field('hero_image_path', 'Imagen cinematográfica de portada', 'image'),
        field('hero_eyebrow', 'Frase destacada'),
        field('hero_title', 'Título', 'textarea'),
        field('hero_description', 'Descripción', 'textarea'),
        field('hero_link_label', 'Texto del enlace'),
        field('promise_1', 'Detalle destacado 1'),
        field('promise_2', 'Detalle destacado 2'),
        field('promise_3', 'Detalle destacado 3'),
      ],
    },
    {
      title: 'Sección de bienvenida',
      fields: [
        field('intro_image_path', 'Imagen de bienvenida', 'image'),
        field('intro_image_alt', 'Descripción accesible de la imagen', 'textarea'),
        field('intro_note_top', 'Texto sobre la imagen · línea 1'),
        field('intro_note_bottom', 'Texto sobre la imagen · línea 2'),
        field('intro_eyebrow', 'Frase destacada'),
        field('intro_title', 'Título', 'textarea'),
        field('intro_description', 'Descripción', 'textarea'),
        field('intro_link_label', 'Texto del enlace'),
      ],
    },
    {
      title: 'Sección de experiencia',
      fields: [
        field('experience_image_path', 'Imagen de experiencia', 'image'),
        field('experience_image_alt', 'Descripción accesible de la imagen', 'textarea'),
        field('experience_eyebrow', 'Frase destacada'),
        field('experience_title', 'Título', 'textarea'),
        field('experience_description', 'Descripción', 'textarea'),
        field('experience_point_1', 'Detalle 1'),
        field('experience_point_2', 'Detalle 2'),
        field('experience_point_3', 'Detalle 3'),
        field('experience_link_label', 'Texto del enlace'),
      ],
    },
    {
      title: 'Opiniones y cierre',
      fields: [
        field('testimonials_eyebrow', 'Frase destacada de opiniones'),
        field('testimonials_title', 'Título de opiniones', 'textarea'),
        field('last_call_eyebrow', 'Frase de cierre'),
        field('last_call_title', 'Título de cierre', 'textarea'),
      ],
    },
    {
      title: 'Página Conócenos',
      fields: [
        field('about_hero_eyebrow', 'Frase destacada de portada'),
        field('about_hero_title', 'Mensaje principal', 'textarea'),
        field('about_hero_description', 'Descripción de portada', 'textarea'),
        field('about_welcome_eyebrow', 'Frase destacada de bienvenida'),
        field('about_welcome_title', 'Título de bienvenida', 'textarea'),
        field('about_welcome_description', 'Mensaje de bienvenida', 'textarea'),
        field('about_services_eyebrow', 'Frase destacada de servicios'),
        field('about_services_title', 'Título de servicios', 'textarea'),
        field('about_services_description', 'Introducción de servicios', 'textarea'),
        field('about_services_note', 'Nota sobre servicios', 'textarea'),
      ],
    },
    {
      title: 'Políticas del sitio',
      fields: [
        field('privacy_policy_title', 'Título de la política de privacidad'),
        field('privacy_policy_content', 'Contenido de la política de privacidad', 'textarea'),
        field('legal_notice_title', 'Título del aviso legal'),
        field('legal_notice_content', 'Contenido del aviso legal', 'textarea'),
        field('cookies_policy_title', 'Título de la política de cookies'),
        field('cookies_policy_content', 'Contenido de la política de cookies', 'textarea'),
      ],
    },
  ];

  draft: SiteSettings = { ...SITE_SETTING_DEFAULTS };
  services: AboutService[] = [];
  socialLinks: SocialLink[] = [];
  imageUploads: Partial<Record<'hero_image_data_url' | 'intro_image_data_url' | 'experience_image_data_url', string>> = {};
  closureDraft: SiteClosureInput = { start_date: '', end_date: '', reason: '' };
  editingClosure: SiteClosure | null = null;
  readonly closures = signal<SiteClosure[]>([]);
  readonly vatRates = signal<VatRate[]>([]);
  readonly pendingImageReads = signal(0);
  readonly testimonials = signal<AdminTestimonial[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly today = hotelDateKey();
  readonly moderatingId = signal<number | null>(null);
  readonly error = signal('');
  readonly notice = signal('');
  vatRateDraft = { effective_from: '', rate: 10 };
  readonly savingVatRate = signal(false);

  constructor() {
    this.api.adminSiteSettings().subscribe({
      next: (settings) => {
        this.draft = settings;
        this.services = parseAboutServices(settings.about_services);
        this.socialLinks = parseConfiguredSocialLinks(settings.social_links);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudo cargar la configuración del sitio.', error);
        this.error.set('No se pudo cargar la configuración del sitio.');
        this.loading.set(false);
      },
    });
    this.loadTestimonials();
    this.loadClosures();
    this.loadVatRates();
  }

  save(): void {
    if (this.saving()) return;
    if (this.pendingImageReads() > 0) {
      this.error.set('Espera a que termine la lectura de las imágenes antes de guardar.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    const settings = {
      ...this.draft,
      about_services: JSON.stringify(this.services),
      social_links: JSON.stringify(this.socialLinks),
    };
    this.api.saveSiteSettings(settings, this.imageUploads).subscribe({
      next: (settings) => {
        this.draft = settings;
        this.services = parseAboutServices(settings.about_services);
        this.socialLinks = parseConfiguredSocialLinks(settings.social_links);
        this.imageUploads = {};
        this.siteContent.update(settings);
        this.saving.set(false);
        this.notice.set('La configuración se ha guardado.');
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudo guardar la configuración del sitio.', error);
        this.error.set(error.error?.errors?.[0] ?? 'No se pudo guardar la configuración.');
        this.saving.set(false);
      },
    });
  }

  addService(): void {
    this.services = [...this.services, { title: '', description: '' }];
  }

  removeService(index: number): void {
    this.services = this.services.filter((_, itemIndex) => itemIndex !== index);
  }

  addSocialLink(): void {
    this.socialLinks = [
      ...this.socialLinks,
      { id: `social-${Date.now()}-${++this.socialIdCounter}`, name: '', url: '', enabled: false },
    ];
  }

  removeSocialLink(index: number): void {
    this.socialLinks = this.socialLinks.filter((_, itemIndex) => itemIndex !== index);
  }

  normalizeNumericSetting(key: SiteSettingKey, value: string | number): void {
    if (['hotel_stars', 'breakfast_price', 'pets_price'].includes(key)) {
      this.draft[key] = String(value);
    }
  }

  onImageSelected(event: Event, fieldKey: SiteSettingKey): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    if (!file) return;
    const dataKey = ({
      hero_image_path: 'hero_image_data_url',
      intro_image_path: 'intro_image_data_url',
      experience_image_path: 'experience_image_data_url',
    } as const)[fieldKey as 'hero_image_path' | 'intro_image_path' | 'experience_image_path'];
    if (!dataKey) return;
    this.error.set('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      input.value = '';
      this.error.set('Elige una imagen JPG, PNG o WebP de hasta 5 MB.');
      return;
    }
    const reader = new FileReader();
    this.pendingImageReads.update((count) => count + 1);
    reader.onload = () => {
      this.pendingImageReads.update((count) => Math.max(0, count - 1));
      if (typeof reader.result !== 'string') {
        this.error.set('No se pudo leer el archivo de imagen.');
        return;
      }
      this.imageUploads = { ...this.imageUploads, [dataKey]: reader.result };
    };
    reader.onerror = () => {
      this.pendingImageReads.update((count) => Math.max(0, count - 1));
      console.error('No se pudo leer la imagen seleccionada.', reader.error);
      this.error.set('No se pudo leer el archivo de imagen.');
    };
    reader.readAsDataURL(file);
  }

  loadVatRates(): void {
    this.api.adminVatRates().subscribe({
      next: (rates) => this.vatRates.set(rates.map((rate) => ({
        ...rate,
        effective_from: rate.effective_from.slice(0, 10),
      }))),
      error: (error: HttpErrorResponse) => {
        console.error('No se pudieron cargar los tipos de IVA.', error);
        this.error.set('No se pudieron cargar los tipos de IVA.');
      },
    });
  }

  addVatRate(): void {
    if (!this.vatRateDraft.effective_from || !Number.isFinite(this.vatRateDraft.rate)
      || this.vatRateDraft.rate < 0 || this.vatRateDraft.rate > 100) {
      this.error.set('Indica una fecha y un porcentaje de IVA entre 0 y 100.');
      return;
    }
    this.savingVatRate.set(true);
    this.error.set('');
    this.api.createVatRate(this.vatRateDraft).subscribe({
      next: () => {
        this.savingVatRate.set(false);
        this.vatRateDraft = { effective_from: '', rate: this.vatRateDraft.rate };
        this.notice.set('El tipo de IVA se ha guardado.');
        this.loadVatRates();
      },
      error: (error: HttpErrorResponse) => {
        this.savingVatRate.set(false);
        this.error.set(error.error?.errors?.[0] ?? 'No se pudo guardar el tipo de IVA.');
      },
    });
  }

  updateVatRate(rate: VatRate): void {
    if (!Number.isFinite(Number(rate.rate)) || Number(rate.rate) < 0 || Number(rate.rate) > 100 || !rate.effective_from) {
      this.error.set('Revisa la fecha y el porcentaje del tipo de IVA.');
      return;
    }
    this.savingVatRate.set(true);
    this.error.set('');
    this.api.updateVatRate(rate.id, { effective_from: rate.effective_from.slice(0, 10), rate: Number(rate.rate) }).subscribe({
      next: (updated) => {
        this.vatRates.update((rates) => rates.map((item) => item.id === updated.id ? updated : item));
        this.savingVatRate.set(false);
        this.notice.set('El tipo de IVA se ha actualizado.');
      },
      error: (error: HttpErrorResponse) => {
        this.savingVatRate.set(false);
        this.error.set(error.error?.errors?.[0] ?? 'No se pudo actualizar el tipo de IVA.');
      },
    });
  }

  deleteVatRate(rate: VatRate): void {
    if (!window.confirm(`¿Eliminar el IVA del ${rate.rate}% vigente desde ${rate.effective_from.slice(0, 10)}?`)) return;
    this.savingVatRate.set(true);
    this.error.set('');
    this.api.deleteVatRate(rate.id).subscribe({
      next: () => {
        this.vatRates.update((rates) => rates.filter((item) => item.id !== rate.id));
        this.savingVatRate.set(false);
        this.notice.set('El tipo de IVA se ha eliminado.');
      },
      error: (error: HttpErrorResponse) => {
        this.savingVatRate.set(false);
        this.error.set(error.error?.errors?.[0] ?? 'No se pudo eliminar el tipo de IVA.');
      },
    });
  }

  imagePreview(fieldKey: SiteSettingKey): string {
    const dataKey = ({
      hero_image_path: 'hero_image_data_url',
      intro_image_path: 'intro_image_data_url',
      experience_image_path: 'experience_image_data_url',
    } as const)[fieldKey as 'hero_image_path' | 'intro_image_path' | 'experience_image_path'];
    return this.imageUploads[dataKey] ?? this.draft[fieldKey];
  }

  saveClosure(): void {
    if (!this.closureDraft.start_date || !this.closureDraft.end_date) {
      this.error.set('Indica las fechas de inicio y fin del cierre.');
      return;
    }
    if (this.closureDraft.end_date < this.closureDraft.start_date) {
      this.error.set('La fecha de fin debe ser igual o posterior al inicio.');
      return;
    }
    this.error.set('');
    this.notice.set('');
    const request = this.editingClosure
      ? this.api.updateClosure(this.editingClosure.id, this.closureDraft)
      : this.api.createClosure(this.closureDraft);
    request.subscribe({
      next: () => {
        this.notice.set(this.editingClosure ? 'Periodo de cierre actualizado.' : 'Periodo de cierre añadido.');
        this.cancelClosureEdit();
        this.loadClosures();
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudo guardar el periodo de cierre.', error);
        this.error.set(error.error?.errors?.[0] ?? 'No se pudo guardar el periodo de cierre.');
      },
    });
  }

  editClosure(closure: SiteClosure): void {
    this.editingClosure = closure;
    this.closureDraft = {
      start_date: closure.start_date.slice(0, 10),
      end_date: closure.end_date.slice(0, 10),
      reason: closure.reason,
    };
  }

  cancelClosureEdit(): void {
    this.editingClosure = null;
    this.closureDraft = { start_date: '', end_date: '', reason: '' };
  }

  removeClosure(closure: SiteClosure): void {
    if (!window.confirm(`¿Eliminar el cierre del ${closure.start_date} al ${closure.end_date}?`)) return;
    this.error.set('');
    this.api.deleteClosure(closure.id).subscribe({
      next: () => {
        this.notice.set('Periodo de cierre eliminado.');
        this.loadClosures();
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudo eliminar el periodo de cierre.', error);
        this.error.set(error.error?.errors?.[0] ?? 'No se pudo eliminar el periodo de cierre.');
      },
    });
  }

  private loadClosures(): void {
    this.api.adminClosures().subscribe({
      next: (closures) => this.closures.set(closures),
      error: (error: HttpErrorResponse) => {
        console.error('No se pudieron cargar los periodos de cierre.', error);
        this.error.set('No se pudieron cargar los periodos de cierre.');
      },
    });
  }

  moderate(testimonial: AdminTestimonial, approved: boolean): void {
    if (this.moderatingId()) return;
    this.moderatingId.set(testimonial.id);
    this.error.set('');
    this.notice.set('');
    this.api.moderateTestimonial(testimonial.id, approved).subscribe({
      next: () => {
        this.moderatingId.set(null);
        this.notice.set(approved ? 'La opinión ya está publicada.' : 'La opinión no se publicará.');
        this.loadTestimonials();
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudo actualizar la publicación de la opinión.', error);
        this.error.set(error.error?.errors?.[0] ?? 'No se pudo actualizar la opinión.');
        this.moderatingId.set(null);
      },
    });
  }

  categoryLabel(testimonial: AdminTestimonial): string {
    if (testimonial.travel_type === 'other') return testimonial.travel_type_other ?? 'Otro';
    return ({
      work: 'Viaje de trabajo',
      family: 'Escapada familiar',
      couple: 'Viaje en pareja',
      friends: 'Viaje con amigos',
      solo: 'Viaje en solitario',
    } as Record<string, string>)[testimonial.travel_type] ?? testimonial.travel_type;
  }

  private loadTestimonials(): void {
    this.api.adminTestimonials().subscribe({
      next: (testimonials) => this.testimonials.set(testimonials),
      error: (error: HttpErrorResponse) => {
        console.error('No se pudieron cargar las opiniones para moderar.', error);
        this.error.set('No se pudieron cargar las opiniones para moderar.');
      },
    });
  }
}
