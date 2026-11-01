import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { ApiService } from '../../api.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './admin-login.component.html',
  styleUrl: './admin-login.component.scss',
})
export class AdminLogin {
  private readonly api = inject(ApiService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private countdownSubscription?: Subscription;

  readonly submitting = signal(false);
  readonly error = signal('');
  readonly countdown = signal<number | null>(null);

  readonly form = this.fb.group({
    username: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.required, Validators.maxLength(200)]],
  });

  constructor() {
    this.api.adminSession().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ authenticated }) => {
        if (authenticated) void this.router.navigate(['/carmen-admin/dashboard']);
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudo comprobar la sesión de administración.', error);
      },
    });
  }

  submit(): void {
    if (this.submitting()) return;
    this.error.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.api.adminLogin(this.form.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.countdownSubscription?.unsubscribe();
          this.countdown.set(null);
          void this.router.navigate(['/carmen-admin/dashboard']);
        },
        error: (error: HttpErrorResponse) => {
          this.submitting.set(false);
          this.error.set(error.error?.errors?.[0] ?? 'No se pudo iniciar sesión. Inténtalo de nuevo.');
          this.startCountdown();
        },
      });
  }

  private startCountdown(): void {
    this.countdownSubscription?.unsubscribe();
    this.countdown.set(10);
    this.countdownSubscription = timer(1000, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((elapsed) => {
        const remaining = 9 - elapsed;
        this.countdown.set(Math.max(remaining, 0));
        if (remaining <= 0) {
          this.countdownSubscription?.unsubscribe();
          void this.router.navigate(['/']);
        }
      });
  }
}
