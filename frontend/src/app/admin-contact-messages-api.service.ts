import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AdminContactMessage } from './api.service';

export interface ContactMessageFilters {
  from_date?: string;
  to_date?: string;
  status?: 'all' | 'pending' | 'responded';
  search?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminContactMessagesApiService {
  private readonly http = inject(HttpClient);

  messages(filters: ContactMessageFilters) {
    let params = new HttpParams();
    if (filters.from_date) params = params.set('from_date', filters.from_date);
    if (filters.to_date) params = params.set('to_date', filters.to_date);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.search) params = params.set('search', filters.search);
    return this.http.get<AdminContactMessage[]>('/api/admin/contact-messages', { params });
  }

  reply(id: number, message: string) {
    return this.http.post<{ ok: boolean }>(`/api/admin/contact-messages/${id}/reply`, { message });
  }

  delete(id: number) {
    return this.http.delete<{ ok: boolean }>(`/api/admin/contact-messages/${id}`);
  }
}
