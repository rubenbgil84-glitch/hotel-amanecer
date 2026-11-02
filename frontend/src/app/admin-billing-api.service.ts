import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AdminBookingSummary } from './api.service';

export interface BillingDocumentSummary {
  id: number;
  booking_id: number;
  reservation_code: string;
  guest_name: string;
  document_type: 'invoice' | 'delivery_note';
  document_number: string | null;
  total: number;
  created_at: string | null;
}

export interface BillingInput {
  booking_id: number;
  document_type: 'invoice' | 'delivery_note';
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminBillingApiService {
  private readonly http = inject(HttpClient);

  /**
   * Obtiene el listado general de reservas con sus datos de facturación y albaranes asociados,
   * aplicando opcionalmente los filtros de búsqueda por texto y estado de emisión.
   */
  getBillingData(filters?: { search?: string; invoice?: string; delivery?: string }) {
    let params = new HttpParams();
    if (filters?.search) {
      params = params.set('search', filters.search);
    }
    if (filters?.invoice) {
      params = params.set('invoice', filters.invoice);
    }
    if (filters?.delivery) {
      params = params.set('delivery', filters.delivery);
    }

    return this.http.get<AdminBookingSummary[]>('/api/admin/billing', { params });
  }

  /**
   * Emite de forma correlativa e independiente una Factura o un Albarán para la reserva.
   */
  generateDocument(input: BillingInput) {
    return this.http.post<{ ok: boolean; document_number: string; id: number }>(
      '/api/admin/billing',
      input
    );
  }

  /**
   * Obtiene el flujo binario (blob) del archivo PDF correspondiente a la factura o albarán generado.
   */
  downloadDocumentPdf(id: number, type: 'invoice' | 'delivery_note') {
    return this.http.get(`/api/admin/billing/${id}/pdf`, {
      params: { type },
      responseType: 'blob',
    });
  }
  resendDocumentPdf(bookingId: number, type: 'invoice' | 'delivery_note') {
    return this.http.post<{ ok: boolean }>(`/api/admin/billing/${bookingId}/resend`, { type });
  }
}