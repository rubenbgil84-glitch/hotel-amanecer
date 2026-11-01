import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../api.service';
import { SiteContentService } from '../../site-content.service';
import type { TestimonialInvitation } from '../../site-settings.model';

@Component({
  selector: 'app-testimonial-form',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './testimonial-form.component.html',
  styleUrl: './testimonial-form.component.scss',
})
export class TestimonialForm {
  private readonly api = inject(ApiService);
  readonly siteContent = inject(SiteContentService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly invitation = signal<TestimonialInvitation | null>(null);
  readonly status = signal<'loading' | 'ready' | 'invalid' | 'submitted'>('loading');
  readonly loadingError = signal('');
  readonly submitting = signal(false);
  readonly submitError = signal('');
  readonly token = signal('');
  readonly rating = signal(0);
  readonly categories = [
    { value: 'work', label: 'Viaje de trabajo' },
    { value: 'family', label: 'Escapada familiar' },
    { value: 'couple', label: 'Viaje en pareja' },
    { value: 'friends', label: 'Viaje con amigos' },
    { value: 'solo', label: 'Viaje en solitario' },
    { value: 'other', label: 'Otros' },
  ];
  draft = {
    display_name: '',
    message: '',
    travel_type: '',
    travel_type_other: '',
    publication_consent: false,
  };

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const token = params.get('token') ?? '';
      this.token.set(token);
      if (!/^[\w-]{43}$/.test(token)) {
        this.status.set('invalid');
        this.loadingError.set('El enlace no es válido o ya se ha utilizado.');
        return;
      }
      this.api.testimonialInvitation(token)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (invitation) => {
            this.invitation.set(invitation);
            this.status.set('ready');
          },
          error: (error: HttpErrorResponse) => {
            console.error('No se pudo validar el enlace de opinión.', error);
            this.loadingError.set(error.error?.errors?.[0] ?? 'El enlace no es válido o ya se ha utilizado.');
            this.status.set('invalid');
          },
        });
    });
  }

  submit(): void {
    if (this.submitting() || !this.invitation()) return;
    this.submitError.set('');
    if (this.rating() < 1 || this.rating() > 5) {
      this.submitError.set('Selecciona una valoración de entre 1 y 5 estrellas.');
      return;
    }
    if (this.draft.message.trim().length < 20) {
      this.submitError.set('Cuéntanos un poco más: tu opinión debe tener al menos 20 caracteres.');
      return;
    }
    this.submitting.set(true);
    this.api.submitTestimonial(this.token(), {
      ...this.draft,
      display_name: this.draft.display_name.trim(),
      message: this.draft.message.trim(),
      travel_type_other: this.draft.travel_type_other.trim(),
      publication_consent: this.draft.publication_consent,
      rating: this.rating(),
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.status.set('submitted');
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudo enviar la opinión.', error);
        this.submitError.set(error.error?.errors?.[0] ?? 'No se pudo enviar la opinión. Inténtalo de nuevo.');
        this.submitting.set(false);
      },
    });
  }
}
