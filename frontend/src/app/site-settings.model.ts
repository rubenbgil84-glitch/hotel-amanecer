export const SITE_SETTING_DEFAULTS = {
  site_name: 'Hotel amanecer en campos',
  site_phone: '+34979811099',
  site_mobile_phone: '',
  site_email: '',
  breakfast_price: '5',
  pets_price: '10',
  site_address: 'Calle Fuente Nueva, 5, 34449 Población de Campos, Palencia',
  site_map_url: 'https://www.google.com/maps/search/?api=1&query=Hotel%20Amanecer%20en%20Campos%20Calle%20Fuente%20Nueva%2C%205%2C%2034449%20Poblaci%C3%B3n%20de%20Campos%2C%20Palencia',
  hotel_stars: '0',
  social_links: '[{"id":"instagram","name":"Instagram","url":"","enabled":false},{"id":"facebook","name":"Facebook","url":"","enabled":false},{"id":"x","name":"X","url":"","enabled":false}]',
  reception_24h: 'false',
  reception_opening_time: '08:00',
  reception_closing_time: '22:00',
  brand_tagline: 'UN REFUGIO CON HISTORIA',
  footer_tagline: 'Un refugio tranquilo para descubrir cada lugar a tu manera.',
  hero_eyebrow: 'Una estancia para recordar',
  hero_title: 'Hay lugares que invitan a quedarse.',
  hero_description: 'Encuentra tu pausa en un hotel pensado para disfrutar sin mirar el reloj.',
  hero_link_label: 'Explora las habitaciones',
  hero_image_path: '/api/web-images/hotel.png',
  promise_1: 'Descanso sin prisas',
  promise_2: 'Espacios con personalidad',
  promise_3: 'Atención cercana',
  intro_image_path: '/api/web-images/hotel.png',
  intro_image_alt: 'Interior cálido y luminoso, con materiales naturales y detalles cuidados',
  intro_note_top: 'Tu tiempo,',
  intro_note_bottom: 'a tu manera.',
  intro_eyebrow: 'Bienvenido a Hotel amanecer en campos',
  intro_title: 'Sentirse lejos de todo, estando justo donde quieres.',
  intro_description: 'Hemos creado un lugar sereno al que llegar, dejar las maletas y empezar a disfrutar. Cada detalle está pensado para que te sientas a gusto desde el primer momento.',
  intro_link_label: 'Conoce el hotel',
  experience_image_path: '/api/web-images/hotel.png',
  experience_image_alt: 'Una habitación acogedora bañada por la luz de la tarde',
  experience_eyebrow: 'Pequeños detalles, grandes días',
  experience_title: 'Lo mejor de viajar también sucede dentro del hotel.',
  experience_description: 'Despierta con calma, disfruta de espacios cómodos y cuenta con un equipo dispuesto a hacerte sentir como en casa.',
  experience_point_1: 'Un descanso de verdad',
  experience_point_2: 'Espacios para compartir',
  experience_point_3: 'Recomendaciones de quienes conocen el lugar',
  experience_link_label: 'Encuentra tu habitación',
  testimonials_eyebrow: 'Palabras que nos acompañan',
  testimonials_title: 'Quienes vienen, se llevan algo más.',
  last_call_eyebrow: 'Tu próxima escapada empieza aquí',
  last_call_title: '¿Ya sabes cuándo vienes?',
  about_hero_eyebrow: 'Hotel rural · Población de Campos',
  about_hero_title: 'Tu casa en el Camino.',
  about_hero_description: 'Un lugar acogedor para descansar, disfrutar de la buena mesa y descubrir la Tierra de Campos palentina.',
  about_welcome_eyebrow: 'Bienvenidos a Amanecer en Campos',
  about_welcome_title: 'Un alto en el camino, una estancia para recordar.',
  about_welcome_description: 'Estamos en Población de Campos, en pleno Camino de Santiago. Recibimos a peregrinos, familias y viajeros que quieren conocer Palencia con un trato cercano y una estancia cómoda. El hotel cuenta con 14 habitaciones equipadas para descansar después de una etapa o de un día explorando la zona.',
  about_services_eyebrow: 'Más que alojamiento',
  about_services_title: 'Pequeñas ayudas que hacen el viaje más fácil.',
  about_services_description: 'Desde una comida casera hasta una mano con el equipaje: cuéntanos qué necesitas y te informaremos de las opciones disponibles.',
  about_services_note: 'Algunos servicios y actividades requieren reserva previa o pueden tener un coste adicional. Consúltanos antes de tu llegada.',
  about_services: '[{"title":"Cocina casera","description":"Comidas y cenas con recetas tradicionales, además de opciones que puedes consultar con el hotel."},{"title":"Apoyo al peregrino","description":"Información sobre el Camino y posibilidad de organizar el transporte de mochilas hacia la siguiente etapa."},{"title":"Patio y terraza","description":"Un espacio al aire libre para parar un rato y disfrutar de un momento tranquilo."},{"title":"Planes al aire libre","description":"Rutas a pie o en bicicleta, paseos a caballo y propuestas para conocer el entorno."},{"title":"Lavandería","description":"Consulta el servicio de lavado y planchado durante tu estancia."},{"title":"Un viaje a tu medida","description":"El equipo puede orientarte sobre excursiones y lugares de interés cercanos."}]',
  privacy_policy_title: 'Política de privacidad',
  privacy_policy_content: 'Los datos se utilizan para gestionar reservas, estancias y obligaciones legales. Opiniones y promociones requieren los consentimientos correspondientes. Contacto para ejercer derechos: [CORREO DEL RESPONSABLE].',
  legal_notice_title: 'Aviso legal',
  legal_notice_content: 'Titular legal, NIF, registro y correo: [COMPLETAR]. Las reservas se rigen por las condiciones mostradas durante la contratación y en su confirmación. Verifique los datos legales antes de publicar.',
  cookies_policy_title: 'Política de cookies',
  cookies_policy_content: 'No se activa analítica ni publicidad. La elección del aviso se guarda localmente durante 180 días; la búsqueda se conserva durante la sesión y la administración usa una cookie técnica. Puedes borrar estos datos desde el navegador.',
} as const;

export type SiteSettingKey = keyof typeof SITE_SETTING_DEFAULTS;
export type SiteSettings = Record<SiteSettingKey, string>;

export interface PublishedTestimonial {
  display_name: string;
  message: string;
  fecha: string;
  rating: number;
  travel_type: string;
  travel_type_other: string | null;
}

export interface TestimonialInvitation {
  guest_name: string;
  room_name: string;
}

export interface AdminTestimonial extends PublishedTestimonial {
  id: number;
  submitted_at: string;
  is_approved: boolean;
  moderated_at: string | null;
  guest_name: string;
  email: string;
  reservation_code: string;
  room_name: string;
}

export interface TestimonialInput {
  display_name: string;
  rating: number;
  message: string;
  travel_type: string;
  travel_type_other: string;
  publication_consent: boolean;
}

export interface SiteClosure {
  id: number;
  start_date: string;
  end_date: string;
  reason: string;
}

export interface SiteClosureInput {
  start_date: string;
  end_date: string;
  reason: string;
}

export interface AboutService {
  title: string;
  description: string;
}

export interface SocialLink {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

function parseJsonArray(value: string, label: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new TypeError('Se esperaba una lista.');
    return parsed;
  } catch (error) {
    console.error(`La lista de ${label} no tiene un formato JSON válido.`, error);
    return [];
  }
}

export function parseAboutServices(value: string): AboutService[] {
  return parseJsonArray(value, 'servicios').filter(
      (entry): entry is AboutService =>
        typeof entry === 'object' &&
        entry !== null &&
        'title' in entry &&
        typeof entry.title === 'string' &&
        'description' in entry &&
        typeof entry.description === 'string',
    );
}

export function parseConfiguredSocialLinks(value: string): SocialLink[] {
  return parseJsonArray(value, 'redes sociales').filter(
      (entry): entry is SocialLink =>
        typeof entry === 'object' &&
        entry !== null &&
        'id' in entry &&
        typeof entry.id === 'string' &&
        'name' in entry &&
        typeof entry.name === 'string' &&
        'url' in entry &&
        typeof entry.url === 'string' &&
        'enabled' in entry &&
        typeof entry.enabled === 'boolean',
    );
}

export function parseSocialLinks(value: string): SocialLink[] {
  return parseConfiguredSocialLinks(value).filter(
    (social) => social.enabled && isWebUrl(social.url),
  );
}

function isWebUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
