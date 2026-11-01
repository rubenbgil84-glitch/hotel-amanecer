import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminBooking, AdminBookingInput, AdminBookingSummary, AdminRoom, ApiService } from '../../api.service';
import { AdminBookingsApiService } from '../../admin-bookings-api.service';

@Component({
  selector: 'app-admin-bookings',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './admin-bookings.component.html',
  styleUrl: './admin-bookings.component.scss',
})
export class AdminBookings {
  private readonly api = inject(ApiService);
  private readonly bookingApi = inject(AdminBookingsApiService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly bookings = signal<AdminBookingSummary[]>([]);
  readonly rooms = signal<AdminRoom[]>([]);
  readonly selectedBooking = signal<AdminBooking | null>(null);
  readonly editingBooking = signal<AdminBookingSummary | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly actionId = signal<number | null>(null);
  readonly error = signal('');
  readonly notice = signal('');

  readonly filters = this.fb.group({
    from_date: [''],
    to_date: [''],
    precheck: ['all'],
    search: [''],
  });

  readonly bookingForm = this.fb.group({
    room_id: [0, [Validators.required, Validators.min(1)]],
    guest_name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    identity_document: ['', Validators.maxLength(50)],
    phone: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(40)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    check_in: ['', Validators.required],
    check_out: ['', Validators.required],
    adults: [1, [Validators.required, Validators.min(1), Validators.max(13)]],
    children: [0, [Validators.required, Validators.min(0), Validators.max(12)]],
    breakfast: [false],
    pets: [false],
    notes: ['', Validators.maxLength(2000)],
  });

  constructor() {
    this.loadRooms();
    this.loadBookings();
  }

  loadBookings(): void {
    this.loading.set(true);
    this.error.set('');
    const values = this.filters.getRawValue();
    this.bookingApi.bookings({
      from_date: values.from_date || undefined,
      to_date: values.to_date || undefined,
      precheck: values.precheck,
      search: values.search.trim() || undefined,
    }).subscribe({
      next: (bookings) => {
        this.bookings.set(bookings);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.showRequestError(error, 'No se pudieron cargar las reservas.');
        this.loading.set(false);
      },
    });
  }

  resetFilters(): void {
    this.filters.reset({ from_date: '', to_date: '', precheck: 'all', search: '' });
    this.loadBookings();
  }

  openDetails(booking: AdminBookingSummary): void {
    this.clearMessages();
    this.bookingApi.booking(booking.id).subscribe({
      next: (details) => this.selectedBooking.set(details),
      error: (error: HttpErrorResponse) => this.showRequestError(error, 'No se pudo cargar el detalle de la reserva.'),
    });
  }

  closeDetails(): void {
    this.selectedBooking.set(null);
  }

  startEdit(booking: AdminBookingSummary): void {
    this.clearMessages();
    if (booking.precheckin_completed_at
      && !window.confirm('Esta reserva tiene el pre-check-in completado. Si continúas, se eliminarán sus datos y las imágenes de los documentos. ¿Quieres continuar?')) {
      return;
    }
    this.selectedBooking.set(null);
    this.editingBooking.set(booking);
    this.bookingForm.reset({
      room_id: booking.room_id,
      guest_name: booking.guest_name,
      identity_document: booking.identity_document,
      phone: booking.phone,
      email: booking.email,
      check_in: booking.check_in.slice(0, 10),
      check_out: booking.check_out.slice(0, 10),
      adults: booking.adults,
      children: booking.children,
      breakfast: booking.breakfast,
      pets: booking.pets,
      notes: booking.notes,
    });
  }

  cancelEdit(): void {
    this.editingBooking.set(null);
    this.bookingForm.reset();
  }

  saveBooking(): void {
    const booking = this.editingBooking();
    if (!booking || this.saving()) return;
    this.clearMessages();
    if (this.bookingForm.invalid) {
      this.bookingForm.markAllAsTouched();
      this.error.set('Revisa los campos obligatorios y las fechas.');
      return;
    }
    const values = this.bookingForm.getRawValue();
    if (values.check_out <= values.check_in) {
      this.error.set('La fecha de salida debe ser posterior a la entrada.');
      return;
    }
    if (values.adults + values.children > 13) {
      this.error.set('La reserva admite hasta 13 huéspedes.');
      return;
    }
    const input: AdminBookingInput = {
      ...values,
      room_id: Number(values.room_id),
      adults: Number(values.adults),
      children: Number(values.children),
      guest_name: values.guest_name.trim(),
      identity_document: values.identity_document.trim(),
      phone: values.phone.trim(),
      email: values.email.trim(),
      notes: values.notes.trim(),
      remove_precheckin: Boolean(booking.precheckin_completed_at),
    };
    this.saving.set(true);
    this.bookingApi.updateBooking(booking.id, input).subscribe({
      next: () => {
        this.saving.set(false);
        this.editingBooking.set(null);
        this.notice.set('Reserva modificada. Se ha enviado el correo actualizado al huésped.');
        this.loadBookings();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.showRequestError(error, 'No se pudo modificar la reserva.');
      },
    });
  }

  resend(booking: AdminBookingSummary): void {
    this.runAction(booking.id, this.bookingApi.resendBooking(booking.id), 'Correo de reserva reenviado.');
  }

  startPrecheckin(booking: AdminBookingSummary): void {
    if (booking.precheckin_completed_at) return;
    this.runAction(booking.id, this.bookingApi.sendPrecheckin(booking.id), 'Se ha enviado al huésped el enlace para completar el pre-check-in.');
  }

  downloadPdf(booking: AdminBookingSummary | AdminBooking): void {
    if (this.actionId() !== null) return;
    this.clearMessages();
    this.actionId.set(booking.id);
    this.bookingApi.bookingPdf(booking.id).subscribe({
      next: (file) => {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = `reserva-${booking.reservation_code}.pdf`;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        this.actionId.set(null);
        this.notice.set('Informe PDF descargado.');
      },
      error: (error: HttpErrorResponse) => {
        this.actionId.set(null);
        this.showRequestError(error, 'No se pudo descargar el informe PDF.');
      },
    });
  }

  deleteBooking(booking: AdminBookingSummary): void {
    const message = booking.precheckin_completed_at
      ? `¿Eliminar la reserva ${booking.reservation_code} y también su pre-check-in y las imágenes de los documentos? Esta acción no se puede deshacer.`
      : `¿Eliminar la reserva ${booking.reservation_code}? Esta acción no se puede deshacer.`;
    if (!window.confirm(message) || this.actionId() !== null) return;
    this.clearMessages();
    this.actionId.set(booking.id);
    this.bookingApi.deleteBooking(booking.id).subscribe({
      next: () => {
        this.actionId.set(null);
        this.notice.set('Reserva eliminada.');
        if (this.selectedBooking()?.id === booking.id) this.closeDetails();
        this.loadBookings();
      },
      error: (error: HttpErrorResponse) => {
        this.actionId.set(null);
        this.showRequestError(error, 'No se pudo eliminar la reserva.');
      },
    });
  }

  documentUrl(booking: AdminBooking, side: 'front' | 'back'): string {
    return `/api/admin/bookings/${booking.id}/documents/${side}`;
  }

  private loadRooms(): void {
    this.api.adminRooms().subscribe({
      next: (rooms) => this.rooms.set(rooms),
      error: (error: HttpErrorResponse) => this.showRequestError(error, 'No se pudieron cargar las habitaciones para editar.'),
    });
  }

  private runAction(bookingId: number, request: ReturnType<AdminBookingsApiService['resendBooking']>, successMessage: string): void {
    if (this.actionId() !== null) return;
    this.clearMessages();
    this.actionId.set(bookingId);
    request.subscribe({
      next: () => {
        this.actionId.set(null);
        this.notice.set(successMessage);
        this.loadBookings();
      },
      error: (error: HttpErrorResponse) => {
        this.actionId.set(null);
        this.showRequestError(error, 'No se pudo completar la acción.');
      },
    });
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
