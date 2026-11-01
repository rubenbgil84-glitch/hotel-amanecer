import { Component, computed, ElementRef, forwardRef, HostListener, inject, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface DateRange {
  check_in: string;
  check_out: string;
}

interface CalendarDay {
  date: string;
  day: number;
  currentMonth: boolean;
  disabled: boolean;
  start: boolean;
  end: boolean;
  inRange: boolean;
}

interface CalendarMonth {
  key: string;
  title: string;
  days: CalendarDay[];
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

@Component({
  selector: 'app-calendario-rango',
  standalone: true,
  templateUrl: './calendario-rango.component.html',
  styleUrl: './calendario-rango.component.scss',
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => CalendarioRango),
    multi: true,
  }],
})
export class CalendarioRango implements ControlValueAccessor {
  private readonly element = inject(ElementRef<HTMLElement>);

  readonly today = this.toDateKey(new Date());
  readonly calendarOpen = signal(false);
  readonly disabled = signal(false);
  readonly visibleMonth = signal(this.firstOfMonth(new Date()));
  readonly selectedCheckIn = signal('');
  readonly selectedCheckOut = signal('');
  readonly weekDays = WEEKDAYS;

  readonly months = computed(() => [
    this.createMonth(this.visibleMonth(), this.selectedCheckIn(), this.selectedCheckOut()),
    this.createMonth(this.addMonths(this.visibleMonth(), 1), this.selectedCheckIn(), this.selectedCheckOut()),
  ]);
  readonly canGoPrevious = computed(() => this.visibleMonth() > this.firstOfMonth(new Date()));
  readonly dateRangeLabel = computed(() => {
    const check_in = this.selectedCheckIn();
    const check_out = this.selectedCheckOut();
    if (!check_in) return 'Selecciona entrada y salida';
    const start = this.formatDate(check_in);
    return check_out ? `${start} — ${this.formatDate(check_out)}` : `${start} — Selecciona salida`;
  });

  private onChange: (value: DateRange | null) => void = () => {};
  private onTouched: () => void = () => {};

  @HostListener('document:click', ['$event'])
  closeOnOutsideClick(event: Event) {
    if (!this.element.nativeElement.contains(event.target as Node)) {
      this.calendarOpen.set(false);
    }
  }

  writeValue(value: DateRange | null): void {
    this.selectedCheckIn.set(value?.check_in ?? '');
    this.selectedCheckOut.set(value?.check_out ?? '');
  }

  registerOnChange(fn: (value: DateRange | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  toggleCalendar() {
    if (!this.disabled()) this.calendarOpen.update((open) => !open);
  }

  changeVisibleMonth(offset: number) {
    const nextMonth = this.addMonths(this.visibleMonth(), offset);
    if (nextMonth < this.firstOfMonth(new Date())) return;
    this.visibleMonth.set(nextMonth);
  }

  selectDate(day: CalendarDay) {
    if (day.disabled || !day.currentMonth || this.disabled()) return;

    const check_in = this.selectedCheckIn();
    const check_out = this.selectedCheckOut();
    if (!check_in || check_out || day.date <= check_in) {
      this.selectedCheckIn.set(day.date);
      this.selectedCheckOut.set('');
      this.onChange(null);
      this.onTouched();
      return;
    }

    this.selectedCheckOut.set(day.date);
    this.onChange({ check_in, check_out: day.date });
    this.onTouched();
    this.calendarOpen.set(false);
  }

  private createMonth(month: Date, check_in: string, check_out: string): CalendarMonth {
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (monthStart.getDay() + 6) % 7;
    const days = Array.from({ length: 42 }, (_, index): CalendarDay => {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), index - offset + 1);
      const key = this.toDateKey(date);
      return {
        date: key,
        day: date.getDate(),
        currentMonth: date.getMonth() === monthStart.getMonth(),
        disabled: key < this.today,
        start: key === check_in,
        end: Boolean(check_out) && key === check_out,
        inRange: Boolean(check_in && check_out && key > check_in && key < check_out),
      };
    });

    return {
      key: `${monthStart.getFullYear()}-${monthStart.getMonth()}`,
      title: new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(monthStart),
      days,
    };
  }

  private firstOfMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private addMonths(date: Date, count: number) {
    return new Date(date.getFullYear(), date.getMonth() + count, 1);
  }

  private toDateKey(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatDate(value: string) {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
      .format(new Date(year, month - 1, day));
  }
}
