import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AdminTestimonial,
  PublishedTestimonial,
  SiteClosure,
  SiteClosureInput,
  SiteSettings,
  TestimonialInput,
  TestimonialInvitation,
} from './site-settings.model';

export interface Room {
  id: number;
  name: string;
  slug: string;
  description: string;
  price_per_night: number;
  pricing_type: 'standard' | 'rural_house';
  catalog_category: string;
  single_price: number;
  double_price: number;
  extra_bed_price: number;
  capacity: number;
  features: string[];
  image_url: string | null;
  is_active?: boolean;
}

export interface RoomImage {
  id: number;
  image_url: string;
  position: number;
}

export interface GalleryAlbum {
  id: string;
  slug: string;
  title: string;
  description: string;
  allow_comments: boolean;
  allow_uploads: boolean;
  created_at: string;
  updated_at: string;
}

export interface GalleryAlbumSummary extends GalleryAlbum {
  photo_count: number;
  latest_upload_at: string | null;
  cover_url: string | null;
}

export interface GalleryPhoto {
  id: string;
  image_url: string;
  caption: string;
  submitted_by: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  moderated_at: string | null;
}

export interface PublishedGalleryPhoto {
  id: string;
  image_url: string;
  caption: string;
  created_at: string;
}

export interface GalleryComment {
  id: string;
  display_name: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  moderated_at: string | null;
}

export interface PublishedGalleryComment {
  id: string;
  display_name: string;
  message: string;
  created_at: string;
}

export interface GalleryAlbumDetail extends GalleryAlbum {
  photos: PublishedGalleryPhoto[];
  comments: PublishedGalleryComment[];
}

export interface AdminGalleryAlbum extends GalleryAlbumSummary {
  pending_photo_count: number;
  pending_comment_count: number;
}

export interface AdminGalleryAlbumDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  allow_comments: boolean;
  allow_uploads: boolean;
  created_at: string;
  updated_at: string;
  photos: GalleryPhoto[];
  comments: GalleryComment[];
}
export interface RoomAvailabilityBlock {
  id: number;
  room_id: number;
  start_date: string;
  end_date: string;
  reason: string;
}

export interface VatRate {
  id: number;
  effective_from: string;
  rate: number;
}

export interface BookingVatBreakdown {
  effective_from: string;
  rate: number;
  gross: number;
  discount: number;
  taxable_base: number;
  vat: number;
  total: number;
}

export interface AdminRoom extends Room {
  is_active: boolean;
  availability_blocks: RoomAvailabilityBlock[];
}

export interface AdminBooking {
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
  breakfast: boolean;
  pets: boolean;
  notes: string;
  total: number;
  room_subtotal: number;
  breakfast_total: number;
  pets_total: number;
  vat_breakdown: BookingVatBreakdown[] | null;
  discount_code: string | null;
  discount_amount: number;
  discount_percent: number;
  arrival_pin: string;
  reservation_code: string;
  created_at: string;
  room_name: string;
  room_description: string;
  room_features: string[];
  room_price_per_night: number;
  precheckin_completed_at: string | null;
  precheckin_identity_document: string | null;
  phone_mobile: string | null;
  precheckin_email: string | null;
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
  document_support_number: string | null;
  document_issue_date: string | null;
  document_expiry_date: string | null;
  phone_landline: string | null;
  traveler_count: number | null;
  minor_relationships: string | null;
  arrival_time: string | null;
  departure_time: string | null;
  preferred_bed: string | null;
  terms_accepted_at: string | null;
  marketing_consent: boolean | null;
  signature: string | null;
  document_front_path: string | null;
  document_back_path: string | null;
}

export interface AdminBookingSummary {
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
  breakfast: boolean;
  pets: boolean;
  notes: string;
  arrival_pin: string;
  reservation_code: string;
  room_name: string;
  precheckin_completed_at: string | null;
}

export interface AdminBookingInput {
  room_id: number;
  guest_name: string;
  identity_document: string;
  phone: string;
  email: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  breakfast: boolean;
  pets: boolean;
  notes: string;
  remove_precheckin: boolean;
}

export interface RoomInput {
  name: string;
  description: string;
  price_per_night: number;
  pricing_type: 'standard' | 'rural_house';
  catalog_category: string;
  single_price: number;
  double_price: number;
  extra_bed_price: number;
  capacity: number;
  features: string[];
  is_active: boolean;
  image_data_url?: string;
}

export interface BookingInput {
  room_id: number;
  guest_name: string;
  identity_document: string;
  phone: string;
  email: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  breakfast: boolean;
  pets: boolean;
  notes: string;
  discount_code?: string;
}

export interface ContactInput {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  privacy_accepted: boolean;
}

export interface ContactConversationEntry {
  role: 'contact' | 'hotel';
  body: string;
  sent_at: string;
}

export interface AdminContactMessage {
  id: number;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: ContactConversationEntry[];
  status: 'pending' | 'responded';
  created_at: string;
}

export interface AdminCredentials {
  username: string;
  password: string;
}

export interface AvailabilitySearch {
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
}

export interface BookingResult {
  pin: string;
  reference: string;
  nights: number;
  total: number;
  breakfast_total: number;
  pets_total: number;
  vat_breakdown: BookingVatBreakdown[] | null;
  discount_code: string | null;
  discount_amount: number;
}

export interface DiscountDateRange {
  id?: number;
  start_date: string;
  end_date: string;
}

export interface DiscountCode {
  id: number;
  code: string;
  discount_percent: number;
  minimum_amount: number;
  starts_on: string | null;
  ends_on: string | null;
  max_uses: number | null;
  is_active: boolean;
  usage_count: number;
  excluded_dates: DiscountDateRange[];
  created_at: string;
}

export interface DiscountCodeInput {
  code: string;
  discount_percent: number;
  minimum_amount: number;
  starts_on: string | null;
  ends_on: string | null;
  max_uses: number | null;
  is_active: boolean;
  excluded_dates: DiscountDateRange[];
}

export interface DiscountRecipient {
  guest_name: string;
  email: string;
  check_in: string;
}

export interface DiscountEmailResult {
  sent: string[];
  failed: Array<{ email: string; reason: string }>;
}

export interface DiscountCodeValidationInput {
  code: string;
  room_id: number;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  breakfast: boolean;
  pets: boolean;
}

export interface DiscountCodeValidation {
  code: string;
  discount_percent: number;
  discount_amount: number;
  total: number;
}

export interface ReservationDetails {
  reservation_code: string;
  arrival_pin: string;
  guest_name: string;
  identity_document: string;
  email: string;
  phone: string;
  notes: string;
  created_at: string;
  room_name: string;
  room_description: string;
  room_capacity: number;
  room_features: string[];
  room_image_url: string | null;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  breakfast: boolean;
  pets: boolean;
  total: number;
  room_subtotal: number;
  breakfast_total: number;
  pets_total: number;
  vat_breakdown: BookingVatBreakdown[] | null;
  discount_code: string | null;
  discount_amount: number;
  precheckin_completed_at: string | null;
  precheckin_identity_document: string | null;
  phone_mobile: string | null;
  precheckin_email: string | null;
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
  document_support_number: string | null;
  document_issue_date: string | null;
  document_expiry_date: string | null;
  phone_landline: string | null;
  traveler_count: number | null;
  minor_relationships: string | null;
  arrival_time: string | null;
  departure_time: string | null;
  preferred_bed: string | null;
  precheckin_available: boolean;
  precheckin_available_from: string;
  precheckin_available_until: string;
}

export interface PreCheckinBooking {
  reservation_code: string;
  guest_name: string;
  identity_document: string;
  email: string;
  phone: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  room_capacity: number;
  breakfast: boolean;
  pets: boolean;
}

export interface PreCheckinInput {
  first_name: string;
  first_surname: string;
  second_surname: string;
  birth_date: string;
  sex: string;
  nationality: string;
  address: string;
  city: string;
  country: string;
  document_type: string;
  identity_document: string;
  document_support_number: string;
  document_issue_date: string;
  document_expiry_date: string;
  identity_document_front: string;
  identity_document_back: string | null;
  phone_landline: string;
  phone_mobile: string;
  email: string;
  traveler_count: number;
  minor_relationships: string;
  arrival_time: string;
  departure_time: string;
  preferred_bed: string;
  terms_accepted: boolean;
  marketing_consent: boolean;
  digital_signature: string;
}

// Todas las llamadas son relativas (/api/...): en desarrollo las reenvía el proxy de Angular al gateway.
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  rooms() {
    return this.http.get<Room[]>('/api/rooms');
  }

  galleryAlbums() {
    return this.http.get<GalleryAlbumSummary[]>('/api/gallery/albums');
  }

  galleryAlbum(slug: string) {
    return this.http.get<GalleryAlbumDetail>(`/api/gallery/albums/${encodeURIComponent(slug)}`);
  }

  submitGalleryComment(slug: string, input: { display_name: string; message: string }) {
    return this.http.post<{ ok: boolean; message: string }>(
      `/api/gallery/albums/${encodeURIComponent(slug)}/comments`,
      input,
    );
  }

  uploadGalleryPhoto(slug: string, input: { image_data_url: string; submitted_by: string; caption: string }) {
    return this.http.post<{ ok: boolean; status: GalleryPhoto['status']; message: string }>(
      `/api/gallery/albums/${encodeURIComponent(slug)}/photos`,
      input,
    );
  }

  adminGalleryAlbums() {
    return this.http.get<AdminGalleryAlbum[]>('/api/admin/gallery/albums');
  }

  adminGalleryAlbum(id: string) {
    return this.http.get<AdminGalleryAlbumDetail>(`/api/admin/gallery/albums/${id}`);
  }

  createGalleryAlbum(input: Pick<GalleryAlbum, 'title' | 'description' | 'allow_comments' | 'allow_uploads'>) {
    return this.http.post<GalleryAlbum>('/api/admin/gallery/albums', input);
  }

  updateGalleryAlbum(id: string, input: Pick<GalleryAlbum, 'title' | 'description' | 'allow_comments' | 'allow_uploads'>) {
    return this.http.put<GalleryAlbum>(`/api/admin/gallery/albums/${id}`, input);
  }

  deleteGalleryAlbum(id: string) {
    return this.http.delete<{ ok: boolean }>(`/api/admin/gallery/albums/${id}`);
  }

  uploadAdminGalleryPhoto(id: string, input: { image_data_url: string; caption: string }) {
    return this.http.post<GalleryPhoto>(`/api/admin/gallery/albums/${id}/photos`, input);
  }

  moderateGalleryPhoto(id: string, status: 'approved' | 'rejected') {
    return this.http.patch<{ id: string; status: GalleryPhoto['status']; moderated_at: string }>(
      `/api/admin/gallery/photos/${id}`,
      { status },
    );
  }

  moderateGalleryComment(id: string, status: 'approved' | 'rejected') {
    return this.http.patch<{ id: string; status: GalleryComment['status']; moderated_at: string }>(
      `/api/admin/gallery/comments/${id}`,
      { status },
    );
  }

  deleteGalleryPhoto(id: string) {
    return this.http.delete<{ ok: boolean }>(`/api/admin/gallery/photos/${id}`);
  }

  availableRooms(search: AvailabilitySearch) {
    return this.http.get<Room[]>('/api/rooms/availability', {
      params: {
        check_in: search.check_in,
        check_out: search.check_out,
        adults: search.adults,
        children: search.children,
      },
    });
  }

  book(input: BookingInput) {
    return this.http.post<BookingResult>('/api/bookings', input);
  }

  sendContact(input: ContactInput) {
    return this.http.post<{ ok: boolean }>('/api/contact', input);
  }

  adminSession() {
    return this.http.get<{ authenticated: boolean }>('/api/admin/session');
  }

  siteSettings() {
    return this.http.get<SiteSettings>('/api/site-settings');
  }

  adminSiteSettings() {
    return this.http.get<SiteSettings>('/api/admin/site-settings');
  }

  vatRates() {
    return this.http.get<VatRate[]>('/api/vat-rates');
  }

  adminVatRates() {
    return this.http.get<VatRate[]>('/api/admin/vat-rates');
  }

  createVatRate(input: Pick<VatRate, 'effective_from' | 'rate'>) {
    return this.http.post<VatRate>('/api/admin/vat-rates', input);
  }

  updateVatRate(id: number, input: Pick<VatRate, 'effective_from' | 'rate'>) {
    return this.http.put<VatRate>(`/api/admin/vat-rates/${id}`, input);
  }

  deleteVatRate(id: number) {
    return this.http.delete<{ ok: boolean }>(`/api/admin/vat-rates/${id}`);
  }

  saveSiteSettings(
    settings: SiteSettings,
    images: Partial<Record<'hero_image_data_url' | 'intro_image_data_url' | 'experience_image_data_url', string>> = {},
  ) {
    return this.http.put<SiteSettings>('/api/admin/site-settings', { ...settings, ...images });
  }

  adminClosures(upcomingOnly = false) {
    return this.http.get<SiteClosure[]>('/api/admin/closures', {
      params: upcomingOnly ? { upcoming: 'true' } : {},
    });
  }

  createClosure(input: SiteClosureInput) {
    return this.http.post<SiteClosure>('/api/admin/closures', input);
  }

  updateClosure(id: number, input: SiteClosureInput) {
    return this.http.put<SiteClosure>(`/api/admin/closures/${id}`, input);
  }

  deleteClosure(id: number) {
    return this.http.delete<{ ok: boolean }>(`/api/admin/closures/${id}`);
  }

  testimonials() {
    return this.http.get<PublishedTestimonial[]>('/api/testimonials');
  }

  testimonialInvitation(token: string) {
    return this.http.get<TestimonialInvitation>(
      `/api/testimonial-invitations/${encodeURIComponent(token)}`,
    );
  }

  submitTestimonial(token: string, input: TestimonialInput) {
    return this.http.post<{ ok: boolean }>(
      `/api/testimonial-invitations/${encodeURIComponent(token)}`,
      input,
    );
  }

  adminTestimonials() {
    return this.http.get<AdminTestimonial[]>('/api/admin/testimonials');
  }

  moderateTestimonial(id: number, approved: boolean) {
    return this.http.patch<{ ok: boolean }>(`/api/admin/testimonials/${id}`, { approved });
  }

  adminLogin(credentials: AdminCredentials) {
    return this.http.post<{ ok: boolean }>('/api/admin/login', credentials);
  }

  adminLogout() {
    return this.http.post<{ ok: boolean }>('/api/admin/logout', {});
  }

  adminRooms() {
    return this.http.get<AdminRoom[]>('/api/admin/rooms');
  }

  createRoom(input: RoomInput) {
    return this.http.post<AdminRoom>('/api/admin/rooms', input);
  }

  updateRoom(id: number, input: RoomInput) {
    return this.http.put<AdminRoom>(`/api/admin/rooms/${id}`, input);
  }

  deleteRoom(id: number) {
    return this.http.delete<{ ok: boolean }>(`/api/admin/rooms/${id}`);
  }

  bulkRooms(input: {
    room_ids: number[];
    action: 'set_prices' | 'activate' | 'deactivate' | 'delete';
    single_price?: number;
    double_price?: number;
    extra_bed_price?: number;
  }) {
    return this.http.post<{ updated?: number; deleted?: number[]; retained?: Array<{ id: number; name: string }> }>(
      '/api/admin/rooms/bulk',
      input,
    );
  }

  adminDiscountCodes() {
    return this.http.get<DiscountCode[]>('/api/admin/discount-codes');
  }

  createDiscountCode(input: DiscountCodeInput) {
    return this.http.post<{ id: number }>('/api/admin/discount-codes', input);
  }

  updateDiscountCode(id: number, input: DiscountCodeInput) {
    return this.http.put<{ ok: boolean }>(`/api/admin/discount-codes/${id}`, input);
  }

  deleteDiscountCode(id: number) {
    return this.http.delete<{ ok: boolean }>(`/api/admin/discount-codes/${id}`);
  }

  discountCodeRecipients(id: number) {
    return this.http.get<DiscountRecipient[]>(`/api/admin/discount-codes/${id}/recipients`);
  }

  sendDiscountCode(id: number, emails: string[]) {
    return this.http.post<DiscountEmailResult>(`/api/admin/discount-codes/${id}/send`, { emails });
  }

  validateDiscountCode(input: DiscountCodeValidationInput) {
    return this.http.post<DiscountCodeValidation>('/api/discount-codes/validate', input);
  }

  addRoomAvailabilityBlock(id: number, input: Omit<RoomAvailabilityBlock, 'id' | 'room_id'>) {
    return this.http.post<RoomAvailabilityBlock>(`/api/admin/rooms/${id}/availability-blocks`, input);
  }

  updateRoomAvailabilityBlock(roomId: number, blockId: number, input: Omit<RoomAvailabilityBlock, 'id' | 'room_id'>) {
    return this.http.put<RoomAvailabilityBlock>(`/api/admin/rooms/${roomId}/availability-blocks/${blockId}`, input);
  }

  deleteRoomAvailabilityBlock(roomId: number, blockId: number) {
    return this.http.delete<{ ok: boolean }>(`/api/admin/rooms/${roomId}/availability-blocks/${blockId}`);
  }

  reservationDetails(token: string) {
    return this.http.get<ReservationDetails>(`/api/reservations/${encodeURIComponent(token)}`);
  }

  preCheckin(token: string) {
    return this.http.get<PreCheckinBooking>(`/api/pre-check-in/${encodeURIComponent(token)}`);
  }

  submitPreCheckin(token: string, input: PreCheckinInput) {
    return this.http.post<{ ok: boolean }>(`/api/pre-check-in/${encodeURIComponent(token)}`, input);
  }
}
