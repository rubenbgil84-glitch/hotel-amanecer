import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, WritableSignal, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, PreCheckinBooking, PreCheckinInput } from '../../api.service';
import { DocumentOcrService } from '../../document-ocr.service';

@Component({
  selector: 'app-pre-check-in',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule],
  templateUrl: './pre-check-in.component.html',
  styleUrl: './pre-check-in.component.scss',
})
export class PreCheckIn {
  private readonly api = inject(ApiService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly documentOcr = inject(DocumentOcrService);

  readonly booking = signal<PreCheckinBooking | null>(null);
  readonly status = signal<'loading' | 'ready' | 'sending' | 'invalid' | 'success'>('loading');
  readonly errors = signal<string[]>([]);
  readonly frontPreview = signal<string | null>(null);
  readonly backPreview = signal<string | null>(null);
  readonly ocrStatus = signal('');
  private frontFile: File | null = null;
  private backFile: File | null = null;
  private ocrQueue = Promise.resolve();
  private token = '';

  readonly form = this.fb.group({
    first_name: ['', [Validators.required, Validators.minLength(2)]],
    first_surname: ['', [Validators.required, Validators.minLength(2)]],
    second_surname: [''],
    birth_date: ['', Validators.required],
    sex: ['', Validators.required],
    nationality: ['', Validators.required],
    address: ['', Validators.required],
    city: ['', Validators.required],
    country: ['', Validators.required],
    document_type: ['identity', Validators.required],
    identity_document: ['', Validators.required],
    document_support_number: [''],
    document_issue_date: ['', Validators.required],
    document_expiry_date: ['', Validators.required],
    phone_landline: [''],
    phone_mobile: ['', [Validators.required, Validators.minLength(6)]],
    email: ['', [Validators.required, Validators.email]],
    traveler_count: [1, [Validators.required, Validators.min(1), Validators.max(10)]],
    minor_relationships: [''],
    arrival_time: [''],
    departure_time: [''],
    preferred_bed: ['any', Validators.required],
    terms_accepted: [false, Validators.requiredTrue],
    marketing_consent: [false],
    digital_signature: ['', [Validators.required, Validators.minLength(2)]],
  });

  constructor() {
    this.form.controls.document_support_number.setValidators(Validators.required);
    this.form.controls.document_type.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type) => {
        if (type === 'passport') {
          this.form.controls.document_support_number.clearValidators();
          this.backFile = null;
          this.setPreview(this.backPreview, null);
        } else {
          this.form.controls.document_support_number.setValidators(Validators.required);
        }
        this.form.controls.document_support_number.updateValueAndValidity();
      });

    this.destroyRef.onDestroy(() => {
      this.setPreview(this.frontPreview, null);
      this.setPreview(this.backPreview, null);
    });

    this.route.fragment.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((token) => {
      if (!token && this.status() === 'success') return;
      if (!token) {
        this.status.set('invalid');
        return;
      }

      this.token = token;
      this.status.set('loading');
      this.api.preCheckin(token).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (booking) => {
          this.booking.set(booking);
          const individualBedOnly = booking.adults + booking.children === 1 || booking.room_capacity === 1;
          if (individualBedOnly) {
            this.form.controls.preferred_bed.setValue('individual');
            this.form.controls.preferred_bed.disable();
          } else {
            this.form.controls.preferred_bed.enable();
            this.form.controls.preferred_bed.setValue('any');
          }
          const names = booking.guest_name.trim().split(/\s+/);
          const firstName = names.shift() ?? '';
          const lastName = names.splice(0);
          this.form.patchValue({
            first_name: firstName,
            first_surname: lastName.slice(0, -1).join(' ') || lastName[0] || '',
            second_surname: lastName.length > 1 ? lastName[lastName.length - 1] : '',
            identity_document: booking.identity_document,
            phone_mobile: booking.phone,
            email: booking.email,
            traveler_count: booking.adults + booking.children,
          });
          this.status.set('ready');
        },
        error: () => {
          this.status.set('invalid');
          this.errors.set(['El enlace no es válido, ya se utilizó o el pre-check-in todavía no está disponible.']);
        },
      });
    });
  }

  get isPassport() {
    return this.form.controls.document_type.value === 'passport';
  }

  get isIndividualBed() {
    const stay = this.booking();
    return !!stay && (stay.adults + stay.children === 1 || stay.room_capacity === 1);
  }

  onDocumentSelected(event: Event, side: 'front' | 'back') {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.errors.set(['El documento debe ser una imagen JPG, PNG o WebP.']);
      input.value = '';
      this.clearDocumentImage(side);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.errors.set(['Cada imagen del documento debe pesar como máximo 5 MB.']);
      input.value = '';
      this.clearDocumentImage(side);
      return;
    }

    this.errors.set([]);
    if (side === 'front') {
      this.frontFile = file;
      this.setPreview(this.frontPreview, URL.createObjectURL(file));
      this.queueDocumentOcr(file, side);
    } else {
      this.backFile = file;
      this.setPreview(this.backPreview, URL.createObjectURL(file));
      this.queueDocumentOcr(file, side);
    }
  }

  async submit() {
    this.errors.set([]);
    const { birth_date, document_issue_date } = this.form.getRawValue();
    if (birth_date && document_issue_date && document_issue_date <= birth_date) {
      this.errors.set([
        `La fecha de expedición (${this.formatDateForMessage(document_issue_date)}) debe ser posterior a la fecha de nacimiento (${this.formatDateForMessage(birth_date)}). Revisa ambos campos.`,
      ]);
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errors.set(['Completa los campos obligatorios y acepta las condiciones para continuar.']);
      return;
    }
    if (!this.frontFile || (!this.isPassport && !this.backFile)) {
      this.errors.set([this.isPassport
        ? 'Sube la imagen frontal del pasaporte.'
        : 'Sube las imágenes frontal y trasera del documento.']);
      return;
    }

    this.status.set('sending');
    let input: PreCheckinInput;
    try {
      input = {
        ...this.form.getRawValue(),
        identity_document_front: await this.fileToDataUrl(this.frontFile),
        identity_document_back: this.isPassport || !this.backFile
          ? null
          : await this.fileToDataUrl(this.backFile),
      };
    } catch {
      this.status.set('ready');
      this.errors.set(['No se pudieron preparar las imágenes. Vuelve a seleccionarlas e inténtalo de nuevo.']);
      return;
    }

    this.api.submitPreCheckin(this.token, input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.status.set('success');
          void this.router.navigate([], { relativeTo: this.route, fragment: '', replaceUrl: true });
        },
        error: (error: HttpErrorResponse) => {
          this.status.set('ready');
          this.errors.set(error.error?.errors ?? ['No se pudo completar el pre-check-in. Inténtalo de nuevo.']);
        },
      });
  }

  private clearDocumentImage(side: 'front' | 'back') {
    if (side === 'front') {
      this.frontFile = null;
      this.setPreview(this.frontPreview, null);
    } else {
      this.backFile = null;
      this.setPreview(this.backPreview, null);
    }
  }

  private setPreview(preview: WritableSignal<string | null>, url: string | null) {
    const previousUrl = preview();
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    preview.set(url);
  }

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('La imagen no se pudo leer.'));
      reader.onerror = () => reject(reader.error ?? new Error('La imagen no se pudo leer.'));
      reader.readAsDataURL(file);
    });
  }

  private formatDateForMessage(date: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
  }

  private queueDocumentOcr(file: File, side: 'front' | 'back') {
    this.ocrQueue = this.ocrQueue.then(async () => {
      if ((side === 'front' ? this.frontFile : this.backFile) !== file) return;
      await this.tryAutofillFromDocument(file, side);
    });
  }

  private async tryAutofillFromDocument(file: File, side: 'front' | 'back') {
    this.ocrStatus.set(`Leyendo la cara ${side === 'front' ? 'frontal' : 'trasera'} en este dispositivo…`);
    try {
      const text = await this.documentOcr.recognize(file);
      if ((side === 'front' ? this.frontFile : this.backFile) !== file) return;
      const lines = text.split(/\r?\n/)
        .map((line) => line.trim().toLocaleUpperCase('es'))
        .filter(Boolean);
      const updates = this.extractDocumentFields(lines);
      const emptyUpdates: typeof updates = {};
      for (const field of Object.keys(updates) as (keyof typeof updates)[]) {
        const value = updates[field];
        if (value && !this.form.controls[field].value) emptyUpdates[field] = value;
      }
      this.form.patchValue(emptyUpdates);
      this.ocrStatus.set(Object.keys(emptyUpdates).length
        ? 'Hemos rellenado algunos datos automáticamente. Revísalos antes de continuar.'
        : Object.keys(updates).length
          ? 'Se reconocieron datos, pero los campos correspondientes ya tenían información.'
          : text.trim()
            ? 'Se pudo leer texto, pero no se identificaron campos del documento. Completa los datos manualmente.'
            : 'No se pudo extraer texto de esta imagen. Prueba con una foto más nítida y bien iluminada.');
    } catch (error) {
      console.error('No se pudo ejecutar el OCR local del documento.', error);
      this.ocrStatus.set('No se pudo ejecutar la lectura automática. Puedes rellenar los datos manualmente.');
    }
  }

  private extractDocumentFields(lines: string[]) {
    const updates: Partial<Record<
      'first_name' | 'first_surname' | 'second_surname' | 'nationality' | 'identity_document'
        | 'sex' | 'address' | 'city' | 'country',
      string
    >> = {};
    const mrz = lines.find((line) => /^[A-Z<]{5,}<<[A-Z<]+$/.test(line.replace(/\s/g, '')));
    const mrzLine = mrz?.replace(/\s/g, '');
    const mrzMatch = mrzLine && /^P<[A-Z<]{3}([A-Z<]+)<<([A-Z<]+)/.exec(mrzLine);
    const idMrzMatch = mrzLine && /^(?:[A-Z<]{1,5})?([A-Z<]+)<<([A-Z<]+)/.exec(mrzLine);
    if (mrzMatch || idMrzMatch) {
      const surnames = (mrzMatch?.[1] ?? idMrzMatch?.[1] ?? '').replace(/</g, ' ').trim().split(/\s+/);
      updates.first_surname = surnames.shift();
      updates.second_surname = surnames.join(' ');
      updates.first_name = (mrzMatch?.[2] ?? idMrzMatch?.[2] ?? '').replace(/</g, ' ').trim();
    }
    const identityMrz = lines.find((line) => /^IDESP[A-Z0-9]{8,12}</.test(line.replace(/\s/g, '')));
    const identityMatch = identityMrz && /^IDESP([A-Z0-9]{8,12})</.exec(identityMrz.replace(/\s/g, ''));
    if (identityMatch) updates.identity_document = identityMatch[1];

    const labels = /\b(?:NOMBRE|NAME|APELLIDOS?|SURNAMES?|NACIONALIDAD|NATIONALITY|SEXO|SEX|FECHA|BIRTH|DNI|NIE|N[ÚU]MERO\s+DE\s+(?:IDENTIDAD|DOCUMENTO)|DOMICILIO|DIRECCI[ÓO]N|ADDRESS|LOCALIDAD|CITY|PA[IÍ]S|COUNTRY)\b/g;
    const isFieldLabel = (line: string) => {
      labels.lastIndex = 0;
      const found = labels.test(line);
      labels.lastIndex = 0;
      return found;
    };
    const readLabel = (label: RegExp) => {
      const index = lines.findIndex((line) => label.test(line));
      if (index < 0) return '';

      const currentLine = lines[index].replace(label, '').replace(labels, '').replace(/[/:|–—-]/g, ' ').trim();
      if (currentLine) return currentLine;

      const nextLine = lines[index + 1] ?? '';
      return isFieldLabel(nextLine) ? '' : nextLine.trim();
    };

    const name = readLabel(/\b(?:NOMBRE|NAME)\b/);
    const surname = readLabel(/\b(?:APELLIDOS?|SURNAMES?)\b/);
    const nationality = readLabel(/\b(?:NACIONALIDAD|NATIONALITY)\b/);
    const identity = readLabel(/\b(?:DNI|NIE|N[ÚU]MERO\s+DE\s+(?:IDENTIDAD|DOCUMENTO))\b/);
    const sex = readLabel(/\b(?:SEXO|SEX)\b/);
    const address = readLabel(/\b(?:DOMICILIO|DIRECCI[ÓO]N|ADDRESS)\b/);
    const city = readLabel(/\b(?:LOCALIDAD|CITY)\b/);
    const country = readLabel(/\b(?:PA[IÍ]S|COUNTRY)\b/);
    if (!updates.first_name && name) updates.first_name = name;
    if (!updates.first_surname && surname) {
      const surnames = surname.split(/\s+/);
      updates.first_surname = surnames.shift();
      if (!updates.second_surname) updates.second_surname = surnames.join(' ');
    }
    if (nationality) updates.nationality = nationality;
    if (identity) updates.identity_document = identity;
    if (/^(?:M|MASCULINO|HOMBRE)\b/.test(sex)) updates.sex = 'male';
    if (/^(?:F|FEMENINO|MUJER)\b/.test(sex)) updates.sex = 'female';
    if (address) updates.address = address;
    if (city) updates.city = city;
    if (country) updates.country = country;
    return updates;
  }
}
