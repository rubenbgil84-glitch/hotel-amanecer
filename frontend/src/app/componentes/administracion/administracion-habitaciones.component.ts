import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminRoom, ApiService, RoomInput } from '../../api.service';
import { RoomGallery } from '../compartidos/room-gallery/room-gallery.component';

@Component({
  selector: 'app-admin-rooms',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink, RoomGallery],
  templateUrl: './administracion-habitaciones.component.html',
  styleUrl: './administracion-habitaciones.component.scss',
})
export class AdministracionHabitaciones {
  private readonly api = inject(ApiService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly rooms = signal<AdminRoom[] | null>(null);
  readonly standardRooms = computed(() => (this.rooms() ?? []).filter((room) => room.pricing_type === 'standard'));
  readonly ruralHouses = computed(() => (this.rooms() ?? []).filter((room) => room.pricing_type === 'rural_house'));
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly editingId = signal<number | null | 'new'>(null);
  readonly imagePreview = signal<string | null>(null);
  readonly existingImages = signal<NonNullable<AdminRoom['images']>>([]);
  readonly newImagePreviews = signal<string[]>([]);
  readonly removedImageIds = signal<number[]>([]);
  readonly editingBlockId = signal<number | null>(null);
  readonly selectedRoomIds = signal<number[]>([]);
  readonly selectedRoomCount = computed(() => this.selectedRoomIds().length);
  readonly allRoomsSelected = computed(() => {
    const roomCount = this.standardRooms().length;
    return roomCount > 0 && this.selectedRoomCount() === roomCount;
  });
  readonly someRoomsSelected = computed(() => {
    const selectedCount = this.selectedRoomCount();
    const roomCount = this.standardRooms().length;
    return selectedCount > 0 && selectedCount < roomCount;
  });
  private imageDataUrls: string[] = [];

  roomImageUrls(room: AdminRoom): string[] {
    const images = room.images?.map((image) => image.image_url).filter(Boolean) ?? [];
    return images.length ? images : room.image_url ? [room.image_url] : [];
  }

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    description: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(2000)]],
    pricing_type: ['standard' as 'standard' | 'rural_house', Validators.required],
    catalog_category: ['Habitación doble', [Validators.required, Validators.minLength(2), Validators.maxLength(70)]],
    price_per_night: [90, [Validators.required, Validators.min(0.01), Validators.max(100000)]],
    single_price: [30, [Validators.required, Validators.min(0), Validators.max(100000)]],
    double_price: [45, [Validators.required, Validators.min(0.01), Validators.max(100000)]],
    extra_bed_price: [15, [Validators.required, Validators.min(0), Validators.max(100000)]],
    capacity: [2, [Validators.required, Validators.min(1), Validators.max(20)]],
    features: [''],
    is_active: [true],
  });

  readonly bulkPrices = this.fb.group({
    single_price: [30, [Validators.required, Validators.min(0), Validators.max(100000)]],
    double_price: [45, [Validators.required, Validators.min(0.01), Validators.max(100000)]],
    extra_bed_price: [15, [Validators.required, Validators.min(0), Validators.max(100000)]],
  });

  readonly blockForm = this.fb.group({
    start_date: ['', Validators.required],
    end_date: ['', Validators.required],
    reason: ['', Validators.maxLength(200)],
  });

  constructor() {
    this.loadRooms();
  }

  loadRooms(showLoading = true): void {
    if (showLoading) this.loading.set(true);
    this.error.set('');
    this.api.adminRooms().subscribe({
      next: (rooms) => {
        this.rooms.set(rooms);
        const roomIds = new Set(rooms.filter((room) => room.pricing_type === 'standard').map((room) => room.id));
        this.selectedRoomIds.update((ids) => ids.filter((id) => roomIds.has(id)));
        if (showLoading) this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.showRequestError(error, 'No se pudieron cargar las habitaciones.');
        if (showLoading) this.loading.set(false);
      },
    });
  }

  startCreate(): void {
    this.clearMessages();
    this.editingId.set('new');
    this.imageDataUrls = [];
    this.existingImages.set([]);
    this.newImagePreviews.set([]);
    this.removedImageIds.set([]);
    this.imagePreview.set(null);
    this.form.reset({
      name: '', description: '', pricing_type: 'standard', catalog_category: 'Habitación doble', price_per_night: 90,
      single_price: 30, double_price: 45, extra_bed_price: 15,
      capacity: 2, features: '', is_active: true,
    });
    this.cancelBlockEdit();
  }

  startEdit(room: AdminRoom): void {
    this.clearMessages();
    this.editingId.set(room.id);
    this.imageDataUrls = [];
    this.imagePreview.set(room.image_url);
    this.existingImages.set(room.images?.length ? room.images : room.image_url ? [{id: 0, image_url: room.image_url, position: 0}] : []);
    this.newImagePreviews.set([]);
    this.removedImageIds.set([]);
    this.form.reset({
      name: room.name,
      description: room.description,
      price_per_night: room.price_per_night,
      pricing_type: room.pricing_type,
      catalog_category: room.catalog_category,
      single_price: room.single_price,
      double_price: room.double_price,
      extra_bed_price: room.extra_bed_price,
      capacity: room.capacity,
      features: room.features.join('\n'),
      is_active: room.is_active,
    });
    this.cancelBlockEdit();
  }

  onPricingTypeChange(): void {
    if (this.form.controls.pricing_type.value === 'rural_house') {
      this.form.patchValue({ capacity: 13, catalog_category: 'Casa rural' });
    } else if (this.form.controls.capacity.value === 13) {
      this.form.patchValue({ capacity: 2, catalog_category: 'Habitación doble' });
    }
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.imageDataUrls = [];
    this.imagePreview.set(null);
    this.existingImages.set([]);
    this.newImagePreviews.set([]);
    this.removedImageIds.set([]);
    this.clearMessages();
  }

  async selectImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)
      || this.existingImages().length - this.removedImageIds().length + this.imageDataUrls.length + files.length > 10) {
      this.error.set('Selecciona hasta 10 imágenes JPG, PNG o WebP de hasta 5 MB cada una.');
      input.value = '';
      return;
    }
    try {
      const encoded = await Promise.all(files.map((file) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('No se pudo leer una imagen.'));
        reader.onerror = () => reject(new Error('No se pudo leer una imagen.'));
        reader.readAsDataURL(file);
      })));
      this.imageDataUrls.push(...encoded);
      this.newImagePreviews.update((images) => [...images, ...encoded]);
      this.error.set('');
    } catch {
      this.error.set('No se pudieron leer las imágenes seleccionadas.');
    }
    input.value = '';
  }

  removeExistingImage(id: number): void {
    if (id === 0) return;
    this.removedImageIds.update((ids) => [...new Set([...ids, id])]);
  }

  removeNewImage(index: number): void {
    this.imageDataUrls.splice(index, 1);
    this.newImagePreviews.update((images) => images.filter((_image, imageIndex) => imageIndex !== index));
  }

  saveRoom(): void {
    if (this.saving()) return;
    this.clearMessages();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Revisa los campos obligatorios de la habitación.');
      return;
    }

    const values = this.form.getRawValue();
    const input: RoomInput = {
      name: values.name.trim(),
      description: values.description.trim(),
      price_per_night: values.pricing_type === 'rural_house'
        ? Number(values.price_per_night)
        : Number(values.double_price),
      pricing_type: values.pricing_type,
      catalog_category: values.pricing_type === 'rural_house'
        ? 'Casa rural'
        : values.catalog_category.trim(),
      single_price: Number(values.single_price),
      double_price: Number(values.double_price),
      extra_bed_price: Number(values.extra_bed_price),
      capacity: Number(values.capacity),
      features: values.features.split('\n').map((feature) => feature.trim()).filter(Boolean),
      is_active: values.is_active,
      ...(this.imageDataUrls.length ? { image_data_urls: this.imageDataUrls } : {}),
      ...(this.removedImageIds().length ? { remove_image_ids: this.removedImageIds() } : {}),
    };
    this.saving.set(true);
    const roomId = this.editingId();
    const request = roomId === 'new'
      ? this.api.createRoom(input)
      : this.api.updateRoom(roomId!, input);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.editingId.set(null);
        this.imageDataUrls = [];
        this.notice.set(roomId === 'new' ? 'Habitación creada.' : 'Cambios guardados.');
        this.loadRooms();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.showRequestError(error, 'No se pudo guardar la habitación.');
      },
    });
  }

  toggleRoomSelection(roomId: number, event: Event): void {
    if (!this.standardRooms().some((room) => room.id === roomId)) return;
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedRoomIds.update((ids) => checked
      ? [...new Set([...ids, roomId])]
      : ids.filter((id) => id !== roomId));
  }

  selectAllRooms(event: Event): void {
    this.selectedRoomIds.set((event.target as HTMLInputElement).checked
      ? this.standardRooms().map((room) => room.id)
      : []);
  }

  clearRoomSelection(): void {
    this.selectedRoomIds.set([]);
  }

  applyBulkAction(action: 'activate' | 'deactivate' | 'delete' | 'set_prices'): void {
    if (this.saving()) return;
    this.clearMessages();
    const standardRoomIds = new Set(this.standardRooms().map((room) => room.id));
    const ids = this.selectedRoomIds().filter((id) => standardRoomIds.has(id));
    if (!ids.length) {
      this.error.set('Selecciona al menos un alojamiento.');
      return;
    }
    if (action === 'delete' && !window.confirm(
      `¿Eliminar los ${ids.length} alojamientos seleccionados? Las habitaciones con reservas históricas se conservarán.`,
    )) return;
    if (action === 'set_prices' && this.bulkPrices.invalid) {
      this.bulkPrices.markAllAsTouched();
      this.error.set('Indica precios válidos para aplicar los cambios.');
      return;
    }
    const input = {
      room_ids: ids,
      action,
      ...(action === 'set_prices' ? {
        single_price: Number(this.bulkPrices.controls.single_price.value),
        double_price: Number(this.bulkPrices.controls.double_price.value),
        extra_bed_price: Number(this.bulkPrices.controls.extra_bed_price.value),
      } : {}),
    };
    this.saving.set(true);
    this.api.bulkRooms(input).subscribe({
      next: (result) => {
        this.saving.set(false);
        if (action === 'delete') {
          const removedIds = result.deleted ?? [];
          this.selectedRoomIds.update((selected) => selected.filter((id) => !removedIds.includes(id)));
          this.notice.set(result.retained?.length
            ? `Eliminadas ${removedIds.length} habitaciones. Se conservaron desactivadas ${result.retained.length} con reservas: ${result.retained.map((room) => room.name).join(', ')}.`
            : `Se eliminaron ${removedIds.length} habitaciones.`);
        } else {
          this.notice.set(action === 'set_prices'
            ? `Precios actualizados en ${result.updated ?? 0} alojamientos.`
            : `Estado actualizado en ${result.updated ?? 0} alojamientos.`);
        }
        this.loadRooms(false);
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.showRequestError(error, 'No se pudo completar la acción masiva.');
      },
    });
  }

  toggleRoom(room: AdminRoom): void {
    this.clearMessages();
    const input = this.inputFromRoom(room, !room.is_active);
    this.api.updateRoom(room.id, input).subscribe({
      next: () => {
        this.notice.set(room.is_active ? 'Habitación desactivada.' : 'Habitación activada.');
        this.loadRooms();
      },
      error: (error: HttpErrorResponse) => this.showRequestError(error, 'No se pudo cambiar el estado de la habitación.'),
    });
  }

  deleteRoom(room: AdminRoom): void {
    if (!window.confirm(`¿Eliminar «${room.name}» y su imagen? Si tiene reservas asociadas no se podrá eliminar.`)) return;
    this.clearMessages();
    this.api.deleteRoom(room.id).subscribe({
      next: () => {
        this.notice.set('Habitación eliminada.');
        this.loadRooms();
      },
      error: (error: HttpErrorResponse) => this.showRequestError(error, 'No se pudo eliminar la habitación.'),
    });
  }

  addAvailabilityBlock(room: AdminRoom): void {
    this.clearMessages();
    if (this.blockForm.invalid) {
      this.blockForm.markAllAsTouched();
      return;
    }
    const input = this.blockForm.getRawValue();
    const blockId = this.editingBlockId();
    const request = blockId === null
      ? this.api.addRoomAvailabilityBlock(room.id, input)
      : this.api.updateRoomAvailabilityBlock(room.id, blockId, input);
    request.subscribe({
      next: (savedBlock) => {
        this.rooms.update((rooms) => rooms?.map((current) => current.id !== room.id
          ? current
          : {
            ...current,
            availability_blocks: blockId === null
              ? [...current.availability_blocks, savedBlock].sort((a, b) => a.start_date.localeCompare(b.start_date))
              : current.availability_blocks.map((block) => block.id === blockId ? savedBlock : block)
                .sort((a, b) => a.start_date.localeCompare(b.start_date)),
          }) ?? null);
        this.cancelBlockEdit();
        this.notice.set(blockId === null ? 'Periodo bloqueado y guardado.' : 'Bloqueo actualizado.');
      },
      error: (error: HttpErrorResponse) => this.showRequestError(error, blockId === null
        ? 'No se pudo guardar el bloqueo.'
        : 'No se pudo actualizar el bloqueo.'),
    });
  }

  addAvailabilityBlockForEditing(): void {
    const roomId = this.editingId();
    const room = this.rooms()?.find((candidate) => candidate.id === roomId);
    if (room) this.addAvailabilityBlock(room);
  }

  removeAvailabilityBlock(room: AdminRoom, blockId: number): void {
    this.clearMessages();
    this.api.deleteRoomAvailabilityBlock(room.id, blockId).subscribe({
      next: () => {
        this.rooms.update((rooms) => rooms?.map((current) => current.id === room.id
          ? {...current, availability_blocks: current.availability_blocks.filter((block) => block.id !== blockId)}
          : current) ?? null);
        if (this.editingBlockId() === blockId) this.cancelBlockEdit();
        this.notice.set('Bloqueo eliminado.');
      },
      error: (error: HttpErrorResponse) => this.showRequestError(error, 'No se pudo eliminar el bloqueo.'),
    });
  }

  editAvailabilityBlock(block: AdminRoom['availability_blocks'][number]): void {
    this.clearMessages();
    this.editingBlockId.set(block.id);
    this.blockForm.reset({
      start_date: block.start_date,
      end_date: block.end_date,
      reason: block.reason,
    });
  }

  cancelBlockEdit(): void {
    this.editingBlockId.set(null);
    this.blockForm.reset({start_date: '', end_date: '', reason: ''});
  }

  private inputFromRoom(room: AdminRoom, isActive: boolean): RoomInput {
    return {
      name: room.name,
      description: room.description,
      price_per_night: room.price_per_night,
      pricing_type: room.pricing_type,
      catalog_category: room.catalog_category,
      single_price: room.single_price,
      double_price: room.double_price,
      extra_bed_price: room.extra_bed_price,
      capacity: room.capacity,
      features: room.features,
      is_active: isActive,
    };
  }

  private clearMessages(): void {
    this.error.set('');
    this.notice.set('');
  }

  private showRequestError(error: HttpErrorResponse, fallback: string): void {
    console.error(fallback, error);
    this.error.set(error.error?.errors?.[0] ?? fallback);
  }
}
