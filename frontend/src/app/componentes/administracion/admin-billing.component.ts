import { CommonModule, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { merge } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AdminBillingApiService } from '../../admin-billing-api.service';
import { AdminBookingSummary } from '../../api.service';

@Component({
  selector: 'app-admin-billing',
  standalone: true,
  imports: [CommonModule, DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './admin-billing.component.html',
  styleUrl: './admin-bookings.component.scss',
})
export class AdminBilling {
  private readonly billingApi = inject(AdminBillingApiService);
  private readonly fb = inject(NonNullableFormBuilder);
  readonly dateFromControl = new FormControl('', { nonNullable: true });
  readonly dateToControl = new FormControl('', { nonNullable: true });
  readonly bookings = signal<any[]>([]);
  readonly selectedBookingForBilling = signal<AdminBookingSummary | null>(null);
  readonly activeDocType = signal<'invoice' | 'delivery_note' | null>(null);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly actionId = signal<number | null>(null);
  readonly error = signal('');
  readonly notice = signal('');


  // Controles de filtrado
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly invoiceFilterControl = new FormControl('', { nonNullable: true });
  readonly deliveryFilterControl = new FormControl('', { nonNullable: true });

  readonly billingForm = this.fb.group({
    notes: ['', Validators.maxLength(500)],
  });

  constructor() {
    this.loadData();

    // Recarga automática al interactuar con los filtros
    merge(
      this.searchControl.valueChanges.pipe(debounceTime(300), distinctUntilChanged()),
      this.invoiceFilterControl.valueChanges,
      this.deliveryFilterControl.valueChanges
    ).subscribe(() => {
      this.loadData();
    });
  }

loadData(): void {
    this.loading.set(true);
    this.error.set('');

    const filters = {
      search: this.searchControl.value,
      invoice: this.invoiceFilterControl.value,
      delivery: this.deliveryFilterControl.value,
      date_from: this.dateFromControl.value,
      date_to: this.dateToControl.value,
    };

    this.billingApi.getBillingData(filters).subscribe({
      next: (data: any[]) => {
        const mappedData = data.map((item) => ({
          ...item,
          id: item.booking_id || item.id,
          email: item.email || item.guest_email || '',
          total: Number(item.total || 0),
        }));
        this.bookings.set(mappedData);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set('No se pudieron cargar los datos de facturación.');
        this.loading.set(false);
      },
    });
  }
  
clearFilters(): void {
    this.searchControl.setValue('');
    this.invoiceFilterControl.setValue('');
    this.deliveryFilterControl.setValue('');
    this.dateFromControl.setValue('');
    this.dateToControl.setValue('');
    this.loadData();
  }

  openBillingModal(booking: AdminBookingSummary, type: 'invoice' | 'delivery_note'): void {
    this.clearMessages();
    this.selectedBookingForBilling.set(booking);
    this.activeDocType.set(type);
    this.billingForm.reset();
  }

  closeModal(): void {
    this.selectedBookingForBilling.set(null);
    this.activeDocType.set(null);
  }

  confirmAndGenerate(): void {
    const booking = this.selectedBookingForBilling();
    const type = this.activeDocType();
    if (!booking || !type || this.saving()) return;

    this.saving.set(true);
    this.billingApi
      .generateDocument({
        booking_id: booking.id,
        document_type: type,
        notes: this.billingForm.getRawValue().notes,
      })
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          const docName = type === 'invoice' ? 'Factura' : 'Albarán';
          this.notice.set(`${docName} generado correctamente con número ${res.document_number}.`);
          this.closeModal();

          // Descarga automática local
          this.downloadPdf(booking.id, type, res.document_number);

          // Preguntar si se desea enviar por correo al huésped (si tiene email)
          const bookingEmail = (booking as any).email;
          if (bookingEmail) {
            const sendEmail = window.confirm(
              `¿Deseas enviar por email a: ${bookingEmail} una copia de la ${docName.toLowerCase()}?`
            );
            if (sendEmail) {
              this.billingApi.resendDocumentPdf(booking.id, type).subscribe({
                next: () => {
                  this.notice.set(`${docName} generado y enviado por email a ${bookingEmail} correctamente.`);
                },
                error: () => {
                  this.error.set(`El documento se generó y descargó, pero hubo un error al enviar el correo.`);
                },
              });
            }
          }

          this.loadData();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set('Error al generar el documento en la base de datos.');
        },
      });
  }

  resendDocument(bookingId: number, type: 'invoice' | 'delivery_note', email?: string | null): void {
    if (!email) {
      this.error.set('El huésped no tiene un correo electrónico registrado.');
      return;
    }
    const docName = type === 'invoice' ? 'Factura' : 'Albarán';
    if (!window.confirm(`¿Deseas reenviar por email la ${docName.toLowerCase()} a ${email}?`)) {
      return;
    }

    this.actionId.set(bookingId);
    this.billingApi.resendDocumentPdf(bookingId, type).subscribe({
      next: () => {
        this.actionId.set(null);
        this.notice.set(`${docName} reenviado por correo correctamente a ${email}.`);
      },
      error: () => {
        this.actionId.set(null);
        this.error.set(`No se pudo enviar el correo con el ${docName.toLowerCase()}.`);
      },
    });
  }

  downloadPdf(bookingId: number, type: 'invoice' | 'delivery_note', docNumber: string): void {
    if (this.actionId() !== null) return;
    this.actionId.set(bookingId);
    this.billingApi.downloadDocumentPdf(bookingId, type).subscribe({
      next: (file) => {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${type === 'invoice' ? 'factura' : 'albaran'}-${docNumber}.pdf`;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        this.actionId.set(null);
        this.notice.set('PDF descargado con éxito.');
      },
      error: (err: HttpErrorResponse) => {
        this.actionId.set(null);
        this.error.set('No se pudo descargar el archivo PDF.');
      },
    });
  }

  private clearMessages(): void {
    this.error.set('');
    this.notice.set('');
  }
}