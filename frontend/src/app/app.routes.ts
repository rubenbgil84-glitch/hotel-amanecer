import { Routes } from '@angular/router';
import { Reservas } from './componentes/reservas/reservas.component';
import { NuevaReserva } from './componentes/reservas/nueva-reserva.component';
import { PreCheckIn } from './componentes/reservas/pre-check-in.component';
import { SobreNosotros } from './componentes/sobre-nosotros/sobre-nosotros.component';
import { LegalPage } from './componentes/legal-page.component';
import { adminGuard } from './componentes/administracion/admin.guard';


export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./componentes/inicio/inicio.component').then((module) => module.Home),
    title: 'Hotel amanecer en campos',
  },
  { path: 'conocenos', component: SobreNosotros, title: 'Conoce el hotel · Hotel amanecer en campos' },
  {
    path: 'contacto',
    loadComponent: () => import('./componentes/contacto/contacto.component').then((module) => module.Contacto),
    title: 'Contacto · Hotel amanecer en campos',
  },
  {
    path: 'habitaciones',
    loadComponent: () => import('./componentes/habitaciones/habitaciones.component').then((module) => module.Rooms),
    title: 'Habitaciones · Hotel amanecer en campos',
  },
  {
    path: 'casa-rural',
    loadComponent: () => import('./componentes/habitaciones/habitaciones.component').then((module) => module.Rooms),
    title: 'Casa rural · Hotel amanecer en campos',
  },
  {
    path: 'galeria',
    loadComponent: () => import('./componentes/galeria/galeria.component').then((module) => module.Galeria),
    title: 'Galería · Hotel amanecer en campos',
  },
  {
    path: 'galeria/:slug',
    loadComponent: () => import('./componentes/galeria/galeria.component').then((module) => module.Galeria),
    title: 'Álbum de fotos · Hotel amanecer en campos',
  },
  { path: 'reservas', component: Reservas, title: 'Disponibilidad · Hotel amanecer en campos' },
  { path: 'reservar', component: NuevaReserva, title: 'Reservar habitación · Hotel amanecer en campos' },
  {
    path: 'reserva/:token',
    loadComponent: () => import('./componentes/reservas/reserva-detalle.component').then((module) => module.ReservaDetalle),
    title: 'Tu reserva · Hotel amanecer en campos',
  },
  { path: 'pre-check-in', component: PreCheckIn, title: 'Pre-check-in · Hotel amanecer en campos' },
  { path: 'politica-privacidad', component: LegalPage, data: { policy: 'privacy' }, title: 'Política de privacidad' },
  { path: 'aviso-legal', component: LegalPage, data: { policy: 'legal' }, title: 'Aviso legal' },
  { path: 'politica-cookies', component: LegalPage, data: { policy: 'cookies' }, title: 'Política de cookies' },
  {
    path: 'testimonio/:token',
    loadComponent: () => import('./componentes/reservas/testimonial-form.component').then((module) => module.TestimonialForm),
    title: 'Comparte tu experiencia · Hotel amanecer en campos',
  },
  {
    path: 'carmen-admin',
    children: [
      {
        path: '',
        loadComponent: () => import('./componentes/administracion/admin-login.component').then((module) => module.AdminLogin),
        title: 'Acceso de administración · Hotel amanecer en campos',
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./componentes/administracion/admin-dashboard.component').then((module) => module.AdminDashboard),
        canActivate: [adminGuard],
        title: 'Administración · Hotel amanecer en campos',
      },
      {
        path: 'habitaciones',
        loadComponent: () => import('./componentes/administracion/administracion-habitaciones.component').then((module) => module.AdministracionHabitaciones),
        canActivate: [adminGuard],
        title: 'Habitaciones',
      },
      {
        path: 'galeria',
        loadComponent: () => import('./componentes/administracion/admin-gallery.component').then((module) => module.AdminGallery),
        canActivate: [adminGuard],
        title: 'Galería de fotos',
      },
      {
        path: 'reservas',
        loadComponent: () => import('./componentes/administracion/admin-bookings.component').then((module) => module.AdminBookings),
        canActivate: [adminGuard],
        title: 'Reservas',
      },
      {
        path: 'mensajes',
        loadComponent: () => import('./componentes/administracion/admin-contact-messages.component').then((module) => module.AdminContactMessages),
        canActivate: [adminGuard],
        title: 'Mensajes de contacto',
      },
      {
        path: 'ses-hospedajes',
        loadComponent: () => import('./componentes/administracion/ses-hospedajes.component').then((module) => module.SesHospedajes),
        canActivate: [adminGuard],
        title: 'SES.Hospedajes',
      },
      {
        path: 'descuentos',
        loadComponent: () => import('./componentes/administracion/admin-discount-codes.component').then((module) => module.AdminDiscountCodes),
        canActivate: [adminGuard],
        title: 'Códigos de descuento',
      },
      {
        path: 'configuracion',
        loadComponent: () => import('./componentes/administracion/configuracion-sitio.component').then((module) => module.ConfiguracionSitio),
        canActivate: [adminGuard],
        title: 'Configuración del sitio',
      },
      {
        path: 'facturacion',
        loadComponent: () => import('./componentes/administracion/admin-billing.component').then((module) => module.AdminBilling),
        canActivate: [adminGuard],
        title: 'Facturación y Albaranes',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
