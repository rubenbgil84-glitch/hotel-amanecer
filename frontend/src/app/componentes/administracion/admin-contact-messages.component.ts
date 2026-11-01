import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminContactMessage } from '../../api.service';
import { AdminContactMessagesApiService } from '../../admin-contact-messages-api.service';

@Component({
  selector: 'app-admin-contact-messages',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './admin-contact-messages.component.html',
  styleUrl: './admin-contact-messages.component.scss',
})
export class AdminContactMessages {
  private readonly api = inject(AdminContactMessagesApiService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly messages = signal<AdminContactMessage[]>([]);
  readonly replyingTo = signal<AdminContactMessage | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly actionId = signal<number | null>(null);
  readonly error = signal('');
  readonly notice = signal('');

  readonly filters = this.fb.group({
    from_date: [''],
    to_date: [''],
    status: ['all' as 'all' | 'pending' | 'responded'],
    search: [''],
  });

  readonly replyForm = this.fb.group({
    message: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(5000)]],
  });

  constructor() {
    this.loadMessages();
  }

  loadMessages(): void {
    this.loading.set(true);
    this.error.set('');
    const values = this.filters.getRawValue();
    this.api.messages({
      from_date: values.from_date || undefined,
      to_date: values.to_date || undefined,
      status: values.status,
      search: values.search.trim() || undefined,
    }).subscribe({
      next: (messages) => {
        this.messages.set(messages);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.showRequestError(error, 'No se pudieron cargar los mensajes.');
        this.loading.set(false);
      },
    });
  }

  resetFilters(): void {
    this.filters.reset({ from_date: '', to_date: '', status: 'all', search: '' });
    this.loadMessages();
  }

  openReply(message: AdminContactMessage): void {
    this.clearMessages();
    if (this.replyingTo()?.id === message.id) {
      this.replyingTo.set(null);
      this.replyForm.reset({ message: '' });
      return;
    }
    this.replyingTo.set(message);
    this.replyForm.reset({ message: '' });
  }

  closeReply(): void {
    this.replyingTo.set(null);
    this.replyForm.reset({ message: '' });
  }

  sendReply(): void {
    const contact = this.replyingTo();
    if (!contact || this.saving()) return;
    this.clearMessages();
    const text = this.replyForm.controls.message.value.trim();
    if (text.length < 2 || text.length > 5000 || this.replyForm.invalid) {
      this.replyForm.markAllAsTouched();
      this.error.set('Escribe una respuesta de entre 2 y 5000 caracteres.');
      return;
    }

    this.saving.set(true);
    this.api.reply(contact.id, text).subscribe({
      next: () => {
        this.saving.set(false);
        this.closeReply();
        this.notice.set(`Respuesta enviada a ${contact.email} y guardada en la conversación.`);
        this.loadMessages();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.showRequestError(error, 'No se pudo enviar la respuesta; la conversación original sigue guardada.');
      },
    });
  }

  deleteMessage(message: AdminContactMessage): void {
    if (!window.confirm(`¿Eliminar el mensaje de ${message.name} sobre «${message.subject}»? Esta acción no se puede deshacer.`)) return;
    if (this.actionId() !== null) return;
    this.clearMessages();
    this.actionId.set(message.id);
    this.api.delete(message.id).subscribe({
      next: () => {
        this.actionId.set(null);
        if (this.replyingTo()?.id === message.id) this.closeReply();
        this.notice.set('Mensaje eliminado.');
        this.loadMessages();
      },
      error: (error: HttpErrorResponse) => {
        this.actionId.set(null);
        this.showRequestError(error, 'No se pudo eliminar el mensaje.');
      },
    });
  }

  preview(message: AdminContactMessage): string {
    return message.message.at(-1)?.body ?? '';
  }

  private showRequestError(error: HttpErrorResponse, fallback: string): void {
    console.error(fallback, error);
    const messages = error.error?.errors;
    this.error.set(Array.isArray(messages) && messages.length ? messages.join(' ') : fallback);
  }

  private clearMessages(): void {
    this.error.set('');
    this.notice.set('');
  }
}
