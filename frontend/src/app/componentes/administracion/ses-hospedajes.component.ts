import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormArray, FormGroup, NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SesBooking, SesHospedajesApiService, SesSettings, SesTraveler } from '../../ses-hospedajes-api.service';

@Component({
  selector: 'app-ses-hospedajes',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './ses-hospedajes.component.html',
  styleUrl: './ses-hospedajes.component.scss',
})
export class SesHospedajes {
  private readonly api = inject(SesHospedajesApiService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly bookings = signal<SesBooking[]>([]);
  readonly editingBooking = signal<SesBooking | null>(null);
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

  readonly settingsForm = this.fb.group({
    establishment_code: [''],
    internet_available: ['unset'],
  });

  readonly detailsForm = this.fb.group({
    payment_type: [''],
    payment_date: [''],
    payment_medium: [''],
    payment_holder: [''],
    card_expiry: [''],
    check_in_time: ['15:00'],
    check_out_time: ['11:00'],
    primary_document_type: [''],
    primary_nationality_code: [''],
    primary_country_code: [''],
    primary_municipality_code: [''],
    primary_municipality_name: [''],
    primary_postal_code: [''],
    primary_address_complement: [''],
    additional_travelers: this.fb.array<FormGroup>([]),
  });

  get additionalTravelers(): FormArray<FormGroup> {
    return this.detailsForm.controls.additional_travelers;
  }

  constructor() {
    this.loadSettings();
    this.loadBookings();
  }

  loadBookings(): void {
    this.loading.set(true);
    this.error.set('');
    const values = this.filters.getRawValue();
    this.api.bookings({
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
        this.showRequestError(error, 'No se pudieron cargar las reservas para SES.Hospedajes.');
        this.loading.set(false);
      },
    });
  }

  resetFilters(): void {
    this.filters.reset({ from_date: '', to_date: '', precheck: 'all', search: '' });
    this.loadBookings();
  }

  saveSettings(): void {
    if (this.saving()) return;
    this.clearMessages();
    const settings = this.settingsForm.getRawValue();
    if (!settings.establishment_code.trim()) {
      this.error.set('Indica el código del establecimiento asignado por SES.Hospedajes.');
      return;
    }
    if (settings.internet_available === 'unset') {
      this.error.set('Confirma si el establecimiento dispone de internet.');
      return;
    }
    this.saving.set(true);
    this.api.updateSettings({
      establishment_code: settings.establishment_code.trim(),
      internet_available: settings.internet_available === 'true',
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.notice.set('Configuración SES.Hospedajes guardada.');
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.showRequestError(error, 'No se pudo guardar la configuración SES.Hospedajes.');
      },
    });
  }

  startEdit(booking: SesBooking): void {
    if (this.actionId() !== null) return;
    this.clearMessages();
    if (!booking.precheckin_completed_at) {
      this.openEditor(booking);
      return;
    }
    const accepted = window.confirm(
      `El pre-check-in de ${booking.reservation_code} se eliminará, incluidas las imágenes, y enviaremos al huésped un nuevo enlace para que lo complete otra vez. ¿Quieres continuar?`,
    );
    if (!accepted) return;
    this.actionId.set(booking.id);
    this.api.resetPrecheckin(booking.id).subscribe({
      next: () => {
        this.actionId.set(null);
        this.notice.set('Pre-check-in eliminado y nuevo enlace enviado al huésped.');
        this.openEditor(booking);
        this.loadBookings();
      },
      error: (error: HttpErrorResponse) => {
        this.actionId.set(null);
        this.showRequestError(error, 'No se pudo reiniciar el pre-check-in.');
      },
    });
  }

  saveDetails(): void {
    const booking = this.editingBooking();
    if (!booking || this.saving()) return;
    this.clearMessages();
    const values = this.detailsForm.getRawValue();
    this.saving.set(true);
    this.api.updateBooking(booking.id, {
      ...values,
      additional_travelers: values.additional_travelers as SesTraveler[],
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.editingBooking.set(null);
        this.notice.set('Datos de SES.Hospedajes guardados. Comprueba los campos obligatorios antes de generar el XML.');
        this.loadBookings();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.showRequestError(error, 'No se pudieron guardar los datos SES.Hospedajes.');
      },
    });
  }

  addTraveler(): void {
    if (this.additionalTravelers.length >= 9) return;
    this.additionalTravelers.push(this.newTravelerForm());
  }

  removeTraveler(index: number): void {
    this.additionalTravelers.removeAt(index);
  }

  cancelEdit(): void {
    this.editingBooking.set(null);
    this.additionalTravelers.clear();
  }

  generateXml(booking: SesBooking): void {
    if (this.actionId() !== null) return;
    this.clearMessages();
    this.actionId.set(booking.id);
    this.api.generateXml(booking.id).subscribe({
      next: (file) => {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ses-hospedajes-${booking.reservation_code}.xml`;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        this.actionId.set(null);
        this.notice.set(`XML generado para la reserva ${booking.reservation_code}.`);
      },
      error: (error: HttpErrorResponse) => {
        this.actionId.set(null);
        this.showExportError(error);
      },
    });
  }

  deletePrecheckin(booking: SesBooking): void {
    if (this.actionId() !== null) return;
    const accepted = window.confirm(
      `¿Eliminar los datos SES/pre-check-in de ${booking.reservation_code} y sus imágenes? La reserva se conservará. El enlace actual dejará de funcionar; si quieres que el huésped vuelva a completarlo, envía un nuevo enlace desde Reservas.`,
    );
    if (!accepted) return;
    this.clearMessages();
    this.actionId.set(booking.id);
    this.api.deletePrecheckin(booking.id).subscribe({
      next: () => {
        this.actionId.set(null);
        this.notice.set('Datos SES/pre-check-in e imágenes eliminados. La reserva se ha conservado.');
        this.loadBookings();
      },
      error: (error: HttpErrorResponse) => {
        this.actionId.set(null);
        this.showRequestError(error, 'No se pudieron eliminar los datos SES/pre-check-in.');
      },
    });
  }

  private loadSettings(): void {
    this.api.settings().subscribe({
      next: (settings: SesSettings) => this.settingsForm.reset({
        establishment_code: settings.establishment_code,
        internet_available: settings.internet_available === null
          ? 'unset'
          : String(settings.internet_available),
      }),
      error: (error: HttpErrorResponse) => this.showRequestError(error, 'No se pudo cargar la configuración SES.Hospedajes.'),
    });
  }

  private openEditor(booking: SesBooking): void {
    this.editingBooking.set(booking);
    this.detailsForm.reset({
      payment_type: booking.payment_type ?? '',
      payment_date: booking.payment_date?.slice(0, 10) ?? '',
      payment_medium: booking.payment_medium ?? '',
      payment_holder: booking.payment_holder ?? '',
      card_expiry: booking.card_expiry ?? '',
      check_in_time: booking.check_in_time?.slice(0, 5) ?? '15:00',
      check_out_time: booking.check_out_time?.slice(0, 5) ?? '11:00',
      primary_document_type: booking.primary_document_type || this.guessDocumentType(booking),
      primary_nationality_code: booking.primary_nationality_code || this.guessCountryCode(booking.nationality),
      primary_country_code: booking.primary_country_code || this.guessCountryCode(booking.home_country),
      primary_municipality_code: booking.primary_municipality_code ?? '',
      primary_municipality_name: booking.primary_municipality_name ?? booking.home_city ?? '',
      primary_postal_code: booking.primary_postal_code ?? '',
      primary_address_complement: booking.primary_address_complement ?? '',
      additional_travelers: [],
    });
    this.additionalTravelers.clear();
    for (const traveler of booking.additional_travelers ?? []) {
      this.additionalTravelers.push(this.newTravelerForm(traveler));
    }
  }

  private newTravelerForm(traveler?: Partial<SesTraveler>): FormGroup {
    return this.fb.group({
      first_name: [traveler?.first_name ?? ''],
      first_surname: [traveler?.first_surname ?? ''],
      second_surname: [traveler?.second_surname ?? ''],
      document_type: [traveler?.document_type ?? 'NIF'],
      document_number: [traveler?.document_number ?? ''],
      document_support: [traveler?.document_support ?? ''],
      birth_date: [traveler?.birth_date?.slice(0, 10) ?? ''],
      nationality_code: [traveler?.nationality_code ?? ''],
      sex: [traveler?.sex ?? ''],
      address: [traveler?.address ?? ''],
      address_complement: [traveler?.address_complement ?? ''],
      municipality_code: [traveler?.municipality_code ?? ''],
      municipality_name: [traveler?.municipality_name ?? ''],
      postal_code: [traveler?.postal_code ?? ''],
      country_code: [traveler?.country_code ?? 'ESP'],
      phone: [traveler?.phone ?? ''],
      phone2: [traveler?.phone2 ?? ''],
      email: [traveler?.email ?? ''],
      relationship: [traveler?.relationship ?? ''],
    });
  }

  private guessDocumentType(booking: SesBooking): string {
    const number = booking.precheckin_identity_document?.trim().toUpperCase() ?? '';
    if (/^\d{8}[A-Z]$/.test(number)) return 'NIF';
    if (/^[XYZ]\d{7}[A-Z]$/.test(number)) return 'NIE';
    if (booking.document_type === 'passport') return 'PAS';
    return '';
  }

  private guessCountryCode(value: string | null): string {
    const normalized = value?.trim().toUpperCase() ?? '';
    if (['ESP', 'ES', 'ESPAÑA', 'ESPANA', 'SPAIN'].includes(normalized)) return 'ESP';
    if (/^[A-Z]{3}$/.test(normalized)) return normalized;
    return '';
  }

  private showExportError(error: HttpErrorResponse): void {
    console.error('No se pudo generar el XML para SES.Hospedajes.', error);
    if (error.error instanceof Blob) {
      void error.error.text().then((text) => {
        try {
          const parsed = JSON.parse(text) as { errors?: string[] };
          this.error.set(parsed.errors?.join(' ') || 'No se pudo generar el XML.');
        } catch {
          this.error.set('No se pudo generar el XML para SES.Hospedajes.');
        }
      });
      return;
    }
    const messages = error.error?.errors;
    this.error.set(Array.isArray(messages) && messages.length ? messages.join(' ') : 'No se pudo generar el XML para SES.Hospedajes.');
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
