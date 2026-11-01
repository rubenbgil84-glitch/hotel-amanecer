import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ApiService,
  DiscountCode,
  DiscountDateRange,
  DiscountCodeInput,
  DiscountRecipient,
} from '../../api.service';

@Component({
  selector: 'app-admin-discount-codes',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './admin-discount-codes.component.html',
  styleUrl: './admin-discount-codes.component.scss',
})
export class AdminDiscountCodes {
  private readonly api = inject(ApiService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly codes = signal<DiscountCode[]>([]);
  readonly excludedDates = signal<DiscountDateRange[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly editorOpen = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly sendingCode = signal<DiscountCode | null>(null);
  readonly recipients = signal<DiscountRecipient[]>([]);
  readonly selectedRecipientEmails = signal<string[]>([]);
  readonly loadingRecipients = signal(false);
  readonly sendingEmails = signal(false);
  readonly sendError = signal('');
  readonly sendNotice = signal('');

  readonly form = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(40), Validators.pattern(/^[A-Za-z0-9_-]+$/)]],
    discount_percent: [10, [Validators.required, Validators.min(0.01), Validators.max(100)]],
    minimum_amount: [0, [Validators.required, Validators.min(0), Validators.max(1000000)]],
    starts_on: [''],
    ends_on: [''],
    max_uses: ['', [Validators.pattern(/^\d*$/), Validators.min(1), Validators.max(1000000)]],
    is_active: [true],
  });

  readonly rangeForm = this.fb.group({
    start_date: ['', Validators.required],
    end_date: ['', Validators.required],
  });

  constructor() {
    this.loadCodes();
  }

  loadCodes(): void {
    this.loading.set(true);
    this.api.adminDiscountCodes().subscribe({
      next: (codes) => {
        this.codes.set(codes);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.showError(error, 'No se pudieron cargar los códigos.');
        this.loading.set(false);
      },
    });
  }

  startCreate(): void {
    this.editorOpen.set(true);
    this.editingId.set(null);
    this.form.reset({
      code: '',
      discount_percent: 10,
      minimum_amount: 0,
      starts_on: '',
      ends_on: '',
      max_uses: '',
      is_active: true,
    });
    this.excludedDates.set([]);
    this.rangeForm.reset({ start_date: '', end_date: '' });
    this.clearMessages();
  }

  startEdit(code: DiscountCode): void {
    this.editorOpen.set(true);
    this.editingId.set(code.id);
    this.form.reset({
      code: code.code,
      discount_percent: code.discount_percent,
      minimum_amount: code.minimum_amount,
      starts_on: code.starts_on ?? '',
      ends_on: code.ends_on ?? '',
      max_uses: code.max_uses === null ? '' : String(code.max_uses),
      is_active: code.is_active,
    });
    this.excludedDates.set(code.excluded_dates.map(({ start_date, end_date }) => ({ start_date, end_date })));
    this.rangeForm.reset({ start_date: '', end_date: '' });
    this.clearMessages();
  }

  cancelEditor(): void {
    this.editorOpen.set(false);
    this.editingId.set(null);
    this.clearMessages();
  }

  addExcludedDate(): void {
    if (this.rangeForm.invalid) {
      this.rangeForm.markAllAsTouched();
      this.error.set('Indica las dos fechas del periodo excluido.');
      return;
    }
    const range = this.rangeForm.getRawValue();
    if (range.end_date < range.start_date) {
      this.error.set('La fecha final del periodo debe ser igual o posterior a la inicial.');
      return;
    }
    this.excludedDates.update((dates) => [...dates, range].sort((a, b) => a.start_date.localeCompare(b.start_date)));
    this.rangeForm.reset({ start_date: '', end_date: '' });
    this.error.set('');
  }

  removeExcludedDate(index: number): void {
    this.excludedDates.update((dates) => dates.filter((_, dateIndex) => dateIndex !== index));
  }

  save(): void {
    if (this.saving()) return;
    this.clearMessages();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Revisa los datos obligatorios del código.');
      return;
    }
    const values = this.form.getRawValue();
    const input: DiscountCodeInput = {
      code: values.code.trim().toUpperCase(),
      discount_percent: Number(values.discount_percent),
      minimum_amount: Number(values.minimum_amount),
      starts_on: values.starts_on || null,
      ends_on: values.ends_on || null,
      max_uses: values.max_uses ? Number(values.max_uses) : null,
      is_active: values.is_active,
      excluded_dates: this.excludedDates().map(({ start_date, end_date }) => ({ start_date, end_date })),
    };
    const id = this.editingId();
    this.saving.set(true);
    const saved = () => {
      this.saving.set(false);
      this.editorOpen.set(false);
      this.editingId.set(null);
      this.notice.set(id === null ? 'Código creado.' : 'Código actualizado.');
      this.loadCodes();
    };
    const failed = (error: HttpErrorResponse) => {
      this.saving.set(false);
      this.showError(error, 'No se pudo guardar el código.');
    };
    if (id === null) {
      this.api.createDiscountCode(input).subscribe({
        next: saved,
        error: failed,
      });
    } else {
      this.api.updateDiscountCode(id, input).subscribe({
        next: saved,
        error: failed,
      });
    }
  }

  delete(code: DiscountCode): void {
    if (!window.confirm(`¿Eliminar el código ${code.code}?${code.usage_count ? ' No se borrarán las reservas anteriores.' : ''}`)) return;
    this.clearMessages();
    this.api.deleteDiscountCode(code.id).subscribe({
      next: () => {
        this.notice.set('Código eliminado.');
        this.loadCodes();
      },
      error: (error: HttpErrorResponse) => this.showError(error, 'No se pudo eliminar el código.'),
    });
  }

  openSendDialog(code: DiscountCode): void {
    this.sendingCode.set(code);
    this.recipients.set([]);
    this.selectedRecipientEmails.set([]);
    this.loadingRecipients.set(true);
    this.sendError.set('');
    this.sendNotice.set('');
    this.api.discountCodeRecipients(code.id).subscribe({
      next: (recipients) => {
        this.recipients.set(recipients);
        this.loadingRecipients.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.loadingRecipients.set(false);
        this.sendError.set(error.error?.errors?.[0] ?? 'No se pudieron cargar los huéspedes con consentimiento.');
        console.error('No se pudieron cargar los destinatarios de la promoción.', error);
      },
    });
  }

  closeSendDialog(): void {
    if (this.sendingEmails()) return;
    this.sendingCode.set(null);
    this.recipients.set([]);
    this.selectedRecipientEmails.set([]);
    this.sendError.set('');
    this.sendNotice.set('');
  }

  toggleRecipient(email: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedRecipientEmails.update((selected) => checked
      ? [...new Set([...selected, email])]
      : selected.filter((item) => item !== email));
  }

  selectAllRecipients(): void {
    this.selectedRecipientEmails.set(this.recipients().map((recipient) => recipient.email));
  }

  selectNoRecipients(): void {
    this.selectedRecipientEmails.set([]);
  }

  sendPromotion(): void {
    const code = this.sendingCode();
    const emails = this.selectedRecipientEmails();
    if (!code || this.sendingEmails()) return;
    if (!emails.length) {
      this.sendError.set('Selecciona al menos un huésped.');
      return;
    }
    this.sendError.set('');
    this.sendNotice.set('');
    this.sendingEmails.set(true);
    this.api.sendDiscountCode(code.id, emails).subscribe({
      next: (result) => {
        this.sendingEmails.set(false);
        if (result.failed.length) {
          this.sendNotice.set(`${result.sent.length} correo(s) enviado(s).`);
          this.sendError.set(result.failed.map(({ email, reason }) => `${email}: ${reason}`).join(' '));
          this.recipients.update((recipients) => recipients.filter(({ email }) => result.failed.some((item) => item.email.toLowerCase() === email.toLowerCase())));
          this.selectedRecipientEmails.set(result.failed.map(({ email }) => email));
          return;
        }
        this.notice.set(`Promoción enviada individualmente a ${result.sent.length} huésped(es).`);
        this.closeSendDialog();
      },
      error: (error: HttpErrorResponse) => {
        this.sendingEmails.set(false);
        this.sendError.set(error.error?.errors?.[0] ?? 'No se pudieron enviar los correos promocionales.');
        console.error('No se pudieron enviar los correos promocionales.', error);
      },
    });
  }

  private clearMessages(): void {
    this.error.set('');
    this.notice.set('');
  }

  private showError(error: HttpErrorResponse, fallback: string): void {
    console.error(fallback, error);
    this.error.set(error.error?.errors?.[0] ?? fallback);
  }
}
