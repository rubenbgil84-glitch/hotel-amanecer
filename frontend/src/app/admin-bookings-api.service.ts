import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AdminBooking, AdminBookingInput, AdminBookingSummary } from './api.service';

@Injectable({ providedIn: 'root' })
export class AdminBookingsApiService {
  private readonly http = inject(HttpClient);

  bookings(filters: { from_date?: string; to_date?: string; precheck?: string; search?: string }) {
    let params = new HttpParams();
    if (filters.from_date) params = params.set('from_date', filters.from_date);
    if (filters.to_date) params = params.set('to_date', filters.to_date);
    if (filters.precheck) params = params.set('precheck', filters.precheck);
    if (filters.search) params = params.set('search', filters.search);
    return this.http.get<AdminBookingSummary[]>('/api/admin/bookings', { params });
  }

  booking(id: number) {
    return this.http.get<AdminBooking>(`/api/admin/bookings/${id}`);
  }

  updateBooking(id: number, input: AdminBookingInput) {
    return this.http.put<{ ok: boolean }>(`/api/admin/bookings/${id}`, input);
  }

  resendBooking(id: number) {
    return this.http.post<{ ok: boolean }>(`/api/admin/bookings/${id}/resend`, {});
  }

  sendPrecheckin(id: number) {
    return this.http.post<{ ok: boolean }>(`/api/admin/bookings/${id}/pre-check-in`, {});
  }

  deleteBooking(id: number) {
    return this.http.delete<{ ok: boolean }>(`/api/admin/bookings/${id}`);
  }

  bookingPdf(id: number) {
    return this.http.get(`/api/admin/bookings/${id}/pdf`, { responseType: 'blob' });
  }
}
