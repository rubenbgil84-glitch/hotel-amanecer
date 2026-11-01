import { provideRouter } from '@angular/router';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRoom, ApiService } from '../../api.service';
import { AdministracionHabitaciones } from './administracion-habitaciones.component';

registerLocaleData(localeEs, 'es-ES');

const sampleRooms: AdminRoom[] = [
  {
    id: 1,
    name: 'Suite Norte',
    slug: 'suite-norte',
    description: 'Habitación de prueba para la selección masiva.',
    price_per_night: 90,
    pricing_type: 'standard',
    catalog_category: 'Suite',
    single_price: 30,
    double_price: 45,
    extra_bed_price: 15,
    capacity: 3,
    features: [],
    image_url: null,
    is_active: true,
    availability_blocks: [],
  },
  {
    id: 2,
    name: 'Casa Sur',
    slug: 'casa-sur',
    description: 'Casa rural de prueba para la selección masiva.',
    price_per_night: 180,
    pricing_type: 'rural_house',
    catalog_category: 'Casa rural',
    single_price: 30,
    double_price: 45,
    extra_bed_price: 15,
    capacity: 13,
    features: [],
    image_url: null,
    is_active: false,
    availability_blocks: [],
  },
];

describe('AdministracionHabitaciones bulk actions', () => {
  let api: {
    adminRooms: ReturnType<typeof vi.fn>;
    bulkRooms: ReturnType<typeof vi.fn>;
  };
  let fixture: ComponentFixture<AdministracionHabitaciones>;

  beforeEach(async () => {
    api = {
      adminRooms: vi.fn(() => of(sampleRooms)),
      bulkRooms: vi.fn((input: { action: string }) => of(
        input.action === 'delete' ? { deleted: [1], retained: [] } : { updated: 1 },
      )),
    };
    await TestBed.configureTestingModule({
      imports: [AdministracionHabitaciones],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api as unknown as ApiService },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdministracionHabitaciones);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('supports partial selection and the indeterminate select-all state', () => {
    const checkboxes = fixture.nativeElement.querySelectorAll('.room-select input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);

    (checkboxes[0] as HTMLInputElement).click();
    fixture.detectChanges();
    const selectAll = fixture.nativeElement.querySelector('.bulk-select-all input') as HTMLInputElement;
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(true);
    expect(fixture.componentInstance.selectedRoomCount()).toBe(1);
  });

  it('selects and clears every room from the bulk panel', () => {
    const selectAll = fixture.nativeElement.querySelector('.bulk-select-all input') as HTMLInputElement;
    selectAll.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.allRoomsSelected()).toBe(true);
    expect(fixture.componentInstance.selectedRoomIds()).toEqual([1, 2]);

    const clearSelection = fixture.nativeElement.querySelector('.bulk-selection-status button') as HTMLButtonElement;
    clearSelection.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedRoomIds()).toEqual([]);
    expect(fixture.componentInstance.allRoomsSelected()).toBe(false);
  });

  it('keeps bulk operations disabled without a selection and reports direct attempts', () => {
    const buttons = fixture.nativeElement.querySelectorAll('.bulk-actions button');
    expect(Array.from(buttons).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    fixture.componentInstance.applyBulkAction('activate');
    expect(api.bulkRooms).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('Selecciona al menos un alojamiento');
  });

  it('sends only selected room IDs for activation and deactivation', () => {
    fixture.componentInstance.toggleRoomSelection(1, { target: { checked: true } } as unknown as Event);
    fixture.componentInstance.applyBulkAction('activate');
    fixture.componentInstance.toggleRoomSelection(2, { target: { checked: true } } as unknown as Event);
    fixture.componentInstance.applyBulkAction('deactivate');

    expect(api.bulkRooms).toHaveBeenNthCalledWith(1, { room_ids: [1], action: 'activate' });
    expect(api.bulkRooms).toHaveBeenNthCalledWith(2, { room_ids: [1, 2], action: 'deactivate' });
  });

  it('sends validated prices with the selected IDs', () => {
    fixture.componentInstance.toggleRoomSelection(2, { target: { checked: true } } as unknown as Event);
    fixture.componentInstance.bulkPrices.setValue({
      single_price: 35,
      double_price: 55,
      extra_bed_price: 20,
      rural_house_price: 195,
    });
    fixture.componentInstance.applyBulkAction('set_prices');

    expect(api.bulkRooms).toHaveBeenCalledWith({
      room_ids: [2],
      action: 'set_prices',
      single_price: 35,
      double_price: 55,
      extra_bed_price: 20,
      rural_house_price: 195,
    });
  });

  it('requires confirmation before sending a bulk delete', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fixture.componentInstance.toggleRoomSelection(1, { target: { checked: true } } as unknown as Event);
    fixture.componentInstance.applyBulkAction('delete');
    expect(confirm).toHaveBeenCalledOnce();
    expect(api.bulkRooms).not.toHaveBeenCalled();
  });
});
