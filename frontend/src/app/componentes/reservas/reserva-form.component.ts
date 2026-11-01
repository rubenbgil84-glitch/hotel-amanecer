import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, firstValueFrom, map, take, timer } from 'rxjs';
import { AvailabilitySearchService } from '../../availability-search.service';
import {
  ApiService,
  AvailabilitySearch,
  BookingInput,
  BookingResult,
  DiscountCodeValidation,
  Room,
  VatRate,
} from '../../api.service';
import { CalendarioRango, DateRange } from '../compartidos/calendario-rango/calendario-rango.component';
import { RoomGallery } from '../compartidos/room-gallery/room-gallery.component';

@Component({
  selector: 'app-booking-form',
  standalone: true,
  imports: [ReactiveFormsModule, CurrencyPipe, DatePipe, CalendarioRango, RoomGallery],
  templateUrl: './reserva-form.component.html',
  styleUrl: './reserva-form.component.scss',
})
export class ReservaForm {
  private readonly api = inject(ApiService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly availability = inject(AvailabilitySearchService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  readonly rooms = input<Room[] | null | undefined>(null);
  readonly sending = signal(false);
  readonly checkingAvailability = signal(false);
  readonly errors = signal<string[]>([]);
  readonly result = signal<BookingResult | null>(null);
  readonly successDetails = signal<{ roomName: string; checkIn: string; checkOut: string; adults: number; children: number; breakfast: boolean; pets: boolean } | null>(null);
  readonly countdown = signal(8);
  readonly checkedRooms = signal<Room[] | null>(this.availability.rooms());
  readonly confirmedSearch = signal<AvailabilitySearch | null>(this.availability.search());
  readonly confirmedRoomId = signal<number | null>(this.availability.roomId());
  readonly unavailableRoomId = signal<number | null>(null);
  readonly breakfastPrice = signal(5);
  readonly petsPrice = signal(10);
  readonly vatRates = signal<VatRate[]>([]);
  readonly adultsOptions = Array.from({ length: 13 }, (_, index) => index + 1);
  readonly childrenOptions = Array.from({ length: 13 }, (_, index) => index);
  readonly discountCode = signal('');
  readonly validatingDiscount = signal(false);
  readonly appliedDiscount = signal<(DiscountCodeValidation & { fingerprint: string }) | null>(null);
  private countdownSubscription?: Subscription;

  readonly form = this.fb.group({
    date_range: new FormControl<DateRange | null>(
      this.availability.search()
        ? {
          check_in: this.availability.search()!.check_in,
          check_out: this.availability.search()!.check_out,
        }
        : null,
      Validators.required,
    ),
    room_id: [this.availability.roomId() ?? 0, Validators.min(1)],
    adults: [this.availability.search()?.adults ?? 2, [Validators.min(1), Validators.max(13)]],
    children: [this.availability.search()?.children ?? 0, [Validators.min(0), Validators.max(12)]],
    first_name: ['', [Validators.required, Validators.minLength(2)]],
    last_name: ['', [Validators.required, Validators.minLength(2)]],
    identity_document: ['', [Validators.required, Validators.minLength(3)]],
    phone: ['', [Validators.required, Validators.minLength(6)]],
    email: ['', [Validators.required, Validators.email]],
    breakfast: ['', Validators.required],
    pets: ['', Validators.required],
    notes: [''],
  });

  private readonly currentValues = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  readonly roomOptions = computed(() => {
    const rooms = this.checkedRooms() ?? this.rooms() ?? [];
    const selected = this.selectedRoom();
    return selected && !rooms.some((room) => room.id === selected.id)
      ? [...rooms, selected]
      : rooms;
  });
  readonly selectedRoom = computed(() => {
    const roomId = this.currentValues().room_id;
    return (this.checkedRooms() ?? this.rooms() ?? []).find((room) => room.id === roomId)
      ?? (this.rooms() ?? []).find((room) => room.id === roomId)
      ?? null;
  });
  readonly selectedRoomImages = computed(() => {
    const room = this.selectedRoom();
    const images = room?.images?.map((image) => image.image_url).filter(Boolean) ?? [];
    const imageUrl = room?.image_url;
    return images.length ? images : imageUrl ? [imageUrl] : [];
  });
  readonly nights = computed(() => {
    const range = this.currentValues().date_range;
    if (!range) return 0;
    return Math.max(0, Math.round((Date.parse(range.check_out) - Date.parse(range.check_in)) / 86_400_000));
  });
  readonly nightlyRoomPrice = computed(() => {
    const room = this.selectedRoom();
    if (!room) return 0;
    if (room.pricing_type === 'rural_house') return room.price_per_night;
    const guests = this.currentValues().adults + this.currentValues().children;
    return guests === 1
      ? room.single_price
      : room.double_price + Math.max(0, guests - 2) * room.extra_bed_price;
  });
  readonly roomTotal = computed(() => this.nightlyRoomPrice() * this.nights());
  readonly breakfastTotal = computed(() => this.currentValues().breakfast === 'yes'
    ? this.breakfastPrice() * (this.currentValues().adults + this.currentValues().children) * this.nights()
    : 0);
  readonly petsTotal = computed(() => this.currentValues().pets === 'yes' ? this.petsPrice() : 0);
  readonly bookingFingerprint = computed(() => {
    const values = this.currentValues();
    return JSON.stringify({
      room_id: values.room_id,
      date_range: values.date_range,
      adults: values.adults,
      children: values.children,
      breakfast: values.breakfast,
      pets: values.pets,
    });
  });
  readonly currentDiscount = computed(() => {
    const applied = this.appliedDiscount();
    return applied?.fingerprint === this.bookingFingerprint() &&
      applied.code === this.discountCode().trim().toUpperCase() ? applied : null;
  });
  readonly estimatedTotal = computed(() =>
    Math.max(0, this.roomTotal() + this.breakfastTotal() + this.petsTotal() - (this.currentDiscount()?.discount_amount ?? 0)),
  );
  readonly estimatedVatBreakdown = computed(() => {
    const range = this.currentValues().date_range;
    const nights = this.nights();
    const rates = this.vatRates();
    if (!range || nights < 1 || rates.length === 0) return [];
    const allocate = (amount: number) => {
      const cents = Math.round(amount * 100);
      const base = Math.floor(cents / nights);
      return Array.from({ length: nights }, (_, index) => base + (index < cents - base * nights ? 1 : 0));
    };
    const nightly = allocate(this.roomTotal()).map((room, index) =>
      room + allocate(this.breakfastTotal())[index] + allocate(this.petsTotal())[index],
    );
    const discountCents = Math.round((this.currentDiscount()?.discount_amount ?? 0) * 100);
    const totalGross = nightly.reduce((sum, amount) => sum + amount, 0);
    const shares = nightly.map((weight, index) => {
      const exact = totalGross ? discountCents * weight / totalGross : 0;
      return { index, cents: Math.floor(exact), fraction: exact - Math.floor(exact) };
    });
    let remaining = discountCents - shares.reduce((sum, share) => sum + share.cents, 0);
    for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
      if (!remaining) break;
      share.cents += 1;
      remaining -= 1;
    }
    const discountByNight = shares.sort((a, b) => a.index - b.index).map((share) => share.cents);
    const start = Date.parse(`${range.check_in}T00:00:00.000Z`);
    const grouped = new Map<number, { taxable_base: number; vat: number }>();
    for (let index = 0; index < nights; index += 1) {
      const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
      const rate = rates.reduce<VatRate | null>(
        (selected, item) => item.effective_from.slice(0, 10) <= date ? item : selected,
        null,
      );
      if (!rate) continue;
      const amount = nightly[index] - discountByNight[index];
      const taxableBase = Math.round(amount / (1 + rate.rate / 100));
      const current = grouped.get(rate.rate) ?? { taxable_base: 0, vat: 0};
      current.taxable_base += taxableBase;
      current.vat += amount - taxableBase;
      grouped.set(rate.rate, current);
    }
    return [...grouped].map(([rate, amounts]) => ({
      rate,
      taxable_base: amounts.taxable_base / 100,
      vat: amounts.vat / 100,
    }));
  });
  readonly needsAvailabilityCheck = computed(() => {
    const values = this.currentValues();
    const search = this.confirmedSearch();
    const range = values.date_range;
    const searchChanged = !search || !range
      || search.check_in !== range.check_in
      || search.check_out !== range.check_out
      || search.adults !== values.adults
      || search.children !== values.children;
    return searchChanged
      || values.room_id !== this.confirmedRoomId()
      || values.room_id === this.unavailableRoomId();
  });
  readonly canConfirmReservation = computed(() =>
    !this.needsAvailabilityCheck()
    && this.unavailableRoomId() !== this.currentValues().room_id
    && Boolean(this.selectedRoom()),
  );

  constructor() {
    this.api.siteSettings().subscribe({
      next: (settings) => {
        this.breakfastPrice.set(Number(settings.breakfast_price));
        this.petsPrice.set(Number(settings.pets_price));
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudieron cargar las tarifas de desayuno y mascotas.', error);
        this.errors.set(['No se pudieron cargar las tarifas actualizadas. El servidor confirmará el importe final al reservar.']);
      },
    });
    this.api.vatRates().subscribe({
      next: (rates) => this.vatRates.set(rates),
      error: (error: HttpErrorResponse) => {
        console.error('No se pudieron cargar los tipos de IVA.', error);
        this.errors.update((errors) => [...errors, 'No se pudieron cargar los tipos de IVA para el resumen estimado.']);
      },
    });
    effect(() => {
      const search = this.availability.search();
      const room = this.availability.roomId();
      if (!search) return;
      this.form.patchValue({
        date_range: { check_in: search.check_in, check_out: search.check_out },
        adults: search.adults,
        children: search.children,
        ...(room ? { room_id: room } : {}),
      });
      this.confirmedSearch.set(search);
      this.confirmedRoomId.set(room);
    });
  }

  applyDiscountCode(): void {
    this.errors.set([]);
    const values = this.form.getRawValue();
    const range = values.date_range;
    const code = this.discountCode().trim();
    if (!code || !range || !values.room_id || !this.selectedRoom()) {
      this.errors.set(['Indica un código y completa las fechas y la habitación antes de aplicarlo.']);
      return;
    }
    this.validatingDiscount.set(true);
    this.api.validateDiscountCode({
      code,
      room_id: values.room_id,
      check_in: range.check_in,
      check_out: range.check_out,
      adults: values.adults,
      children: values.children,
      breakfast: values.breakfast === 'yes',
      pets: values.pets === 'yes',
    }).subscribe({
      next: (discount) => {
        this.appliedDiscount.set({ ...discount, fingerprint: this.bookingFingerprint() });
        this.discountCode.set(discount.code);
        this.validatingDiscount.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.appliedDiscount.set(null);
        this.validatingDiscount.set(false);
        this.errors.set(error.error?.errors ?? ['No se pudo validar el código de descuento.']);
      },
    });
  }

  async primaryAction() {
    if (this.needsAvailabilityCheck()) {
      await this.checkAvailability();
      return;
    }

    this.submit();
  }

  async checkAvailability() {
    this.errors.set([]);
    const values = this.form.getRawValue();
    if (!values.date_range || this.form.controls.adults.invalid || this.form.controls.children.invalid || !values.room_id) {
      this.errors.set(['Elige fechas, huéspedes y una habitación para consultar disponibilidad.']);
      return;
    }

    const search: AvailabilitySearch = {
      ...values.date_range,
      adults: values.adults,
      children: values.children,
    };
    const roomId = values.room_id;
    this.checkingAvailability.set(true);
    try {
      const rooms = await firstValueFrom(this.api.availableRooms(search));
      this.checkedRooms.set(rooms);
      this.availability.saveSearch(search, rooms);
      this.confirmedSearch.set(search);
      this.confirmedRoomId.set(roomId);

      if (!rooms.some((room) => room.id === roomId)) {
        this.unavailableRoomId.set(roomId);
        this.errors.set(['No se puede reservar esa habitación para las fechas y el número de huéspedes seleccionados.']);
        return;
      }

      this.unavailableRoomId.set(null);
      this.availability.selectRoom(roomId, search, rooms);
    } catch (error) {
      console.error('No se pudo comprobar la disponibilidad de la habitación.', error);
      const response = error instanceof HttpErrorResponse ? error.error?.errors : null;
      this.errors.set(response ?? ['No se pudo comprobar la disponibilidad. Inténtalo de nuevo.']);
    } finally {
      this.checkingAvailability.set(false);
    }
  }

  submit() {
    this.errors.set([]);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errors.set(['Completa los campos obligatorios antes de confirmar la reserva.']);
      return;
    }

    const values = this.form.getRawValue();
    const range = values.date_range;
    const room = this.selectedRoom();
    if (values.adults + values.children > 13) {
      this.errors.set(['La reserva admite hasta 13 huéspedes.']);
      return;
    }
    if (!range || !room || !this.canConfirmReservation()) {
      this.errors.set(['Consulta de nuevo la disponibilidad antes de confirmar la reserva.']);
      return;
    }

    const booking: BookingInput = {
      room_id: values.room_id,
      guest_name: `${values.first_name.trim()} ${values.last_name.trim()}`,
      identity_document: values.identity_document.trim(),
      phone: values.phone.trim(),
      email: values.email.trim(),
      check_in: range.check_in,
      check_out: range.check_out,
      adults: values.adults,
      children: values.children,
      breakfast: values.breakfast === 'yes',
      pets: values.pets === 'yes',
      notes: values.notes.trim(),
      ...(this.discountCode().trim() ? { discount_code: this.discountCode().trim() } : {}),
    };

    this.sending.set(true);
    this.api.book(booking).subscribe({
      next: (result) => {
        this.sending.set(false);
        this.result.set(result);
        this.successDetails.set({
          roomName: room.name,
          checkIn: range.check_in,
          checkOut: range.check_out,
          adults: values.adults,
          children: values.children,
          breakfast: values.breakfast === 'yes',
          pets: values.pets === 'yes',
        });
        this.countdown.set(8);
        this.countdownSubscription?.unsubscribe();
        this.countdownSubscription = timer(1000, 1000).pipe(
          take(8),
          map((_, index) => 7 - index),
          takeUntilDestroyed(this.destroyRef),
        ).subscribe((remaining) => {
          this.countdown.set(remaining);
          if (remaining === 0) void this.router.navigateByUrl('/');
        });
      },
      error: (error: HttpErrorResponse) => {
        this.sending.set(false);
        this.errors.set(error.error?.errors ?? ['No se pudo completar la reserva. Inténtalo de nuevo.']);
      },
    });
  }

  reset() {
    this.countdownSubscription?.unsubscribe();
    this.countdownSubscription = undefined;
    this.result.set(null);
    this.successDetails.set(null);
    this.countdown.set(8);
    this.form.reset({
      date_range: null,
      room_id: 0,
      adults: 2,
      children: 0,
      first_name: '',
      last_name: '',
      identity_document: '',
      phone: '',
      email: '',
      breakfast: '',
      pets: '',
      notes: '',
    });
    this.discountCode.set('');
    this.appliedDiscount.set(null);
  }
}
