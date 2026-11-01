import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../api.service';
import { ReservaForm } from './reserva-form.component';

@Component({
  selector: 'app-nueva-reserva',
  standalone: true,
  imports: [ReservaForm],
  templateUrl: './nueva-reserva.component.html',
  styleUrl: './nueva-reserva.component.scss',
})
export class NuevaReserva {
  private readonly api = inject(ApiService);

  readonly rooms = toSignal(
    this.api.rooms().pipe(catchError(() => of(null))),
    { initialValue: undefined },
  );
}
