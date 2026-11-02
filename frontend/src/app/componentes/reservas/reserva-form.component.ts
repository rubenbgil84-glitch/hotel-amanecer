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
  BookingService,
  CatalogService,
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
  readonly successDetails = signal<{ roomName: string; checkIn: string; checkOut: string; adults: number; children: number } | null>(null);
  readonly countdown = signal(8);
  readonly checkedRooms = signal<Room[] | null>(this.availability.rooms());
  readonly confirmedSearch = signal<AvailabilitySearch | null>(this.availability.search());
  readonly confirmedRoomId = signal<number | null>(this.availability.roomId());
  readonly unavailableRoomId = signal<number | null>(null);
  readonly catalogServices = signal<CatalogService[]>([]);
  readonly serviceCatalogLoaded = signal(false);
  readonly selectedServiceIds = signal<number[]>([]);
  readonly serviceQuantities = signal<Record<number, number>>({});
  readonly invalidServiceQuantityIds = signal<number[]>([]);
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
  readonly selectedServices = computed<BookingService[]>(() => {
    const values = this.currentValues();
    const travelers = values.adults + values.children;
    return this.catalogServices()
      .filter((service) => this.selectedServiceIds().includes(service.id))
      .map((service) => {
        const quantity = service.pricing_unit === 'per_person_night'
          ? travelers * this.nights()
          : service.pricing_unit === 'per_night'
            ? this.nights()
            : service.pricing_unit === 'per_stay'
              ? 1
              : this.serviceQuantities()[service.id] ?? 1;
        return {
          service_id: service.id,
          service_name: service.name,
          pricing_unit: service.pricing_unit,
          quantity,
          unit_price: service.price,
          total: Math.round(service.price * quantity * 100) / 100,
          vat_category: service.vat_category,
        };
      });
  });
  readonly servicesTotal = computed(() =>
    this.selectedServices().reduce((sum, service) => sum + service.total, 0),
  );
  readonly bookingFingerprint = computed(() => {
    const values = this.currentValues();
    return JSON.stringify({
      room_id: values.room_id,
      date_range: values.date_range,
      adults: values.adults,
      children: values.children,
      services: this.selectedServices().map(({ service_id, quantity }) => ({ service_id, quantity })),
    });
  });
  readonly currentDiscount = computed(() => {
    const applied = this.appliedDiscount();
    return applied?.fingerprint === this.bookingFingerprint() &&
      applied.code === this.discountCode().trim().toUpperCase() ? applied : null;
  });
  readonly estimatedTotal = computed(() =>
    Math.max(0, this.roomTotal() + this.servicesTotal() - (this.currentDiscount()?.discount_amount ?? 0)),
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
    const nightlyByCategory = Array.from({ length: nights }, () => new Map<string, number>());
    const components = [
      { amount: this.roomTotal(), category: 'lodging' },
      ...this.selectedServices().map((service) => ({ amount: service.total, category: service.vat_category })),
    ];
    for (const component of components) {
      allocate(component.amount).forEach((amount, index) => {
        const nightly = nightlyByCategory[index];
        nightly.set(component.category, (nightly.get(component.category) ?? 0) + amount);
      });
    }
    const nightly = nightlyByCategory.map((categories) =>
      [...categories.values()].reduce((sum, amount) => sum + amount, 0),
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
    const grouped = new Map<string, { vat_category: string; rate: number; taxable_base: number; vat: number }>();
    for (let index = 0; index < nights; index += 1) {
      const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
      const categories = [...nightlyByCategory[index]];
      const categoryShares = categories.map(([, amount], categoryIndex) => {
        const exact = nightly[index] ? discountByNight[index] * amount / nightly[index] : 0;
        return { categoryIndex, cents: Math.floor(exact), fraction: exact - Math.floor(exact) };
      });
      let remaining = discountByNight[index] - categoryShares.reduce((sum, share) => sum + share.cents, 0);
      for (const share of [...categoryShares].sort((a, b) => b.fraction - a.fraction || a.categoryIndex - b.categoryIndex)) {
        if (!remaining) break;
        share.cents += 1;
        remaining -= 1;
      }
      for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex += 1) {
        const [category, gross] = categories[categoryIndex];
        const rate = rates.reduce<VatRate | null>(
          (selected, item) => item.vat_category === category && item.effective_from.slice(0, 10) <= date ? item : selected,
          null,
        );
        if (!rate) continue;
        const amount = gross - (categoryShares.find((share) => share.categoryIndex === categoryIndex)?.cents ?? 0);
        const taxableBase = Math.round(amount / (1 + rate.rate / 100));
        const key = `${category}:${rate.rate}`;
        const current = grouped.get(key) ?? { vat_category: category, rate: rate.rate, taxable_base: 0, vat: 0 };
        current.taxable_base += taxableBase;
        current.vat += amount - taxableBase;
        grouped.set(key, current);
      }
    }
    return [...grouped.values()].map((item) => ({
      ...item,
      taxable_base: item.taxable_base / 100,
      vat: item.vat / 100,
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
    this.api.services().subscribe({
      next: (services) => {
        this.catalogServices.set(services);
        this.serviceCatalogLoaded.set(true);
      },
      error: (error: HttpErrorResponse) => {
        console.error('No se pudieron cargar los servicios reservables.', error);
        this.errors.set(['No se pudieron cargar los servicios disponibles.']);
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

  isServiceSelected(serviceId: number): boolean {
    return this.selectedServiceIds().includes(serviceId);
  }

  serviceQuantity(serviceId: number): number {
    return this.serviceQuantities()[serviceId] ?? 1;
  }

  toggleService(serviceId: number, event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.selectedServiceIds.update((ids) => input.checked
      ? [...new Set([...ids, serviceId])]
      : ids.filter((id) => id !== serviceId));
    if (!input.checked) {
      this.invalidServiceQuantityIds.update((ids) => ids.filter((id) => id !== serviceId));
    }
  }

  updateServiceQuantity(serviceId: number, event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const quantity = Number(input.value);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      input.setCustomValidity('Indica una cantidad entre 1 y 100.');
      this.invalidServiceQuantityIds.update((ids) => [...new Set([...ids, serviceId])]);
      return;
    }
    input.setCustomValidity('');
    this.invalidServiceQuantityIds.update((ids) => ids.filter((id) => id !== serviceId));
    this.serviceQuantities.update((quantities) => ({ ...quantities, [serviceId]: quantity }));
  }

  applyDiscountCode(): void {
    this.errors.set([]);
    if (this.invalidServiceQuantityIds().length) {
      this.errors.set(['Revisa las cantidades de los servicios seleccionados.']);
      return;
    }
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
      services: this.selectedServices().map(({ service_id, quantity }) => ({ service_id, quantity })),
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
    if (!this.serviceCatalogLoaded()) {
      this.errors.set(['Espera a que se carguen los servicios disponibles antes de continuar.']);
      return;
    }
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
    if (this.invalidServiceQuantityIds().length) {
      this.errors.set(['Revisa las cantidades de los servicios seleccionados.']);
      return;
    }
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
      services: this.selectedServices().map(({ service_id, quantity }) => ({ service_id, quantity })),
      notes: values.notes.trim(),
      ...(this.discountCode().trim() ? { discount_code: this.discountCode().trim() } : {}),
    };

    this.sending.set(true);
    this.api.book(booking).subscribe({
      next: (result) => {
        this.sending.set(false);
        this.result.set(result);
        this.countdown.set(result.email_sent ? 8 : 0);
        this.successDetails.set({
          roomName: room.name,
          checkIn: range.check_in,
          checkOut: range.check_out,
          adults: values.adults,
          children: values.children,
        });
        this.countdownSubscription?.unsubscribe();
        if (result.email_sent) {
          this.countdownSubscription = timer(1000, 1000).pipe(
            take(8),
            map((_, index) => 7 - index),
            takeUntilDestroyed(this.destroyRef),
          ).subscribe((remaining) => {
            this.countdown.set(remaining);
            if (remaining === 0) void this.router.navigateByUrl('/');
          });
        }
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
      notes: '',
    });
    this.selectedServiceIds.set([]);
    this.serviceQuantities.set({});
    this.invalidServiceQuantityIds.set([]);
    this.discountCode.set('');
    this.appliedDiscount.set(null);
  }
}
