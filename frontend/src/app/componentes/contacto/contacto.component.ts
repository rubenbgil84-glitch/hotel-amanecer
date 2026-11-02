import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService } from '../../api.service';
import { SiteContentService } from '../../site-content.service';

@Component({
  selector: 'app-contacto',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './contacto.component.html',
  styleUrl: './contacto.component.scss',
})
export class Contacto {
  private readonly api = inject(ApiService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly sanitizer = inject(DomSanitizer);
  readonly siteContent = inject(SiteContentService);
  readonly phoneHref = computed(
    () => `tel:${this.siteContent.settings().site_phone.replace(/[^\d+]/g, '')}`,
  );
  readonly mobilePhoneHref = computed(
    () => `tel:${this.siteContent.settings().site_mobile_phone.replace(/[^\d+]/g, '')}`,
  );
  readonly emailHref = computed(() => `mailto:${this.siteContent.settings().site_email}`);
  readonly directionsUrl = computed(
    () => this.siteContent.settings().site_map_url,
  );
  readonly mapEmbedUrl = computed(
    () => this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://maps.google.com/maps?q=${encodeURIComponent(this.siteContent.settings().site_address)}&z=15&output=embed`,
    ),
  );

  readonly sending = signal(false);
  readonly sent = signal(false);
  readonly errors = signal<string[]>([]);

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    phone: ['', Validators.maxLength(40)],
    subject: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(120)]],
    message: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(5000)]],
    privacy_accepted: [false, Validators.requiredTrue],
  });

  submit(): void {
    if (this.sending()) return;
    this.errors.set([]);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.sending.set(true);
    this.api.sendContact(this.form.getRawValue()).subscribe({
      next: (result) => {
        this.sending.set(false);
        if (!result.notification_sent) {
          this.errors.set([
            'El mensaje se ha guardado, pero no pudimos enviar el correo de confirmación. Contacta con el hotel por teléfono.',
          ]);
          return;
        }
        this.sent.set(true);
        this.form.reset();
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudo enviar la solicitud de contacto.', error);
        const messages = error.error?.errors;
        this.errors.set(Array.isArray(messages) ? messages : ['No se pudo enviar el mensaje. Inténtalo de nuevo más tarde.']);
        this.sending.set(false);
      },
    });
  }
}
