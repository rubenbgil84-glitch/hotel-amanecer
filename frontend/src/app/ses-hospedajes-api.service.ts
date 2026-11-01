import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

export interface SesTraveler {
  first_name: string;
  first_surname: string;
  second_surname: string;
  document_type: string;
  document_number: string;
  document_support: string;
  birth_date: string;
  nationality_code: string;
  sex: string;
  address: string;
  address_complement: string;
  municipality_code: string;
  municipality_name: string;
  postal_code: string;
  country_code: string;
  phone: string;
  phone2: string;
  email: string;
  relationship: string;
}

export interface SesBooking {
  id: number;
  room_id: number;
  guest_name: string;
  identity_document: string;
  email: string;
  phone: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  arrival_pin: string;
  reservation_code: string;
  room_name: string;
  precheckin_completed_at: string | null;
  first_name: string | null;
  first_surname: string | null;
  second_surname: string | null;
  sex: string | null;
  nationality: string | null;
  birth_date: string | null;
  home_address: string | null;
  home_city: string | null;
  home_country: string | null;
  document_type: string | null;
  precheckin_identity_document: string | null;
  document_support_number: string | null;
  phone_mobile: string | null;
  phone_landline: string | null;
  precheckin_email: string | null;
  payment_type: string | null;
  payment_date: string | null;
  payment_medium: string | null;
  payment_holder: string | null;
  card_expiry: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  primary_document_type: string | null;
  primary_nationality_code: string | null;
  primary_country_code: string | null;
  primary_municipality_code: string | null;
  primary_municipality_name: string | null;
  primary_postal_code: string | null;
  primary_address_complement: string | null;
  additional_travelers: SesTraveler[] | null;
}

export interface SesSettings {
  establishment_code: string;
  internet_available: boolean | null;
}

export interface SesBookingInput {
  payment_type: string;
  payment_date: string;
  payment_medium: string;
  payment_holder: string;
  card_expiry: string;
  check_in_time: string;
  check_out_time: string;
  primary_document_type: string;
  primary_nationality_code: string;
  primary_country_code: string;
  primary_municipality_code: string;
  primary_municipality_name: string;
  primary_postal_code: string;
  primary_address_complement: string;
  additional_travelers: SesTraveler[];
}

@Injectable({ providedIn: 'root' })
export class SesHospedajesApiService {
  private readonly http = inject(HttpClient);

  settings() {
    return this.http.get<SesSettings>('/api/admin/ses-hospedajes/settings');
  }

  updateSettings(settings: { establishment_code: string; internet_available: boolean }) {
    return this.http.put<{ ok: boolean }>('/api/admin/ses-hospedajes/settings', settings);
  }

  bookings(filters: { from_date?: string; to_date?: string; precheck?: string; search?: string }) {
    let params = new HttpParams();
    if (filters.from_date) params = params.set('from_date', filters.from_date);
    if (filters.to_date) params = params.set('to_date', filters.to_date);
    if (filters.precheck) params = params.set('precheck', filters.precheck);
    if (filters.search) params = params.set('search', filters.search);
    return this.http.get<SesBooking[]>('/api/admin/ses-hospedajes', { params });
  }

  updateBooking(id: number, input: SesBookingInput) {
    return this.http.put<{ ok: boolean }>(`/api/admin/ses-hospedajes/${id}`, input);
  }

  resetPrecheckin(id: number) {
    return this.http.post<{ ok: boolean }>(`/api/admin/ses-hospedajes/${id}/reset-pre-checkin`, {});
  }

  deletePrecheckin(id: number) {
    return this.http.delete<{ ok: boolean }>(`/api/admin/ses-hospedajes/${id}`);
  }

  generateXml(id: number) {
    return this.http.get(`/api/admin/ses-hospedajes/${id}/xml`, { responseType: 'blob' });
  }
}
