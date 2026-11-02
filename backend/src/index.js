import express from "express";
import cron from "node-cron";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {chmod, cp, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import pg from "pg";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import {
  downloadStorageObject,
  publicStorageUrl,
  removeStorageObjects,
  storageBuckets,
  uploadStorageObject,
} from "./supabase-storage.js";
import {calculateBookingPrice, calculateDiscount} from "./booking-pricing.js";
import {
  calculateVatBreakdown,
  normalizeLegacyVatAmounts,
} from "./booking-vat.js";
import {buildSesHospedajesXml} from "./ses-hospedajes-xml.js";
import {createMailgunMailer} from "./mailgun-mailer.js";

// PostgreSQL DATE values represent calendar dates, not instants. Keep them as
// YYYY-MM-DD strings so JSON serialization cannot shift them by the server TZ.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

const {
  BACKEND_PORT = process.env.PORT ?? "4000",
  DATABASE_URL,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  ADMIN_JWT_SECRET,
  MAILGUN_API_KEY,
  MAILGUN_DOMAIN = process.env.MAILGUN_SANDBOX_DOMAIN,
  MAILGUN_API_BASE_URL = process.env.MAILGUN_SANDBOX_URL,
  EMAIL_FROM,
  MAILGUN_TEST_RECIPIENT =
    process.env.EMAIL_TO?.match(/<([^>]+)>/)?.[1] ?? process.env.EMAIL_TO,
  HOTEL_CONTACT_EMAIL = EMAIL_FROM,
  HOTEL_DATA_DIR,
  FRONTEND_PORT = "4200",
  HOTEL_ADDRESS = "Calle Fuente Nueva, 5, 34449 Población de Campos, Palencia",
  HOTEL_MAP_URL = "https://www.google.com/maps/search/?api=1&query=Hotel%20Amanecer%20en%20Campos%20Calle%20Fuente%20Nueva%2C%205%2C%2034449%20Poblaci%C3%B3n%20de%20Campos%2C%20Palencia",
  HOTEL_PHONE = "+34979811099",
  HOTEL_CHECK_IN_TIME = "15:00",
  HOTEL_CHECK_OUT_TIME = "11:00",
} = process.env;
if (!DATABASE_URL) {
  throw new Error(
    "Falta DATABASE_URL. Configúrala en el .env de la raíz del proyecto.",
  );
}
const frontendUrl =
  process.env.FRONTEND_BASE_URL ?? `http://localhost:${FRONTEND_PORT}`;
if (!["http:", "https:"].includes(new URL(frontendUrl).protocol)) {
  throw new Error("FRONTEND_BASE_URL debe usar HTTP o HTTPS.");
}
if (!["http:", "https:"].includes(new URL(HOTEL_MAP_URL).protocol)) {
  throw new Error("HOTEL_MAP_URL debe usar HTTP o HTTPS.");
}
const pool = new pg.Pool({connectionString: DATABASE_URL});
const siteSettingDefaults = {
  site_name: "Hotel amanecer en campos",
  site_phone: HOTEL_PHONE,
  site_mobile_phone: "",
  site_email: "",
  breakfast_price: "5",
  pets_price: "10",
  site_address: HOTEL_ADDRESS,
  site_map_url: HOTEL_MAP_URL,
  hotel_stars: "0",
  social_links:
    '[{"id":"instagram","name":"Instagram","url":"","enabled":false},{"id":"facebook","name":"Facebook","url":"","enabled":false},{"id":"x","name":"X","url":"","enabled":false}]',
  reception_24h: "false",
  reception_opening_time: "08:00",
  reception_closing_time: "22:00",
  brand_tagline: "UN REFUGIO CON HISTORIA",
  footer_tagline: "Un refugio tranquilo para descubrir cada lugar a tu manera.",
  hero_eyebrow: "Una estancia para recordar",
  hero_title: "Hay lugares que invitan a quedarse.",
  hero_description:
    "Encuentra tu pausa en un hotel pensado para disfrutar sin mirar el reloj.",
  hero_link_label: "Explora las habitaciones",
  hero_image_path: publicStorageUrl("site/hotel.png"),
  promise_1: "Descanso sin prisas",
  promise_2: "Espacios con personalidad",
  promise_3: "Atención cercana",
  intro_image_path: publicStorageUrl("site/hotel.png"),
  intro_image_alt:
    "Interior cálido y luminoso, con materiales naturales y detalles cuidados",
  intro_note_top: "Tu tiempo,",
  intro_note_bottom: "a tu manera.",
  intro_eyebrow: "Bienvenido a Hotel amanecer en campos",
  intro_title: "Sentirse lejos de todo, estando justo donde quieres.",
  intro_description:
    "Hemos creado un lugar sereno al que llegar, dejar las maletas y empezar a disfrutar. Cada detalle está pensado para que te sientas a gusto desde el primer momento.",
  intro_link_label: "Conoce el hotel",
  experience_image_path: publicStorageUrl("site/hotel.png"),
  experience_image_alt:
    "Una habitación acogedora bañada por la luz de la tarde",
  experience_eyebrow: "Pequeños detalles, grandes días",
  experience_title: "Lo mejor de viajar también sucede dentro del hotel.",
  experience_description:
    "Despierta con calma, disfruta de espacios cómodos y cuenta con un equipo dispuesto a hacerte sentir como en casa.",
  experience_point_1: "Un descanso de verdad",
  experience_point_2: "Espacios para compartir",
  experience_point_3: "Recomendaciones de quienes conocen el lugar",
  experience_link_label: "Encuentra tu habitación",
  testimonials_eyebrow: "Palabras que nos acompañan",
  testimonials_title: "Quienes vienen, se llevan algo más.",
  last_call_eyebrow: "Tu próxima escapada empieza aquí",
  last_call_title: "¿Ya sabes cuándo vienes?",
  about_hero_eyebrow: "Hotel rural · Población de Campos",
  about_hero_title: "Tu casa en el Camino.",
  about_hero_description:
    "Un lugar acogedor para descansar, disfrutar de la buena mesa y descubrir la Tierra de Campos palentina.",
  about_welcome_eyebrow: "Bienvenidos a Amanecer en Campos",
  about_welcome_title: "Un alto en el camino, una estancia para recordar.",
  about_welcome_description:
    "Estamos en Población de Campos, en pleno Camino de Santiago. Recibimos a peregrinos, familias y viajeros que quieren conocer Palencia con un trato cercano y una estancia cómoda. El hotel cuenta con 14 habitaciones equipadas para descansar después de una etapa o de un día explorando la zona.",
  about_services_eyebrow: "Más que alojamiento",
  about_services_title: "Pequeñas ayudas que hacen el viaje más fácil.",
  about_services_description:
    "Desde una comida casera hasta una mano con el equipaje: cuéntanos qué necesitas y te informaremos de las opciones disponibles.",
  about_services_note:
    "Algunos servicios y actividades requieren reserva previa o pueden tener un coste adicional. Consúltanos antes de tu llegada.",
  about_services:
    '[{"title":"Cocina casera","description":"Comidas y cenas con recetas tradicionales, además de opciones que puedes consultar con el hotel."},{"title":"Apoyo al peregrino","description":"Información sobre el Camino y posibilidad de organizar el transporte de mochilas hacia la siguiente etapa."},{"title":"Patio y terraza","description":"Un espacio al aire libre para parar un rato y disfrutar de un momento tranquilo."},{"title":"Planes al aire libre","description":"Rutas a pie o en bicicleta, paseos a caballo y propuestas para conocer el entorno."},{"title":"Lavandería","description":"Consulta el servicio de lavado y planchado durante tu estancia."},{"title":"Un viaje a tu medida","description":"El equipo puede orientarte sobre excursiones y lugares de interés cercanos."}]',
  privacy_policy_title: "Política de privacidad",
  privacy_policy_content: `1. Responsable del tratamiento
El responsable es la persona o entidad titular de Hotel amanecer en campos. Antes de publicar esta política, complete y confirme la razón social o nombre completo del titular y su NIF: [RAZÓN SOCIAL / NOMBRE Y APELLIDOS] · [NIF]. Dirección: Calle Fuente Nueva, 5, 34449 Población de Campos, Palencia. Contacto para privacidad: [CORREO ELECTRÓNICO DEL RESPONSABLE].

2. Datos que podemos tratar
Según el uso del sitio, podemos tratar datos de contacto (nombre, correo y teléfono), datos necesarios para gestionar una reserva (documento identificativo, fechas, ocupación y preferencias), datos y documentación facilitados durante el pre-check-in, mensajes enviados mediante el formulario de contacto y opiniones que el huésped decida remitir. El consentimiento para recibir promociones y el consentimiento separado para publicar una opinión se registran cuando se otorgan.

3. Finalidades y bases del tratamiento
Gestionar solicitudes, reservas, pagos si correspondieran y la estancia, así como atender consultas, es necesario para aplicar medidas precontractuales o ejecutar el contrato solicitado. Los datos y comunicaciones exigidos para el registro de viajeros se tratan para cumplir las obligaciones legales aplicables. La publicación de una opinión identificada por el nombre elegido por el huésped se basa en su consentimiento específico. El envío de comunicaciones promocionales se basa únicamente en el consentimiento comercial afirmativo; puede retirarlo en cualquier momento solicitándolo al contacto de privacidad indicado arriba, sin afectar a los tratamientos anteriores a su retirada.

4. Destinatarios
No vendemos datos personales. Solo se comunicarán a proveedores que prestan servicios necesarios para operar el alojamiento o este sitio (por ejemplo, alojamiento tecnológico y correo electrónico), sujetos a las garantías correspondientes, y a autoridades u organismos públicos cuando exista una obligación legal, incluido el sistema de registro de viajeros que resulte aplicable. Indique aquí cualquier otro destinatario o proveedor relevante antes de publicar: [COMPLETAR SI PROCEDE].

5. Conservación
Conservaremos los datos durante el tiempo necesario para gestionar la solicitud, reserva y estancia. Los datos sujetos a obligaciones de registro, contables, fiscales o de otra naturaleza se conservarán durante los plazos exigidos por la normativa aplicable y, después, debidamente bloqueados cuando corresponda durante los plazos de prescripción. Los datos para promociones se utilizarán hasta que retire su consentimiento. Las opiniones se conservarán mientras permanezcan publicadas o hasta que solicite su retirada.

6. Derechos y reclamaciones
Puede solicitar el acceso, rectificación, supresión, oposición, limitación del tratamiento y, cuando proceda, portabilidad, así como retirar los consentimientos otorgados, escribiendo a [CORREO ELECTRÓNICO DEL RESPONSABLE] e indicando el derecho que desea ejercer. También puede reclamar ante la Agencia Española de Protección de Datos (www.aepd.es). Si no facilita los datos necesarios para una reserva o para cumplir una obligación legal, podría no ser posible prestar el servicio correspondiente.

7. Seguridad y cambios
Aplicamos medidas razonables para proteger la información y restringir su acceso. Ningún sistema de transmisión o almacenamiento puede garantizar seguridad absoluta. Podemos actualizar esta política para reflejar cambios legales o del servicio; publicaremos la versión vigente en esta página.

Esta información es un borrador general. El titular debe completar los campos entre corchetes y verificar que las finalidades, proveedores, plazos y obligaciones descritos se ajustan a la actividad real del establecimiento antes de publicarla.`,
  legal_notice_title: "Aviso legal",
  legal_notice_content: `1. Datos del titular
Este sitio web corresponde a Hotel amanecer en campos, con domicilio en Calle Fuente Nueva, 5, 34449 Población de Campos, Palencia. Titular legal: [RAZÓN SOCIAL / NOMBRE Y APELLIDOS]. NIF: [NIF]. Datos registrales, si procede: [REGISTRO Y DATOS DE INSCRIPCIÓN]. Teléfono: +34 979 811 099. Correo electrónico: [CORREO ELECTRÓNICO DEL TITULAR].

Los datos entre corchetes deben completarse con la información legal exacta del titular antes de publicar este aviso. No deben sustituirse por datos comerciales o aproximados.

2. Objeto y condiciones de uso
El sitio ofrece información sobre el establecimiento, sus alojamientos y servicios, y permite realizar solicitudes y reservas. El acceso al sitio implica utilizarlo conforme a la ley y a este aviso. La información disponible en la web es informativa; las condiciones concretas de cada reserva, incluidos precio, fechas, servicios y condiciones de modificación o cancelación, serán las que se muestren durante la contratación y en la confirmación remitida al huésped.

El usuario se compromete a facilitar información veraz, no utilizar el sitio de forma ilícita ni intentar perjudicar su funcionamiento o la seguridad de otros usuarios.

3. Propiedad intelectual e industrial
Los textos, fotografías, diseño, logotipos y demás elementos del sitio pertenecen a su titular o se utilizan con autorización. No se permite su reproducción, distribución o transformación con fines distintos del uso personal permitido por la ley sin autorización previa de quien ostente los derechos correspondientes.

4. Enlaces y disponibilidad
Los enlaces a sitios de terceros se ofrecen como ayuda. El titular no controla ni responde del contenido, disponibilidad o políticas de esos sitios. Se adoptan medidas razonables para mantener la web disponible y actualizada, pero no se garantiza la ausencia de interrupciones, errores o incidencias técnicas.

5. Responsabilidad y legislación
El titular no será responsable del uso contrario a este aviso que realicen los usuarios ni de daños derivados de circunstancias ajenas a su control, en los términos permitidos por la ley. Este aviso se rige por la legislación española, sin perjuicio de los derechos irrenunciables que correspondan a consumidores y usuarios.

6. Contacto y actualización
Para consultas sobre este sitio puede utilizar el teléfono indicado o escribir a [CORREO ELECTRÓNICO DEL TITULAR]. El titular podrá actualizar este aviso cuando resulte necesario; se aplicará la versión publicada en cada momento.

Este texto es un borrador general y no sustituye la revisión jurídica. Complete los campos entre corchetes y confirme los datos del titular, registro y condiciones efectivas del establecimiento antes de publicar.`,
  cookies_policy_title: "Política de cookies",
  cookies_policy_content:
    `1. Qué tecnologías utiliza este sitio
Actualmente no se activan cookies de analítica ni de publicidad. Para recordar la elección realizada en el aviso de cookies, el sitio guarda en el almacenamiento local del navegador la preferencia (aceptada o rechazada) y su fecha de caducidad durante 180 días. Esta información permite no mostrar de nuevo el aviso en cada visita y no se utiliza para identificarle con fines publicitarios.

El sitio también puede usar almacenamiento de sesión del navegador para conservar temporalmente los datos de una búsqueda de disponibilidad mientras se navega por el proceso de reserva. Este dato es funcional y no se utiliza para publicidad.

Al iniciar sesión en la administración se utiliza una cookie técnica de autenticación necesaria para mantener la sesión protegida. No se utiliza para seguimiento publicitario y caduca al finalizar el periodo de sesión configurado.

2. Elección y gestión
El aviso permite aceptar o rechazar las categorías opcionales. En la configuración actual no hay cookies opcionales de analítica o publicidad activas; por tanto, aceptar o rechazar no cambia las tecnologías técnicas necesarias descritas arriba. Puede volver a abrir el panel desde «Configurar cookies» en el pie de página. También puede borrar los datos del sitio desde la configuración de su navegador; esto puede cerrar la sesión o eliminar preferencias y búsquedas guardadas.

3. Información adicional
Las cookies y tecnologías de almacenamiento pueden cambiar si se incorporan nuevas funcionalidades o proveedores. Si se añaden tecnologías no necesarias, se actualizará esta política y se solicitará la elección que corresponda antes de activarlas. Para dudas sobre privacidad, consulte la política de privacidad o escriba a [CORREO ELECTRÓNICO DEL RESPONSABLE].

Este texto describe la configuración actualmente implementada. Revíselo si se incorporan herramientas, proveedores o cookies adicionales, y complete el contacto de privacidad antes de publicarlo.`,
};
const siteSettingKeys = Object.keys(siteSettingDefaults);
const bundledImageRoot = fileURLToPath(new URL("../assets/imagenes/", import.meta.url));
const imageStorageRoot = HOTEL_DATA_DIR ? resolve(HOTEL_DATA_DIR, "imagenes") : bundledImageRoot;
const documentStorageRoot = join(imageStorageRoot, "pre-checking");
const roomImageStorageRoot = join(imageStorageRoot, "habitaciones");
const webImageStorageRoot = join(imageStorageRoot, "web");
const backendStorageRoot = fileURLToPath(new URL("../", import.meta.url));
const contactSubmissions = new Map();
const contactRateLimitWindowMs = 15 * 60 * 1000;
const gallerySubmissions = new Map();
const galleryRateLimitWindowMs = 60 * 60 * 1000;
const gallerySchemaPath = fileURLToPath(
  new URL("../../db/gallery.sql", import.meta.url),
);
const adminLoginAttempts = new Map();
const adminSessionDurationSeconds = 8 * 60 * 60;
const adminLoginWindowMs = 15 * 60 * 1000;
const mailer = createMailgunMailer({
  apiKey: MAILGUN_API_KEY,
  domain: MAILGUN_DOMAIN,
  apiBaseUrl: MAILGUN_API_BASE_URL,
  testRecipient: MAILGUN_TEST_RECIPIENT,
});
async function prepareImageStorage() {
  await Promise.all([
    mkdir(documentStorageRoot, {recursive: true, mode: 0o755}),
    mkdir(roomImageStorageRoot, {recursive: true, mode: 0o755}),
    mkdir(webImageStorageRoot, {recursive: true, mode: 0o755}),
  ]);
  if (HOTEL_DATA_DIR) {
    await Promise.all([
      cp(join(bundledImageRoot, "habitaciones"), roomImageStorageRoot, {
        recursive: true,
        force: false,
        errorOnExist: false,
      }).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      }),
      cp(join(bundledImageRoot, "web"), webImageStorageRoot, {
        recursive: true,
        force: false,
        errorOnExist: false,
      }).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      }),
    ]);
  }
}
const app = express();
app.use(express.json({limit: "24mb"}));

const hashToken = (token) => createHash("sha256").update(token).digest("hex");
async function getVatRates(queryable = pool) {
  await queryable.query(
    `INSERT INTO vat_rates (effective_from, rate)
     VALUES ('1900-01-01', 10)
     ON CONFLICT (effective_from) DO NOTHING`,
  );
  const {rows} = await queryable.query(
    `SELECT id, effective_from::text AS effective_from, rate::float8 AS rate
       FROM vat_rates
      ORDER BY effective_from`,
  );
  return rows;
}

async function calculateStoredVat(queryable, checkIn, checkOut, pricing, discountAmount) {
  return calculateVatBreakdown({
    checkIn: toDateOnly(checkIn),
    checkOut: toDateOnly(checkOut),
    roomSubtotal: pricing.roomSubtotal,
    breakfastTotal: pricing.breakfastTotal,
    petsTotal: pricing.petsTotal,
    discountAmount,
    rates: await getVatRates(queryable),
  });
}

app.get("/api/vat-rates", async (_req, res, next) => {
  try {
    const rates = await getVatRates();
    res.set("Cache-Control", "no-store").json(rates);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/vat-rates", requireAdmin, async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store").json(await getVatRates());
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/vat-rates", requireAdmin, async (req, res, next) => {
  const {effective_from, rate} = req.body ?? {};
  if (!isDate(effective_from) || typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100)
    return res.status(400).json({errors: ["Indica una fecha y un porcentaje de IVA válidos (0–100)."]});
  try {
    const {rows} = await pool.query(
      `INSERT INTO vat_rates (effective_from, rate)
       VALUES ($1, $2)
       ON CONFLICT (effective_from) DO UPDATE SET rate = EXCLUDED.rate
       RETURNING id, effective_from::text AS effective_from, rate::float8 AS rate`,
      [effective_from, rate],
    );
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/vat-rates/:id", requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const {effective_from, rate} = req.body ?? {};
  if (!Number.isInteger(id) || id < 1 || !isDate(effective_from) || typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100)
    return res.status(400).json({errors: ["El tipo, el porcentaje o la fecha del IVA no son válidos."]});
  try {
    const {rows: earliestRates} = await pool.query(
      "SELECT id, effective_from::text AS effective_from FROM vat_rates ORDER BY effective_from LIMIT 1",
    );
    if (
      earliestRates[0]?.id === id &&
      String(earliestRates[0].effective_from).slice(0, 10) !== effective_from
    ) {
      return res.status(409).json({
        errors: ["No se puede cambiar la fecha del tipo de IVA inicial, porque debe cubrir todas las estancias."],
      });
    }
    const {rows} = await pool.query(
      `UPDATE vat_rates
          SET effective_from = $2, rate = $3
        WHERE id = $1
        RETURNING id, effective_from::text AS effective_from, rate::float8 AS rate`,
      [id, effective_from, rate],
    );
    if (!rows.length)
      return res.status(404).json({errors: ["No se ha encontrado el tipo de IVA."]});
    res.json(rows[0]);
  } catch (error) {
    if (error.code === "23505")
      return res.status(409).json({errors: ["Ya existe un tipo de IVA configurado para esa fecha."]});
    next(error);
  }
});

app.delete("/api/admin/vat-rates/:id", requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({errors: ["El tipo de IVA no es válido."]});
  try {
    const {rows: earliest} = await pool.query(
      "SELECT id FROM vat_rates ORDER BY effective_from LIMIT 1",
    );
    if (earliest[0]?.id === id)
      return res.status(409).json({errors: ["No se puede eliminar el primer tipo de IVA, porque es necesario para calcular reservas."]});
    const {rowCount} = await pool.query("DELETE FROM vat_rates WHERE id = $1", [id]);
    if (!rowCount)
      return res.status(404).json({errors: ["No se ha encontrado el tipo de IVA."]});
    res.json({ok: true});
  } catch (error) {
    next(error);
  }
});
async function readSiteSettings() {
  const {rows} = await pool.query(
    "SELECT setting_key, setting_value FROM site_settings",
  );
  const settings = {...siteSettingDefaults};
  for (const row of rows) {
    if (Object.hasOwn(siteSettingDefaults, row.setting_key)) {
      settings[row.setting_key] = row.setting_value;
    }
  }
  return settings;
}
const adminCookieName = "amanecer_admin_session";
const adminCookieSecure =
  new URL(frontendUrl).protocol === "https:" ||
  process.env.NODE_ENV === "production";
const adminCookieHeader = (token, maxAge) =>
  [
    `${adminCookieName}=${token}`,
    "Path=/api/admin",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    ...(adminCookieSecure ? ["Secure"] : []),
  ].join("; ");
const getCookieValue = (cookieHeader, name) => {
  const cookie = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie?.slice(name.length + 1) ?? null;
};
function clearExpiredAdminState(now = Date.now()) {
  for (const [key, entry] of adminLoginAttempts) {
    if (entry.resetAt <= now) adminLoginAttempts.delete(key);
  }
}
function isAdminJwtConfigured() {
  return (
    typeof ADMIN_JWT_SECRET === "string" &&
    Buffer.byteLength(ADMIN_JWT_SECRET) >= 32
  );
}
async function getAuthenticatedAdmin(req) {
  if (!isAdminJwtConfigured()) return null;
  const token = getCookieValue(req.headers.cookie, adminCookieName);
  if (!token) return null;

  let claims;
  try {
    claims = jwt.verify(token, ADMIN_JWT_SECRET, {
      audience: "hotel-admin",
      issuer: "hotel-amanecer",
    });
  } catch (error) {
    if (
      error instanceof jwt.JsonWebTokenError ||
      error instanceof jwt.TokenExpiredError
    )
      return null;
    throw error;
  }
  if (
    typeof claims === "string" ||
    !/^\d+$/.test(claims.sub ?? "") ||
    !Number.isInteger(claims.ver)
  )
    return null;

  const {rows} = await pool.query(
    `SELECT id, session_version
       FROM administradores
      WHERE id = $1 AND is_active = TRUE`,
    [claims.sub],
  );
  const admin = rows[0];
  return admin && admin.session_version === claims.ver ? admin : null;
}
async function requireAdmin(req, res, next) {
  try {
    if (!(await getAuthenticatedAdmin(req))) {
      return res
        .status(401)
        .json({errors: ["Debes iniciar sesión como administrador."]});
    }
    next();
  } catch (error) {
    next(error);
  }
}
function isSameOrigin(req) {
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    const requestOrigin = new URL(origin).origin;
    const allowedOrigins = new Set([new URL(frontendUrl).origin]);
    if (process.env.NODE_ENV !== "production") {
      allowedOrigins.add(`http://localhost:${FRONTEND_PORT}`);
      allowedOrigins.add(`http://127.0.0.1:${FRONTEND_PORT}`);
    }
    return allowedOrigins.has(requestOrigin);
  } catch {
    return false;
  }
}
function adminLoginRateLimitReached(ip) {
  clearExpiredAdminState();
  const now = Date.now();
  const entry = adminLoginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    adminLoginAttempts.set(ip, {count: 1, resetAt: now + adminLoginWindowMs});
    return false;
  }
  entry.count += 1;
  return entry.count > 5;
}
const formatDateForMessage = (date) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toDateOnly(date));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
};
const formatDateForEmail = (date) =>
  new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${toDateOnly(date)}T12:00:00Z`));
const formatCurrency = (amount) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
const newReservationCode = () =>
  `RESERV-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
const reservationDetailsUrl = (token) =>
  new URL(`/reserva/${encodeURIComponent(token)}`, frontendUrl);
const reservationMapPreviewUrl =
  "https://staticmap.openstreetmap.de/staticmap.php?center=42.267,-4.447&zoom=14&size=576x220&maptype=mapnik";
const maxDocumentImageBytes = 5 * 1024 * 1024;
const decodeDocumentImage = (dataUrl) => {
  if (typeof dataUrl !== "string") return null;
  const match =
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return null;

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > maxDocumentImageBytes) return null;
  const signatures = {
    jpeg:
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
    png: buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    webp:
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP",
  };
  if (!signatures[match[1]]) return null;
  return {buffer, extension: match[1] === "jpeg" ? "jpg" : match[1]};
};
const decodeRoomImage = decodeDocumentImage;
function isAllowedSiteImageUrl(value) {
  if (/^\/api\/web-images\/(?:hotel\.png|(?:hero|intro|experience|casa-rural)\.webp)$/.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.origin !== process.env.SUPABASE_URL) return false;
    const prefix = `/storage/v1/object/public/${storageBuckets.public}/site/`;
    return url.pathname.startsWith(prefix) && /^(?:[0-9a-f-]{36}-)?(?:hotel\.png|(?:hero|intro|experience|casa-rural)\.webp)$/.test(url.pathname.slice(prefix.length));
  } catch {
    return false;
  }
}
const slugifyRoomName = (name) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

function contactRateLimitReached(email) {
  const now = Date.now();
  for (const [key, entry] of contactSubmissions) {
    if (entry.resetAt <= now) contactSubmissions.delete(key);
  }

  const entry = contactSubmissions.get(email);
  if (!entry || entry.resetAt <= now) {
    contactSubmissions.set(email, {
      count: 1,
      resetAt: now + contactRateLimitWindowMs,
    });
    return false;
  }

  entry.count += 1;
  return entry.count > 3;
}

async function sendContactEmails({name, email, phone, subject, message}) {
  const site = await readSiteSettings();
  const siteName = escapeHtml(site.site_name);
  const safe = {
    name: escapeHtml(name),
    email: escapeHtml(email),
    phone: escapeHtml(phone || "No indicado"),
    subject: escapeHtml(subject),
    message: escapeHtml(message).replace(/\r?\n/g, "<br />"),
  };
  const hotelText = [
    `Nuevo mensaje desde el formulario de contacto`,
    ``,
    `Nombre: ${name}`,
    `Correo: ${email}`,
    `Teléfono: ${phone || "No indicado"}`,
    `Asunto: ${subject}`,
    "",
    "Mensaje:",
    message,
    "",
    "Puedes responder directamente a este correo para contestar al remitente.",
  ].join("\n");
  const customerText = [
    `Hola ${name},`,
    "",
    `Hemos recibido correctamente tu mensaje para ${site.site_name}. Te responderemos lo antes posible.`,
    "",
    `Asunto: ${subject}`,
    "",
    "Tu mensaje:",
    message,
    "",
    `Gracias por contactar con ${site.site_name}.`,
  ].join("\n");
  const emailShell = (preheader, content, footer) => `<div style="margin:0;padding:28px 12px;background:#f7f5ef;font-family:Arial,Helvetica,sans-serif;color:#292b27;line-height:1.6">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;border:1px solid #e6e2d9;background:#ffffff">
      <tr>
        <td style="padding:24px 30px;background:#1d332b;color:#ffffff">
          <p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#e0cba5">${siteName}</p>
        </td>
      </tr>
      <tr><td style="padding:30px">${content}</td></tr>
      <tr>
        <td style="padding:18px 30px;border-top:1px solid #e6e2d9;color:#74766f;font-size:12px">
          ${siteName} · ${footer}
        </td>
      </tr>
    </table>
  </div>`;
  const hotelHtml = emailShell(
    `Nuevo mensaje de contacto: ${safe.subject}`,
    `<h1 style="margin:0 0 8px;color:#1d332b;font-size:24px;line-height:1.25">Nuevo mensaje de contacto</h1>
    <p style="margin:0 0 22px;color:#74766f">Has recibido una consulta desde el formulario de la web.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
      <tr>
        <td width="120" style="padding:11px 12px;border-bottom:1px solid #e6e2d9;color:#74766f;vertical-align:top">Nombre</td>
        <td style="padding:11px 12px;border-bottom:1px solid #e6e2d9;color:#292b27;font-weight:bold">${safe.name}</td>
      </tr>
      <tr>
        <td width="120" style="padding:11px 12px;border-bottom:1px solid #e6e2d9;color:#74766f;vertical-align:top">Correo</td>
        <td style="padding:11px 12px;border-bottom:1px solid #e6e2d9"><a href="mailto:${safe.email}" style="color:#28443a">${safe.email}</a></td>
      </tr>
      <tr>
        <td width="120" style="padding:11px 12px;border-bottom:1px solid #e6e2d9;color:#74766f;vertical-align:top">Teléfono</td>
        <td style="padding:11px 12px;border-bottom:1px solid #e6e2d9;color:#292b27">${safe.phone}</td>
      </tr>
      <tr>
        <td width="120" style="padding:11px 12px;color:#74766f;vertical-align:top">Asunto</td>
        <td style="padding:11px 12px;color:#292b27;font-weight:bold">${safe.subject}</td>
      </tr>
    </table>
    <div style="margin-top:22px;padding:18px 20px;background:#f7f5ef">
      <p style="margin:0 0 8px;color:#28443a;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Mensaje</p>
      <div style="color:#292b27;font-size:14px;overflow-wrap:anywhere">${safe.message}</div>
    </div>`,
    "Notificación automática del formulario de contacto.",
  );
  const customerHtml = emailShell(
    `Hemos recibido tu mensaje para ${siteName}`,
    `<h1 style="margin:0 0 12px;color:#1d332b;font-size:26px;line-height:1.25">¡Gracias por escribirnos!</h1>
    <p style="margin:0 0 20px;color:#292b27">Hola ${safe.name}, hemos recibido correctamente tu mensaje. Te responderemos lo antes posible.</p>
    <div style="margin-bottom:16px;padding:14px 18px;border-left:3px solid #b87958;background:#f7f5ef">
      <p style="margin:0 0 4px;color:#74766f;font-size:12px;letter-spacing:1px;text-transform:uppercase">Asunto</p>
      <p style="margin:0;color:#292b27;font-weight:bold">${safe.subject}</p>
    </div>
    <div style="padding:18px 20px;border:1px solid #e6e2d9">
      <p style="margin:0 0 8px;color:#28443a;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Tu mensaje</p>
      <div style="color:#292b27;font-size:14px;overflow-wrap:anywhere">${safe.message}</div>
    </div>
    <p style="margin:20px 0 0;color:#74766f;font-size:14px">Si necesitas añadir algo, puedes responder a este correo.</p>`,
    "Gracias por ponerte en contacto con nosotros.",
  );

  await mailer.sendMail({
    from: EMAIL_FROM,
    to: site.site_email || HOTEL_CONTACT_EMAIL,
    replyTo: email,
    subject: `Contacto web · ${subject}`,
    text: hotelText,
    html: hotelHtml,
  });

  await mailer.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: `Hemos recibido tu mensaje · ${site.site_name}`,
    text: customerText,
    html: customerHtml,
  });
}

async function sendContactReplyEmail({name, email, subject, message}) {
  const site = await readSiteSettings();
  const safeSiteName = escapeHtml(site.site_name);
  const safeName = escapeHtml(name);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, "<br />");
  await mailer.sendMail({
    from: EMAIL_FROM,
    to: email,
    replyTo: site.site_email || HOTEL_CONTACT_EMAIL,
    subject: `Respuesta a tu consulta · ${subject}`,
    text: [
      `Hola ${name},`,
      "",
      `Te respondemos a tu mensaje para ${site.site_name}.`,
      "",
      `Asunto: ${subject}`,
      "",
      message,
      "",
      site.site_name,
    ].join("\n"),
    html: `<div style="margin:0;padding:28px 12px;background:#f7f5ef;font-family:Arial,Helvetica,sans-serif;color:#292b27;line-height:1.6">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;border:1px solid #e6e2d9;background:#fff">
        <tr><td style="padding:24px 30px;background:#1d332b;color:#fff"><p style="margin:0;color:#e0cba5;font-size:12px;letter-spacing:2px;text-transform:uppercase">${safeSiteName}</p></td></tr>
        <tr><td style="padding:30px">
          <h1 style="margin:0 0 14px;color:#1d332b;font-size:24px">Respuesta a tu mensaje</h1>
          <p>Hola ${safeName},</p>
          <p>Te respondemos a tu consulta sobre <strong>${safeSubject}</strong>.</p>
          <div style="margin-top:20px;padding:18px 20px;background:#f7f5ef;color:#292b27;overflow-wrap:anywhere">${safeMessage}</div>
          <p style="margin-bottom:0">${safeSiteName}</p>
        </td></tr>
      </table>
    </div>`,
  });
}

async function sendBookingConfirmationEmail({
  email,
  guestName,
  reference,
  roomName,
  roomFeatures,
  checkIn,
  checkOut,
  adults,
  children,
  nights,
  breakfast,
  breakfastTotal,
  pets,
  petsTotal,
  roomSubtotal,
  discountCode,
  discountAmount,
  total,
  vatBreakdown = [],
  token,
  accessToken,
  arrivalPin,
  reservationPdf,
  attachments = [],
}) {
  const site = await readSiteSettings();
  const precheckinLink = token ? new URL("/pre-check-in", frontendUrl) : null;
  if (precheckinLink) precheckinLink.hash = token;
  const detailsLink = reservationDetailsUrl(accessToken);
  const qrContentId = "reservation-details@hotel-amanecer";
  const qrImage = await QRCode.toBuffer(detailsLink.href, {
    type: "png",
    width: 240,
    margin: 1,
    errorCorrectionLevel: "M",
    color: {dark: "#244536", light: "#ffffff"},
  });
  const safe = {
    guestName: escapeHtml(guestName),
    reference: escapeHtml(reference),
    roomName: escapeHtml(roomName),
    roomFeatures: Array.isArray(roomFeatures)
      ? roomFeatures.map((feature) => escapeHtml(feature))
      : [],
    checkIn: escapeHtml(formatDateForEmail(checkIn)),
    checkOut: escapeHtml(formatDateForEmail(checkOut)),
    address: escapeHtml(site.site_address),
    phone: escapeHtml(site.site_phone),
    phoneLink: escapeHtml(site.site_phone.replace(/[^\d+]/g, "")),
    directionsUrl: escapeHtml(site.site_map_url),
    mapPreviewUrl: escapeHtml(reservationMapPreviewUrl),
    precheckinUrl: precheckinLink ? escapeHtml(precheckinLink.href) : "",
    detailsUrl: escapeHtml(detailsLink.href),
    checkInTime: escapeHtml(HOTEL_CHECK_IN_TIME),
    checkOutTime: escapeHtml(HOTEL_CHECK_OUT_TIME),
    roomPrice: escapeHtml(formatCurrency(roomSubtotal)),
    breakfastTotal: escapeHtml(formatCurrency(breakfastTotal)),
    petsTotal: escapeHtml(formatCurrency(petsTotal)),
    discountCode: discountCode ? escapeHtml(discountCode) : "",
    discountAmount: escapeHtml(formatCurrency(discountAmount ?? 0)),
    total: escapeHtml(formatCurrency(total)),
    arrivalPin: escapeHtml(arrivalPin),
    siteName: escapeHtml(site.site_name),
  };
  const guestSummary = `${adults} ${adults === 1 ? "adulto" : "adultos"}${children ? ` · ${children} ${children === 1 ? "niño" : "niños"}` : ""}`;
  const breakfastSummary = breakfast ? "Incluido" : "No incluido";
  const petsSummary = pets ? "Sí" : "No";
  const vatTextLines = vatBreakdown.map(
    (item) => `IVA incluido (${item.rate}%): base ${formatCurrency(item.taxable_base)} · IVA ${formatCurrency(item.vat)}`,
  );
  const vatHtmlRows = vatBreakdown.map(
    (item) => `<tr><td style="padding:8px 0;color:#50564e;font-size:13px;">IVA incluido · ${escapeHtml(String(item.rate))}%</td><td align="right" style="padding:8px 0;color:#50564e;font-size:13px;">Base ${escapeHtml(formatCurrency(item.taxable_base))} · IVA ${escapeHtml(formatCurrency(item.vat))}</td></tr>`,
  ).join("");
  const text = [
    `¡Reserva confirmada, ${guestName}!`,
    `${site.site_name} · ${reference}`,
    "",
    "RESUMEN DE LA ESTANCIA",
    `Habitación: ${roomName}`,
    ...(roomFeatures?.length
      ? ["Características:", ...roomFeatures.map((feature) => `- ${feature}`)]
      : []),
    `Entrada: ${formatDateForEmail(checkIn)} · desde las ${HOTEL_CHECK_IN_TIME}`,
    `Salida: ${formatDateForEmail(checkOut)} · hasta las ${HOTEL_CHECK_OUT_TIME}`,
    `Huéspedes: ${guestSummary}`,
    `Duración: ${nights} ${nights === 1 ? "noche" : "noches"}`,
    `Desayuno: ${breakfastSummary}`,
    `Mascotas: ${petsSummary}`,
    `PIN de llegada: ${arrivalPin}`,
    "Este enlace permite consultar los datos personales de la reserva. No lo compartas.",
    "",
    "ALOJAMIENTO",
    site.site_address,
    `Teléfono: ${site.site_phone}`,
    `Cómo llegar: ${site.site_map_url}`,
    `Consulta los datos de tu reserva: ${detailsLink.href}`,
    "",
    "DESGLOSE DEL PRECIO",
    `${roomName} · ${nights} ${nights === 1 ? "noche" : "noches"}: ${formatCurrency(total - breakfastTotal - petsTotal)}`,
    ...(breakfast ? [`Desayuno: ${formatCurrency(breakfastTotal)}`] : []),
    ...(pets ? [`Suplemento de mascotas: ${formatCurrency(petsTotal)}`] : []),
    ...(discountAmount
      ? [
          `Descuento${discountCode ? ` · ${discountCode}` : ""}: -${formatCurrency(discountAmount)}`,
        ]
      : []),
    ...vatTextLines,
    `Total: ${formatCurrency(total)}`,
    "",
    ...(precheckinLink
      ? [
          `Completa el pre-check-in (disponible durante las 72 horas anteriores a la llegada): ${precheckinLink.href}`,
          "El enlace es personal y de un solo uso.",
        ]
      : ["El pre-check-in de esta reserva ya está completado."]),
  ].join("\n");
  await mailer.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: `Reserva confirmada · ${reference} | ${site.site_name}`,
    text,
    html: `
      <!doctype html>
      <html lang="es">
        <body style="margin:0;padding:24px 12px;background:#f3f4ef;color:#242820;font-family:Arial,Helvetica,sans-serif;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e3e5dc;">
            <tr>
              <td style="padding:30px 32px;background:#244536;color:#ffffff;">
                <p style="margin:0 0 10px;color:#d9c8a4;font-size:12px;letter-spacing:2px;text-transform:uppercase;">${safe.siteName}</p>
                <h1 style="margin:0;font-size:26px;line-height:1.25;">Tu reserva está confirmada</h1>
                <p style="margin:12px 0 0;color:#e5ebe5;font-size:14px;">Hola ${safe.guestName}, hemos preparado todo para tu estancia.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;">
                <p style="margin:0;color:#6b7168;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Referencia de reserva</p>
                <p style="margin:6px 0 0;font-size:18px;font-weight:bold;">${safe.reference}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 8px;">
                <h2 style="margin:0 0 14px;font-size:18px;">Tu estancia</h2>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td width="150" valign="top" align="center" style="padding:12px 16px 12px 0;">
                      <a href="${safe.detailsUrl}" style="color:#244536;text-decoration:none;">
                        <img src="cid:${qrContentId}" width="132" height="132" alt="Código QR para consultar los datos de tu reserva" style="display:block;width:132px;height:132px;border:1px solid #e7e8e2;" />
                        <span style="display:block;margin-top:8px;font-size:12px;font-weight:bold;">Escanea para ver tu reserva</span>
                        <span style="display:block;margin-top:6px;color:#6b7168;font-size:11px;">Enlace privado: no lo compartas.</span>
                      </a>
                    </td>
                    <td valign="top">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e7e8e2;">
                  <tr>
                    <td width="50%" style="padding:16px;border-bottom:1px solid #e7e8e2;">
                      <p style="margin:0 0 6px;color:#6b7168;font-size:12px;text-transform:uppercase;">Entrada</p>
                      <strong style="font-size:15px;">${safe.checkIn}</strong>
                      <p style="margin:5px 0 0;color:#6b7168;font-size:13px;">Desde las ${safe.checkInTime}</p>
                    </td>
                    <td width="50%" style="padding:16px;border-bottom:1px solid #e7e8e2;border-left:1px solid #e7e8e2;">
                      <p style="margin:0 0 6px;color:#6b7168;font-size:12px;text-transform:uppercase;">Salida</p>
                      <strong style="font-size:15px;">${safe.checkOut}</strong>
                      <p style="margin:5px 0 0;color:#6b7168;font-size:13px;">Hasta las ${safe.checkOutTime}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 16px;border-bottom:1px solid #e7e8e2;">
                      <span style="color:#6b7168;font-size:13px;">Huéspedes</span><br />
                      <strong style="display:inline-block;margin-top:5px;font-size:14px;">${escapeHtml(guestSummary)}</strong>
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #e7e8e2;border-left:1px solid #e7e8e2;">
                      <span style="color:#6b7168;font-size:13px;">Duración</span><br />
                      <strong style="display:inline-block;margin-top:5px;font-size:14px;">${nights} ${nights === 1 ? "noche" : "noches"}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 16px;">
                      <span style="color:#6b7168;font-size:13px;">Desayuno</span><br />
                      <strong style="display:inline-block;margin-top:5px;font-size:14px;">${breakfastSummary}</strong>
                    </td>
                    <td style="padding:14px 16px;border-left:1px solid #e7e8e2;">
                      <span style="color:#6b7168;font-size:13px;">Mascotas</span><br />
                      <strong style="display:inline-block;margin-top:5px;font-size:14px;">${petsSummary}</strong>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0;font-size:14px;"><strong>Habitación:</strong> ${safe.roomName}</p>
                ${safe.roomFeatures.length ? `<ul style="margin:8px 0 0;padding-left:20px;color:#50564e;font-size:13px;line-height:1.6;">${safe.roomFeatures.map((feature) => `<li>${feature}</li>`).join("")}</ul>` : ""}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;">
                <h2 style="margin:0 0 12px;font-size:18px;">Dónde estamos</h2>
                <p style="margin:0;color:#50564e;font-size:14px;line-height:1.6;">${safe.address}</p>
                <p style="margin:8px 0 16px;font-size:14px;"><a href="tel:${safe.phoneLink}" style="color:#244536;text-decoration:underline;">${safe.phone}</a></p>
                <a href="${safe.directionsUrl}" style="display:block;max-width:576px;color:#244536;text-decoration:none;">
                  <img src="${safe.mapPreviewUrl}" width="576" height="220" alt="Mapa de la zona de Población de Campos" style="display:block;width:100%;max-width:576px;height:auto;border:0;" />
                  <span style="display:inline-block;margin-top:12px;color:#244536;font-size:14px;font-weight:bold;text-decoration:underline;">Cómo llegar</span>
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 8px;">
                <p style="margin:0;padding:16px;border:1px solid #dfe2d9;background:#f3f4ef;font-size:16px;">
                  <strong>PIN para tu llegada:</strong> <span style="font-size:22px;letter-spacing:4px;">${safe.arrivalPin}</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;">
                <h2 style="margin:0 0 12px;font-size:18px;">Desglose del precio</h2>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="padding:8px 0;color:#50564e;font-size:14px;">Habitación · ${nights} ${nights === 1 ? "noche" : "noches"}</td>
                    <td align="right" style="padding:8px 0;color:#50564e;font-size:14px;">${safe.roomPrice}</td>
                  </tr>
                  ${breakfast ? `<tr><td style="padding:8px 0;color:#50564e;font-size:14px;">Desayuno</td><td align="right" style="padding:8px 0;color:#50564e;font-size:14px;">${safe.breakfastTotal}</td></tr>` : ""}
                  ${pets ? `<tr><td style="padding:8px 0;color:#50564e;font-size:14px;">Suplemento de mascotas</td><td align="right" style="padding:8px 0;color:#50564e;font-size:14px;">${safe.petsTotal}</td></tr>` : ""}
                  ${discountAmount ? `<tr><td style="padding:8px 0;color:#315d39;font-size:14px;">Descuento${safe.discountCode ? ` · ${safe.discountCode}` : ""}</td><td align="right" style="padding:8px 0;color:#315d39;font-size:14px;">−${safe.discountAmount}</td></tr>` : ""}
                  ${vatHtmlRows}
                  <tr>
                    <td style="padding:14px 0;border-top:1px solid #dfe2d9;font-size:16px;font-weight:bold;">Total de la reserva</td>
                    <td align="right" style="padding:14px 0;border-top:1px solid #dfe2d9;font-size:18px;font-weight:bold;">${safe.total}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 32px 28px;">
                <p style="margin:0 0 14px;color:#50564e;font-size:14px;line-height:1.5;">Completa tus datos antes de llegar. El pre-check-in estará disponible durante las 72 horas anteriores a la entrada.</p>
                ${
                  precheckinLink
                    ? `<a href="${safe.precheckinUrl}" style="display:inline-block;padding:14px 24px;background:#244536;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;">Completar pre-check-in</a>
                <p style="margin:16px 0 0;color:#777d74;font-size:12px;">Este enlace es personal y de un solo uso. No lo compartas.</p>`
                    : `<p style="margin:0;color:#50564e;font-size:14px;">El pre-check-in de esta reserva ya está completado.</p>`
                }
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:18px 32px;background:#f3f4ef;color:#777d74;font-size:12px;line-height:1.5;">
                ¿Tienes alguna duda? Llámanos al <a href="tel:${safe.phoneLink}" style="color:#244536;">${safe.phone}</a>.<br />
                ${safe.siteName} · ${safe.address}
              </td>
            </tr>
          </table>
        </body>
      </html>`,
    attachments: [
      {
        filename: `reserva-${reference}.pdf`,
        content: reservationPdf,
      },
      ...attachments,
      {
        filename: "reserva-qr.png",
        content: qrImage,
        contentType: "image/png",
        cid: qrContentId,
      },
    ],
  });
}

app.get("/api/health", async (_req, res, next) => {
  try {
    const {rows} = await pool.query("SELECT now() AS db_time");
    res.json({ok: true, db_time: rows[0].db_time});
  } catch (err) {
    next(err);
  }
});

app.post("/api/admin/login", async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isSameOrigin(req))
    return res.status(403).json({errors: ["Solicitud no permitida."]});
  const ip =
    req.get("x-hotel-client-ip") ??
    req.ip ??
    req.socket.remoteAddress ??
    "unknown";
  if (adminLoginRateLimitReached(ip)) {
    return res.status(429).json({
      errors: [
        "Demasiados intentos. Espera 15 minutos antes de volver a probar.",
      ],
    });
  }
  try {
    if (!isAdminJwtConfigured()) {
      return res.status(503).json({
        errors: ["Fallo al autenticarte, porfavor revisa las credenciales."],
      });
    }
    const {username, password} = req.body ?? {};
    const validInput =
      typeof username === "string" &&
      username.trim().length > 0 &&
      username.length <= 100 &&
      typeof password === "string" &&
      password.length <= 200 &&
      Buffer.byteLength(password, "utf8") <= 72;
    if (!validInput) {
      return res
        .status(401)
        .json({errors: ["Usuario o contraseña incorrectos."]});
    }
    const {rows} = await pool.query(
      `SELECT id, password_hash, session_version
         FROM administradores
        WHERE lower(username) = lower($1) AND is_active = TRUE`,
      [username.trim()],
    );
    const admin = rows[0];
    const passwordMatches = admin
      ? await bcrypt.compare(password, admin.password_hash)
      : false;
    if (!admin || !passwordMatches) {
      return res
        .status(401)
        .json({errors: ["Usuario o contraseña incorrectos."]});
    }

    adminLoginAttempts.delete(ip);
    const sessionToken = jwt.sign(
      {ver: admin.session_version},
      ADMIN_JWT_SECRET,
      {
        subject: String(admin.id),
        audience: "hotel-admin",
        issuer: "hotel-amanecer",
        expiresIn: adminSessionDurationSeconds,
      },
    );
    res.setHeader(
      "Set-Cookie",
      adminCookieHeader(sessionToken, adminSessionDurationSeconds),
    );
    res.json({ok: true});
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/session", async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  try {
    res.json({authenticated: Boolean(await getAuthenticatedAdmin(req))});
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/logout", async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isSameOrigin(req))
    return res.status(403).json({errors: ["Solicitud no permitida."]});
  try {
    const admin = await getAuthenticatedAdmin(req);
    if (admin) {
      await pool.query(
        `UPDATE administradores
            SET session_version = session_version + 1, updated_at = now()
          WHERE id = $1`,
        [admin.id],
      );
    }
    res.setHeader("Set-Cookie", adminCookieHeader("", 0));
    res.json({ok: true});
  } catch (error) {
    next(error);
  }
});

app.get("/api/site-settings", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=60");
    res.json(await readSiteSettings());
  } catch (error) {
    next(error);
  }
});

app.get("/api/testimonials", async (_req, res, next) => {
  try {
    const {rows} = await pool.query(
      `SELECT display_name, message, rating, travel_type, travel_type_other,
              submitted_at AS fecha
         FROM booking_testimonials
        WHERE submitted_at IS NOT NULL AND is_approved = TRUE
        ORDER BY moderated_at DESC NULLS LAST, submitted_at DESC
        LIMIT 9`,
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

function galleryRateLimitReached(req, action, limit) {
  const now = Date.now();
  for (const [key, entry] of gallerySubmissions) {
    if (entry.resetAt <= now) gallerySubmissions.delete(key);
  }
  const ip = req.get("x-hotel-client-ip") ?? req.ip ?? "unknown";
  const key = `${action}:${ip}`;
  const entry = gallerySubmissions.get(key);
  if (!entry || entry.resetAt <= now) {
    gallerySubmissions.set(key, {count: 1, resetAt: now + galleryRateLimitWindowMs});
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

function validGalleryAlbumId(value) {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function validateGalleryAlbum(body) {
  const errors = [];
  if (typeof body.title !== "string" || body.title.trim().length < 2 || body.title.trim().length > 120) {
    errors.push("El título debe tener entre 2 y 120 caracteres.");
  }
  if (typeof body.description !== "string" || body.description.trim().length > 3000) {
    errors.push("La descripción no puede superar los 3000 caracteres.");
  }
  if (typeof body.allow_comments !== "boolean" || typeof body.allow_uploads !== "boolean") {
    errors.push("Las opciones de comentarios y subida deben ser válidas.");
  }
  return errors;
}

function validateGalleryImage(body) {
  const errors = [];
  if (!decodeRoomImage(body.image_data_url)) {
    errors.push("La imagen debe ser JPG, PNG o WebP y no superar los 5 MB.");
  }
  if (body.caption !== undefined && (typeof body.caption !== "string" || body.caption.trim().length > 240)) {
    errors.push("El pie de foto no puede superar los 240 caracteres.");
  }
  if (body.submitted_by !== undefined && (typeof body.submitted_by !== "string" || body.submitted_by.trim().length > 80)) {
    errors.push("El nombre no puede superar los 80 caracteres.");
  }
  return errors;
}

async function storeGalleryImage(album, imageDataUrl) {
  const image = decodeRoomImage(imageDataUrl);
  if (!image) throw new Error("La imagen enviada no es válida.");
  const objectPath = `gallery/${album.slug}/${randomUUID()}.webp`;
  const optimized = await sharp(image.buffer, {limitInputPixels: 30_000_000})
    .rotate()
    .resize({width: 2000, height: 1600, fit: "inside", withoutEnlargement: true})
    .webp({quality: 82})
    .toBuffer();
  await uploadStorageObject(storageBuckets.public, objectPath, optimized, "image/webp");
  return {objectPath, imageUrl: publicStorageUrl(objectPath)};
}

app.get("/api/gallery/albums", async (_req, res, next) => {
  try {
    const {rows} = await pool.query(
      `SELECT a.id, a.slug, a.title, a.description, a.allow_comments, a.allow_uploads,
              a.created_at, a.updated_at,
              (SELECT count(*)::int FROM gallery_photos p
                WHERE p.album_id = a.id AND p.status = 'approved') AS photo_count,
              (SELECT max(p.created_at) FROM gallery_photos p
                WHERE p.album_id = a.id AND p.status = 'approved') AS latest_upload_at,
              (SELECT p.image_url FROM gallery_photos p
                WHERE p.album_id = a.id AND p.status = 'approved'
                ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS cover_url
         FROM gallery_albums a
        ORDER BY a.created_at DESC, a.id DESC`,
    );
    res.set("Cache-Control", "public, max-age=60").json(rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/gallery/albums/:slug", async (req, res, next) => {
  try {
    const {rows: albums} = await pool.query(
      `SELECT id, slug, title, description, allow_comments, allow_uploads, created_at, updated_at
         FROM gallery_albums WHERE slug = $1`,
      [req.params.slug],
    );
    if (!albums.length) return res.status(404).json({errors: ["No se ha encontrado el álbum."]});
    const album = albums[0];
    const [{rows: photos}, {rows: comments}] = await Promise.all([
      pool.query(
        `SELECT id, image_url, caption, created_at
           FROM gallery_photos
          WHERE album_id = $1 AND status = 'approved'
          ORDER BY created_at, id`,
        [album.id],
      ),
      pool.query(
        `SELECT id, display_name, message, created_at
           FROM gallery_comments
          WHERE album_id = $1 AND status = 'approved'
          ORDER BY created_at DESC, id DESC
          LIMIT 100`,
        [album.id],
      ),
    ]);
    res.set("Cache-Control", "public, max-age=60").json({...album, photos, comments});
  } catch (error) {
    next(error);
  }
});

app.post("/api/gallery/albums/:slug/comments", async (req, res, next) => {
  const displayName = typeof req.body?.display_name === "string" ? req.body.display_name.trim() : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (displayName.length < 2 || displayName.length > 80 || message.length < 2 || message.length > 1500) {
    return res.status(400).json({errors: ["Indica un nombre de 2 a 80 caracteres y un comentario de 2 a 1500 caracteres."]});
  }
  if (!isSameOrigin(req)) return res.status(403).json({errors: ["Solicitud no permitida."]});
  if (galleryRateLimitReached(req, "comment", 8)) {
    return res.status(429).json({errors: ["Has enviado varios comentarios recientemente. Inténtalo más tarde."]});
  }
  try {
    const {rows: albums} = await pool.query(
      "SELECT id, allow_comments FROM gallery_albums WHERE slug = $1",
      [req.params.slug],
    );
    if (!albums.length) return res.status(404).json({errors: ["No se ha encontrado el álbum."]});
    if (!albums[0].allow_comments) return res.status(403).json({errors: ["Este álbum no admite comentarios."]});
    await pool.query(
      `INSERT INTO gallery_comments (album_id, display_name, message)
       VALUES ($1, $2, $3)`,
      [albums[0].id, displayName, message],
    );
    res.status(201).json({ok: true, message: "Comentario enviado para revisión."});
  } catch (error) {
    next(error);
  }
});

app.post("/api/gallery/albums/:slug/photos", async (req, res, next) => {
  const errors = validateGalleryImage(req.body ?? {});
  if (typeof req.body?.submitted_by !== "string" || req.body.submitted_by.trim().length < 2) {
    errors.push("Indica tu nombre (entre 2 y 80 caracteres).");
  }
  if (errors.length) return res.status(400).json({errors});
  if (!isSameOrigin(req)) return res.status(403).json({errors: ["Solicitud no permitida."]});
  if (galleryRateLimitReached(req, "photo", 5)) {
    return res.status(429).json({errors: ["Has enviado varias fotos recientemente. Inténtalo más tarde."]});
  }
  let saved;
  try {
    const {rows: albums} = await pool.query(
      "SELECT id, slug, allow_uploads FROM gallery_albums WHERE slug = $1",
      [req.params.slug],
    );
    if (!albums.length) return res.status(404).json({errors: ["No se ha encontrado el álbum."]});
    const album = albums[0];
    if (!album.allow_uploads) return res.status(403).json({errors: ["Este álbum no admite nuevas fotos."]});
    saved = await storeGalleryImage(album, req.body.image_data_url);
    const {rows} = await pool.query(
      `INSERT INTO gallery_photos (album_id, object_path, image_url, caption, submitted_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status`,
      [album.id, saved.objectPath, saved.imageUrl, req.body.caption?.trim() ?? "", req.body.submitted_by.trim()],
    );
    res.status(201).json({ok: true, status: rows[0].status, message: "Foto recibida. Aparecerá en el álbum cuando la apruebe el equipo."});
  } catch (error) {
    if (saved) {
      try {
        await removeStorageObjects(storageBuckets.public, [saved.objectPath]);
      } catch (cleanupError) {
        console.error("No se pudo retirar una foto de galería tras fallar su registro.", cleanupError);
      }
    }
    next(error);
  }
});

app.get("/api/admin/gallery/albums", requireAdmin, async (_req, res, next) => {
  try {
    const {rows} = await pool.query(
      `SELECT a.id, a.slug, a.title, a.description, a.allow_comments, a.allow_uploads, a.created_at, a.updated_at,
              (SELECT count(*)::int FROM gallery_photos p WHERE p.album_id = a.id AND p.status = 'approved') AS photo_count,
              (SELECT count(*)::int FROM gallery_photos p WHERE p.album_id = a.id AND p.status = 'pending') AS pending_photo_count,
              (SELECT count(*)::int FROM gallery_comments c WHERE c.album_id = a.id AND c.status = 'pending') AS pending_comment_count
         FROM gallery_albums a ORDER BY a.created_at DESC, a.id DESC`,
    );
    res.set("Cache-Control", "no-store").json(rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/gallery/albums/:id", requireAdmin, async (req, res, next) => {
  if (!validGalleryAlbumId(req.params.id)) return res.status(400).json({errors: ["El álbum indicado no es válido."]});
  try {
    const {rows: albums} = await pool.query("SELECT * FROM gallery_albums WHERE id = $1", [req.params.id]);
    if (!albums.length) return res.status(404).json({errors: ["No se ha encontrado el álbum."]});
    const album = albums[0];
    const [{rows: photos}, {rows: comments}] = await Promise.all([
      pool.query(
        `SELECT id, image_url, caption, submitted_by, status, created_at, moderated_at
           FROM gallery_photos WHERE album_id = $1 ORDER BY created_at DESC, id DESC`,
        [album.id],
      ),
      pool.query(
        `SELECT id, display_name, message, status, created_at, moderated_at
           FROM gallery_comments WHERE album_id = $1 ORDER BY created_at DESC, id DESC`,
        [album.id],
      ),
    ]);
    res.set("Cache-Control", "no-store").json({...album, photos, comments});
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/gallery/albums", requireAdmin, async (req, res, next) => {
  const errors = validateGalleryAlbum(req.body ?? {});
  if (errors.length) return res.status(400).json({errors});
  if (!isSameOrigin(req)) return res.status(403).json({errors: ["Solicitud no permitida."]});
  const slugBase = req.body.title.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "album";
  const slug = `${slugBase}-${randomUUID().slice(0, 8)}`;
  try {
    const {rows} = await pool.query(
      `INSERT INTO gallery_albums (slug, title, description, allow_comments, allow_uploads)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [slug, req.body.title.trim(), req.body.description.trim(), req.body.allow_comments, req.body.allow_uploads],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/gallery/albums/:id", requireAdmin, async (req, res, next) => {
  const errors = validateGalleryAlbum(req.body ?? {});
  if (errors.length) return res.status(400).json({errors});
  if (!isSameOrigin(req)) return res.status(403).json({errors: ["Solicitud no permitida."]});
  if (!validGalleryAlbumId(req.params.id)) return res.status(400).json({errors: ["El álbum indicado no es válido."]});
  try {
    const {rows} = await pool.query(
      `UPDATE gallery_albums
          SET title = $2, description = $3, allow_comments = $4, allow_uploads = $5, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.title.trim(), req.body.description.trim(), req.body.allow_comments, req.body.allow_uploads],
    );
    if (!rows.length) return res.status(404).json({errors: ["No se ha encontrado el álbum."]});
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/gallery/albums/:id/photos", requireAdmin, async (req, res, next) => {
  const errors = validateGalleryImage(req.body ?? {});
  if (errors.length) return res.status(400).json({errors});
  if (!isSameOrigin(req)) return res.status(403).json({errors: ["Solicitud no permitida."]});
  if (!validGalleryAlbumId(req.params.id)) return res.status(400).json({errors: ["El álbum indicado no es válido."]});
  let saved;
  try {
    const {rows: albums} = await pool.query("SELECT id, slug FROM gallery_albums WHERE id = $1", [req.params.id]);
    if (!albums.length) return res.status(404).json({errors: ["No se ha encontrado el álbum."]});
    saved = await storeGalleryImage(albums[0], req.body.image_data_url);
    const {rows} = await pool.query(
      `INSERT INTO gallery_photos (album_id, object_path, image_url, caption, status, moderated_at)
       VALUES ($1, $2, $3, $4, 'approved', now())
       RETURNING id, image_url, caption, submitted_by, status, created_at, moderated_at`,
      [albums[0].id, saved.objectPath, saved.imageUrl, req.body.caption?.trim() ?? ""],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (saved) {
      try {
        await removeStorageObjects(storageBuckets.public, [saved.objectPath]);
      } catch (cleanupError) {
        console.error("No se pudo retirar una foto de galería tras fallar su registro.", cleanupError);
      }
    }
    next(error);
  }
});

app.patch("/api/admin/gallery/photos/:id", requireAdmin, async (req, res, next) => {
  if (!validGalleryAlbumId(req.params.id) || !["approved", "rejected"].includes(req.body?.status)) {
    return res.status(400).json({errors: ["El estado de moderación no es válido."]});
  }
  if (!isSameOrigin(req)) return res.status(403).json({errors: ["Solicitud no permitida."]});
  try {
    const admin = await getAuthenticatedAdmin(req);
    if (!admin) return res.status(401).json({errors: ["Debes iniciar sesión como administrador."]});
    const {rows} = await pool.query(
      `UPDATE gallery_photos SET status = $2, moderated_at = now(), moderated_by = $3
        WHERE id = $1 RETURNING id, status, moderated_at`,
      [req.params.id, req.body.status, admin.id],
    );
    if (!rows.length) return res.status(404).json({errors: ["No se ha encontrado la foto."]});
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/gallery/comments/:id", requireAdmin, async (req, res, next) => {
  if (!validGalleryAlbumId(req.params.id) || !["approved", "rejected"].includes(req.body?.status)) {
    return res.status(400).json({errors: ["El estado de moderación no es válido."]});
  }
  if (!isSameOrigin(req)) return res.status(403).json({errors: ["Solicitud no permitida."]});
  try {
    const admin = await getAuthenticatedAdmin(req);
    if (!admin) return res.status(401).json({errors: ["Debes iniciar sesión como administrador."]});
    const {rows} = await pool.query(
      `UPDATE gallery_comments SET status = $2, moderated_at = now(), moderated_by = $3
        WHERE id = $1 RETURNING id, status, moderated_at`,
      [req.params.id, req.body.status, admin.id],
    );
    if (!rows.length) return res.status(404).json({errors: ["No se ha encontrado el comentario."]});
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/gallery/photos/:id", requireAdmin, async (req, res, next) => {
  if (!validGalleryAlbumId(req.params.id)) return res.status(400).json({errors: ["La foto indicada no es válida."]});
  if (!isSameOrigin(req)) return res.status(403).json({errors: ["Solicitud no permitida."]});
  try {
    const {rows} = await pool.query("SELECT object_path FROM gallery_photos WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({errors: ["No se ha encontrado la foto."]});
    await removeStorageObjects(storageBuckets.public, [rows[0].object_path]);
    await pool.query("DELETE FROM gallery_photos WHERE id = $1", [req.params.id]);
    res.json({ok: true});
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/gallery/albums/:id", requireAdmin, async (req, res, next) => {
  if (!validGalleryAlbumId(req.params.id)) return res.status(400).json({errors: ["El álbum indicado no es válido."]});
  if (!isSameOrigin(req)) return res.status(403).json({errors: ["Solicitud no permitida."]});
  try {
    const {rows: photos} = await pool.query("SELECT object_path FROM gallery_photos WHERE album_id = $1", [req.params.id]);
    await removeStorageObjects(storageBuckets.public, photos.map((photo) => photo.object_path));
    const {rowCount} = await pool.query("DELETE FROM gallery_albums WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({errors: ["No se ha encontrado el álbum."]});
    res.json({ok: true});
  } catch (error) {
    next(error);
  }
});

app.get("/api/testimonial-invitations/:token", async (req, res, next) => {
  const {token} = req.params;
  res.set("Cache-Control", "no-store");
  if (!/^[\w-]{43}$/.test(token)) {
    return res
      .status(404)
      .json({errors: ["El enlace no es válido o ya se ha utilizado."]});
  }
  try {
    const {rows} = await pool.query(
      `SELECT b.guest_name, r.name AS room_name
         FROM booking_testimonials t
         JOIN bookings b ON b.id = t.booking_id
         JOIN rooms r ON r.id = b.room_id
        WHERE t.invitation_token_hash = $1 AND t.submitted_at IS NULL`,
      [hashToken(token)],
    );
    if (!rows.length) {
      return res
        .status(404)
        .json({errors: ["El enlace no es válido o ya se ha utilizado."]});
    }
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post("/api/testimonial-invitations/:token", async (req, res, next) => {
  const {token} = req.params;
  const {display_name, rating, message, travel_type, travel_type_other} =
    req.body ?? {};
  const categories = new Set([
    "work",
    "family",
    "couple",
    "friends",
    "solo",
    "other",
  ]);
  const errors = [];
  if (!/^[\w-]{43}$/.test(token)) {
    errors.push("El enlace no es válido o ya se ha utilizado.");
  }
  if (
    typeof display_name !== "string" ||
    display_name.trim().length < 2 ||
    display_name.trim().length > 80 ||
    /[\r\n]/.test(display_name)
  ) {
    errors.push(
      "Indica el nombre o alias que quieres mostrar (2-80 caracteres).",
    );
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.push("Selecciona una valoración de entre 1 y 5 estrellas.");
  }
  if (
    typeof message !== "string" ||
    message.trim().length < 20 ||
    message.trim().length > 1200
  ) {
    errors.push("La opinión debe tener entre 20 y 1200 caracteres.");
  }
  if (typeof travel_type !== "string" || !categories.has(travel_type)) {
    errors.push("Selecciona el tipo de viaje.");
  }
  if (
    travel_type === "other" &&
    (typeof travel_type_other !== "string" ||
      travel_type_other.trim().length < 2 ||
      travel_type_other.trim().length > 80)
  ) {
    errors.push("Especifica el tipo de viaje.");
  }
  if (req.body?.publication_consent !== true) {
    errors.push(
      "Debes aceptar la publicación de tu opinión con el nombre que has elegido.",
    );
  }
  if (errors.length) return res.status(400).json({errors});
  if (!isSameOrigin(req)) {
    return res.status(403).json({errors: ["Solicitud no permitida."]});
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const {rows} = await client.query(
      `SELECT t.id, b.email, b.guest_name
         FROM booking_testimonials t
         JOIN bookings b ON b.id = t.booking_id
        WHERE t.invitation_token_hash = $1 AND t.submitted_at IS NULL
        FOR UPDATE OF t`,
      [hashToken(token)],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({errors: ["El enlace no es válido o ya se ha utilizado."]});
    }
    const invitation = rows[0];
    await client.query(
      `UPDATE booking_testimonials
          SET invitation_token_hash = NULL,
              submitted_at = now(),
              display_name = $2,
              rating = $3,
              message = $4,
              travel_type = $5,
              travel_type_other = $6,
              publication_consent_at = now()
        WHERE id = $1`,
      [
        invitation.id,
        display_name.trim(),
        rating,
        message.trim(),
        travel_type,
        travel_type === "other" ? travel_type_other.trim() : null,
      ],
    );
    const site = await readSiteSettings();
    const safeGuestName = escapeHtml(invitation.guest_name);
    const safeSiteName = escapeHtml(site.site_name);
    await mailer.sendMail({
      from: EMAIL_FROM,
      to: invitation.email,
      subject: `Gracias por compartir tu experiencia · ${site.site_name}`,
      text: `Hola ${invitation.guest_name},\n\nGracias por dedicar un momento a compartir tu experiencia con nosotros. Tu opinión nos ayuda a seguir mejorando.\n\n¡Esperamos volver a verte pronto!\n${site.site_name}`,
      html: `<div style="margin:0;padding:32px 16px;background:#f3f4ef;color:#242820;font-family:Arial,Helvetica,sans-serif">
        <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e3e5dc">
          <div style="padding:28px 32px;background:#244536;color:#fff">
            <p style="margin:0 0 10px;color:#d9c8a4;font-size:12px;letter-spacing:2px;text-transform:uppercase">${safeSiteName}</p>
            <h1 style="margin:0;font-size:25px">Gracias por tu opinión</h1>
          </div>
          <div style="padding:28px 32px;line-height:1.7">
            <p>Hola ${safeGuestName},</p>
            <p>Gracias por dedicar un momento a compartir tu experiencia con nosotros. Tu opinión nos ayuda a seguir mejorando.</p>
            <p>¡Esperamos volver a verte pronto!</p>
            <p style="margin-bottom:0"><strong>${safeSiteName}</strong></p>
          </div>
        </div>
      </div>`,
    });
    await client.query("COMMIT");
    res.status(201).json({ok: true});
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/admin/site-settings", requireAdmin, async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await readSiteSettings());
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/site-settings", requireAdmin, async (req, res, next) => {
  const settings = req.body ?? {};
  const keys = Object.keys(siteSettingDefaults);
  const imageFields = {
    hero_image_data_url: "hero.webp",
    intro_image_data_url: "intro.webp",
    experience_image_data_url: "experience.webp",
  };
  const allowedFields = new Set([...keys, ...Object.keys(imageFields)]);
  const requiredKeys = new Set([
    "site_name",
    "site_phone",
    "site_address",
    "site_map_url",
    "hero_image_path",
    "intro_image_path",
    "experience_image_path",
    "reception_opening_time",
    "reception_closing_time",
  ]);
  const errors = [];
  for (const key of keys) {
    const value = settings[key];
    const maxLength =
      key === "about_services" ||
      key === "social_links" ||
      key.endsWith("_content")
        ? 12000
        : 2000;
    if (
      typeof value !== "string" ||
      value.trim().length > maxLength ||
      (["breakfast_price", "pets_price"].includes(key) &&
        (!/^\d+(?:\.\d{1,2})?$/.test(value) ||
          Number(value) < 0 ||
          Number(value) > 10000)) ||
      (requiredKeys.has(key) && value.trim().length === 0) ||
      (key === "site_name" &&
        (value.trim().length < 1 || /[\r\n]/.test(value))) ||
      (["site_phone", "site_mobile_phone"].includes(key) &&
        (value.length > 40 || /[\r\n]/.test(value))) ||
      (key === "site_email" &&
        value !== "" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) ||
      (key === "hotel_stars" && !/^[0-5]$/.test(value)) ||
      (key === "reception_24h" && !["true", "false"].includes(value)) ||
      (key.startsWith("reception_") &&
        key.endsWith("_time") &&
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) ||
      (key.endsWith("_image_path") && !isAllowedSiteImageUrl(value))
    ) {
      errors.push(`El campo "${key}" no es válido.`);
      continue;
    }
    if (key === "site_map_url" && value.trim()) {
      try {
        if (!["http:", "https:"].includes(new URL(value).protocol)) {
          errors.push(`La URL de "${key}" debe usar HTTP o HTTPS.`);
        }
      } catch {
        errors.push(`La URL de "${key}" no es válida.`);
      }
    }
    try {
      const services = JSON.parse(settings.about_services);
      if (
        !Array.isArray(services) ||
        services.length > 20 ||
        services.some(
          (service) =>
            !service ||
            typeof service.title !== "string" ||
            service.title.trim().length < 1 ||
            service.title.length > 100 ||
            typeof service.description !== "string" ||
            service.description.trim().length < 1 ||
            service.description.length > 600,
        )
      ) {
        errors.push(
          'El campo "about_services" no contiene una lista de servicios válida.',
        );
      }
    } catch {
      errors.push(
        'El campo "about_services" debe contener una lista JSON válida.',
      );
    }
    try {
      const socials = JSON.parse(settings.social_links);
      const ids = new Set();
      if (
        !Array.isArray(socials) ||
        socials.length > 20 ||
        socials.some((social) => {
          if (
            !social ||
            typeof social.id !== "string" ||
            !/^[a-z0-9_-]{1,40}$/.test(social.id) ||
            ids.has(social.id) ||
            typeof social.name !== "string" ||
            social.name.trim().length < 1 ||
            social.name.length > 50 ||
            typeof social.url !== "string" ||
            social.url.length > 500 ||
            typeof social.enabled !== "boolean"
          )
            return true;
          ids.add(social.id);
          if (!social.url && !social.enabled) return false;
          try {
            return (
              !social.url ||
              !["http:", "https:"].includes(new URL(social.url).protocol)
            );
          } catch {
            return true;
          }
        })
      ) {
        errors.push(
          'El campo "social_links" no contiene redes sociales válidas.',
        );
      }
    } catch {
      errors.push(
        'El campo "social_links" debe contener una lista JSON válida.',
      );
    }
  }
  for (const key of Object.keys(imageFields)) {
    if (settings[key] != null && !decodeRoomImage(settings[key])) {
      errors.push(
        "Las imágenes deben ser JPG, PNG o WebP y no superar los 5 MB.",
      );
    }
  }
  if (keys.some((key) => !(key in settings))) {
    errors.push("Faltan campos de configuración.");
  }
  if (Object.keys(settings).some((key) => !allowedFields.has(key))) {
    errors.push("La configuración contiene campos no permitidos.");
  }
  if (errors.length) return res.status(400).json({errors});
  if (!isSameOrigin(req)) {
    return res.status(403).json({errors: ["Solicitud no permitida."]});
  }
  const savedImages = [];
  const client = await pool.connect();
  let settingsCommitted = false;
  try {
    for (const [field, filename] of Object.entries(imageFields)) {
      if (settings[field] == null) continue;
      const saved = await saveWebImage(filename, settings[field]);
      savedImages.push(saved);
      const pathKey = field.replace("_image_data_url", "_image_path");
      settings[pathKey] = saved.imageUrl;
    }
    await client.query("BEGIN");
    for (const key of keys) {
      await client.query(
        `INSERT INTO site_settings (setting_key, setting_value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (setting_key)
         DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
        [key, settings[key].trim()],
      );
    }
    await client.query("COMMIT");
    settingsCommitted = true;
    res.json(await readSiteSettings());
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    for (const saved of settingsCommitted ? [] : savedImages) {
      try {
        await removeStorageObjects(storageBuckets.public, [saved.objectPath]);
      } catch (restoreError) {
        console.error(
          "No se pudo restaurar una imagen de la web tras fallar el guardado.",
          restoreError,
        );
      }
    }
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/admin/testimonials", requireAdmin, async (_req, res, next) => {
  try {
    const {rows} = await pool.query(
      `SELECT t.id, t.display_name, t.rating, t.message, t.travel_type,
              t.travel_type_other, t.submitted_at, t.is_approved, t.moderated_at,
              b.guest_name, b.email, b.reservation_code, r.name AS room_name
         FROM booking_testimonials t
         JOIN bookings b ON b.id = t.booking_id
         JOIN rooms r ON r.id = b.room_id
        WHERE t.submitted_at IS NOT NULL
        ORDER BY t.is_approved ASC, t.submitted_at DESC`,
    );
    res.set("Cache-Control", "no-store");
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.patch(
  "/api/admin/testimonials/:id",
  requireAdmin,
  async (req, res, next) => {
    const testimonialId = Number(req.params.id);
    if (!Number.isSafeInteger(testimonialId) || testimonialId < 1) {
      return res
        .status(400)
        .json({errors: ["La opinión indicada no es válida."]});
    }
    if (typeof req.body?.approved !== "boolean") {
      return res
        .status(400)
        .json({errors: ["Indica si se debe publicar la opinión."]});
    }
    if (!isSameOrigin(req)) {
      return res.status(403).json({errors: ["Solicitud no permitida."]});
    }
    try {
      const {rowCount} = await pool.query(
        `UPDATE booking_testimonials
          SET is_approved = $2, moderated_at = now()
        WHERE id = $1 AND submitted_at IS NOT NULL`,
        [testimonialId, req.body.approved],
      );
      if (!rowCount) {
        return res
          .status(404)
          .json({errors: ["No se ha encontrado la opinión."]});
      }
      res.json({ok: true});
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/admin/closures", requireAdmin, async (req, res, next) => {
  try {
    const {rows} = await pool.query(
      `SELECT id,
              to_char(start_date, 'YYYY-MM-DD') AS start_date,
              to_char(end_date, 'YYYY-MM-DD') AS end_date,
              reason
         FROM site_closures
        WHERE end_date >= CURRENT_DATE
          AND ($1::boolean = FALSE OR start_date > CURRENT_DATE)
        ORDER BY start_date`,
      [req.query.upcoming === "true"],
    );
    res.set("Cache-Control", "no-store");
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/closures/upcoming", async (req, res, next) => {
  try {
    const {rows} = await pool.query(
      `SELECT id,
              to_char(start_date, 'YYYY-MM-DD') AS start_date,
              to_char(end_date, 'YYYY-MM-DD') AS end_date,
              reason
         FROM site_closures
        WHERE start_date >= CURRENT_DATE
          AND end_date >= CURRENT_DATE
        ORDER BY start_date`,
    );
    res.set("Cache-Control", "public, max-age=60");
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/closures", requireAdmin, async (req, res, next) => {
  const {start_date, end_date, reason = ""} = req.body ?? {};
  const errors = [];
  if (!isDate(start_date) || !isDate(end_date) || end_date < start_date) {
    errors.push(
      "Indica un periodo de cierre con fechas válidas y una fecha final igual o posterior a la inicial.",
    );
  } else if (start_date < today()) {
    errors.push("La fecha de inicio del cierre no puede ser anterior a hoy.");
  }
  if (typeof reason !== "string" || reason.trim().length > 200) {
    errors.push("El motivo del cierre no puede superar los 200 caracteres.");
  }
  if (errors.length) return res.status(400).json({errors});
  if (!isSameOrigin(req)) {
    return res.status(403).json({errors: ["Solicitud no permitida."]});
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE site_closures IN EXCLUSIVE MODE");
    const {rows: conflicts} = await client.query(
      `SELECT id FROM site_closures
        WHERE start_date <= $2 AND end_date >= $1
        LIMIT 1`,
      [start_date, end_date],
    );
    if (conflicts.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        errors: ["Este periodo coincide con otro cierre ya configurado."],
      });
    }
    const {rows} = await client.query(
      `INSERT INTO site_closures (start_date, end_date, reason)
       VALUES ($1, $2, $3)
       RETURNING id, start_date, end_date, reason`,
      [start_date, end_date, reason.trim()],
    );
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.put("/api/admin/closures/:id", requireAdmin, async (req, res, next) => {
  const closureId = Number(req.params.id);
  const {start_date, end_date, reason = ""} = req.body ?? {};
  const errors = [];
  if (!Number.isSafeInteger(closureId) || closureId < 1) {
    errors.push("El periodo de cierre no es válido.");
  }
  if (!isDate(start_date) || !isDate(end_date) || end_date < start_date) {
    errors.push(
      "Indica un periodo de cierre con fechas válidas y una fecha final igual o posterior a la inicial.",
    );
  } else if (start_date < today()) {
    errors.push("La fecha de inicio del cierre no puede ser anterior a hoy.");
  }
  if (typeof reason !== "string" || reason.trim().length > 200) {
    errors.push("El motivo del cierre no puede superar los 200 caracteres.");
  }
  if (errors.length) return res.status(400).json({errors});
  if (!isSameOrigin(req)) {
    return res.status(403).json({errors: ["Solicitud no permitida."]});
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE site_closures IN EXCLUSIVE MODE");
    const {rows: conflicts} = await client.query(
      `SELECT id FROM site_closures
        WHERE id <> $1 AND start_date <= $3 AND end_date >= $2
        LIMIT 1`,
      [closureId, start_date, end_date],
    );
    if (conflicts.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        errors: ["Este periodo coincide con otro cierre ya configurado."],
      });
    }
    const {rows} = await client.query(
      `UPDATE site_closures
          SET start_date = $2, end_date = $3, reason = $4
        WHERE id = $1
        RETURNING id, start_date, end_date, reason`,
      [closureId, start_date, end_date, reason.trim()],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({errors: ["No se ha encontrado el periodo de cierre."]});
    }
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.delete("/api/admin/closures/:id", requireAdmin, async (req, res, next) => {
  const closureId = Number(req.params.id);
  if (!Number.isSafeInteger(closureId) || closureId < 1) {
    return res
      .status(400)
      .json({errors: ["El periodo de cierre no es válido."]});
  }
  if (!isSameOrigin(req)) {
    return res.status(403).json({errors: ["Solicitud no permitida."]});
  }
  try {
    const {rowCount} = await pool.query(
      "DELETE FROM site_closures WHERE id = $1",
      [closureId],
    );
    if (!rowCount) {
      return res
        .status(404)
        .json({errors: ["No se ha encontrado el periodo de cierre."]});
    }
    res.json({ok: true});
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/contact-messages", requireAdmin, async (req, res, next) => {
  const normalizeFilter = (value) => {
    if (typeof value !== "string" || !value.trim()) return undefined;
    return value.trim();
  };
  const fromDate = normalizeFilter(req.query.from_date);
  const toDate = normalizeFilter(req.query.to_date);
  const status = normalizeFilter(req.query.status) ?? "all";
  const search = normalizeFilter(req.query.search) ?? "";
  if (
    (fromDate && !isDate(fromDate)) ||
    (toDate && !isDate(toDate)) ||
    (fromDate && toDate && fromDate > toDate) ||
    !["all", "pending", "responded"].includes(status) ||
    search.length > 120
  ) {
    return res
      .status(400)
      .json({errors: ["Los filtros de mensajes no son válidos."]});
  }

  const conditions = [];
  const values = [];
  const add = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (fromDate) conditions.push(`created_at >= ${add(fromDate)}::date`);
  if (toDate) {
    conditions.push(`created_at < (${add(toDate)}::date + INTERVAL '1 day')`);
  }
  if (status !== "all") conditions.push(`status = ${add(status)}`);
  if (search) {
    const query = add(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`(
      name ILIKE ${query} ESCAPE '\\'
      OR email ILIKE ${query} ESCAPE '\\'
      OR phone ILIKE ${query} ESCAPE '\\'
      OR subject ILIKE ${query} ESCAPE '\\'
      OR message::text ILIKE ${query} ESCAPE '\\'
    )`);
  }

  try {
    const {rows} = await pool.query(
      `SELECT id, name, email, phone, subject, message, status, created_at
         FROM contact_messages
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY created_at DESC, id DESC`,
      values,
    );
    res.set("Cache-Control", "no-store").json(rows);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/admin/contact-messages/:id/reply",
  requireAdmin,
  async (req, res, next) => {
    const id = Number(req.params.id);
    const reply = req.body?.message;
    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      typeof reply !== "string" ||
      reply.trim().length < 2 ||
      reply.trim().length > 5000
    ) {
      return res.status(400).json({errors: ["La respuesta no es válida."]});
    }

    let client;
    let transactionStarted = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      const {rows} = await client.query(
        `SELECT id, name, email, subject
           FROM contact_messages
          WHERE id = $1
          FOR UPDATE`,
        [id],
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({errors: ["No se encontró el mensaje."]});
      }

      const contact = rows[0];
      const body = reply.trim();
      await sendContactReplyEmail({...contact, message: body});
      const responseEntry = {
        role: "hotel",
        body,
        sent_at: new Date().toISOString(),
      };
      await client.query(
        `UPDATE contact_messages
            SET message = message || $2::jsonb,
                status = 'responded'
          WHERE id = $1`,
        [id, JSON.stringify([responseEntry])],
      );
      await client.query("COMMIT");
      transactionStarted = false;
      res.json({ok: true});
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally {
      client?.release();
    }
  },
);

app.delete(
  "/api/admin/contact-messages/:id",
  requireAdmin,
  async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({errors: ["El identificador no es válido."]});
    }
    try {
      const {rowCount} = await pool.query(
        "DELETE FROM contact_messages WHERE id = $1",
        [id],
      );
      if (!rowCount) {
        return res.status(404).json({errors: ["No se encontró el mensaje."]});
      }
      res.json({ok: true});
    } catch (error) {
      next(error);
    }
  },
);

app.post("/api/contact", async (req, res, next) => {
  const {
    name,
    email,
    phone = "",
    subject,
    message,
    privacy_accepted,
  } = req.body ?? {};
  const errors = [];
  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.trim().length > 100 ||
    /[\r\n]/.test(name)
  ) {
    errors.push("Escribe tu nombre (entre 2 y 100 caracteres).");
  }
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    /[\r\n]/.test(email)
  ) {
    errors.push("Escribe un correo electrónico válido.");
  }
  if (typeof phone !== "string" || phone.length > 40 || /[\r\n]/.test(phone)) {
    errors.push("El teléfono no es válido.");
  }
  if (
    typeof subject !== "string" ||
    subject.trim().length < 3 ||
    subject.trim().length > 120 ||
    /[\r\n]/.test(subject)
  ) {
    errors.push("Escribe un asunto (entre 3 y 120 caracteres).");
  }
  if (
    typeof message !== "string" ||
    message.trim().length < 10 ||
    message.trim().length > 5000
  ) {
    errors.push("El mensaje debe tener entre 10 y 5000 caracteres.");
  }
  if (privacy_accepted !== true)
    errors.push(
      "Debes aceptar el tratamiento de los datos para poder responderte.",
    );
  if (errors.length) return res.status(400).json({errors});

  const contactEmail = email.trim().toLowerCase();
  if (contactRateLimitReached(contactEmail)) {
    return res.status(429).json({
      errors: [
        "Has enviado varios mensajes recientemente. Inténtalo de nuevo más tarde.",
      ],
    });
  }

  try {
    const {rows} = await pool.query(
      `INSERT INTO contact_messages
         (name, email, phone, subject, message, privacy_accepted_at)
       VALUES (
         $1, $2, $3, $4,
         jsonb_build_array(jsonb_build_object(
           'role', 'contact', 'body', $5::text, 'sent_at', now()
         )),
         now()
       )
       RETURNING id`,
      [
        name.trim(),
        contactEmail,
        phone.trim(),
        subject.trim(),
        message.trim(),
      ],
    );
    const contactMessageId = rows[0].id;
    let notificationSent = true;
    try {
      await sendContactEmails({
      name: name.trim(),
      email: contactEmail,
      phone: phone.trim(),
      subject: subject.trim(),
      message: message.trim(),
      });
    } catch (emailError) {
      notificationSent = false;
      console.error(
        `El mensaje de contacto ${contactMessageId} quedó guardado, pero no se pudieron enviar sus correos.`,
        emailError,
      );
    }
    res.status(201).json({ok: true, notification_sent: notificationSent});
  } catch (error) {
    next(error);
  }
});

app.get("/api/reservations/:token", async (req, res, next) => {
  const {token} = req.params;
  res.set("Cache-Control", "no-store");
  const qrTokenMatch = /^(\d+)\.([\w-]{43})$/.exec(token);
  let bookingLookup;
  if (qrTokenMatch) {
    const bookingId = Number(qrTokenMatch[1]);
    if (
      !Number.isSafeInteger(bookingId) ||
      String(bookingId) !== qrTokenMatch[1]
    ) {
      return res
        .status(404)
        .json({errors: ["No se ha encontrado la reserva."]});
    }
    const expected = Buffer.from(reservationQrToken(bookingId));
    const received = Buffer.from(qrTokenMatch[2]);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      return res
        .status(404)
        .json({errors: ["No se ha encontrado la reserva."]});
    }
    bookingLookup = {condition: "b.id = $1", value: bookingId};
  } else if (/^[\w-]{43}$/.test(token)) {
    bookingLookup = {
      condition: "b.access_token_hash = $1",
      value: hashToken(token),
    };
  } else {
    return res.status(404).json({errors: ["No se ha encontrado la reserva."]});
  }

  try {
    const {rows} = await pool.query(
      `SELECT b.reservation_code, b.arrival_pin, b.guest_name, b.identity_document, b.email, b.phone,
              b.notes, b.check_in, b.check_out, b.adults, b.children, b.breakfast,
              b.pets, b.total::float8 AS total, b.room_subtotal::float8 AS room_subtotal,
              b.breakfast_total::float8 AS breakfast_total, b.pets_total::float8 AS pets_total,
              b.vat_breakdown,
              b.discount_code, b.discount_amount::float8 AS discount_amount, b.created_at,
              r.name AS room_name, r.description AS room_description, r.capacity AS room_capacity,
              r.features AS room_features, r.image_url AS room_image_url,
              COALESCE((SELECT json_agg(json_build_object('id', ri.id, 'image_url', ri.image_url, 'position', ri.position)
                ORDER BY ri.position, ri.id) FROM room_images ri WHERE ri.room_id = r.id), '[]'::json) AS room_images,
              p.completed_at AS precheckin_completed_at,
              p.identity_document AS precheckin_identity_document,
              p.phone_mobile, p.email AS precheckin_email,
              p.first_name, p.first_surname, p.second_surname, p.sex, p.nationality,
              p.birth_date, p.home_address, p.home_city, p.home_country, p.document_type,
              p.document_support_number, p.document_issue_date, p.document_expiry_date,
              p.phone_landline, p.traveler_count, p.minor_relationships,
              p.arrival_time, p.departure_time, p.preferred_bed,
              COALESCE((p.completed_at IS NULL
                AND p.token_expires_at > now()
                AND (b.check_in::timestamp AT TIME ZONE 'UTC') <= now() + INTERVAL '72 hours'
                AND (b.check_in::timestamp + INTERVAL '1 day') AT TIME ZONE 'UTC' > now()
              ), FALSE) AS precheckin_available,
              (b.check_in::timestamp AT TIME ZONE 'UTC') - INTERVAL '72 hours' AS precheckin_available_from,
              ((b.check_in::timestamp + INTERVAL '1 day') AT TIME ZONE 'UTC') AS precheckin_available_until
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
         LEFT JOIN pre_checkings p ON p.booking_id = b.id
        WHERE ${bookingLookup.condition}`,
      [bookingLookup.value],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({errors: ["No se ha encontrado la reserva."]});
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.get("/api/rooms", async (_req, res, next) => {
  try {
    const {rows} = await pool.query(
      `SELECT id, name, slug, description, price_per_night::float8 AS price_per_night,
              pricing_type, catalog_category, single_price::float8 AS single_price,
              double_price::float8 AS double_price,
              extra_bed_price::float8 AS extra_bed_price,
              capacity, features, image_url, is_active,
              COALESCE((SELECT json_agg(json_build_object('id', ri.id, 'image_url', ri.image_url, 'position', ri.position)
                ORDER BY ri.position, ri.id) FROM room_images ri WHERE ri.room_id = rooms.id), '[]'::json) AS images
         FROM rooms WHERE is_active = TRUE ORDER BY price_per_night DESC`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.use(
  "/api/room-images",
  express.static(roomImageStorageRoot, {fallthrough: false, index: false}),
);
app.use(
  "/api/web-images",
  express.static(webImageStorageRoot, {
    fallthrough: false,
    index: false,
    maxAge: 0,
  }),
);

const isDate = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const date = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
};
function toDateOnly(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()))
      throw new RangeError("Fecha de reserva no válida.");
    const year = String(value.getUTCFullYear()).padStart(4, "0");
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const date = String(value ?? "").slice(0, 10);
  if (!isDate(date)) throw new RangeError("Fecha de reserva no válida.");
  return date;
}
const today = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

async function findActiveClosure(checkIn, checkOut, queryable = pool) {
  const {rows} = await queryable.query(
    `SELECT id, start_date, end_date, reason
       FROM site_closures
      WHERE start_date < $2 AND end_date >= $1
        AND end_date >= CURRENT_DATE
      ORDER BY start_date
      LIMIT 1`,
    [checkIn, checkOut],
  );
  return rows[0] ?? null;
}

function closureMessage(closure) {
  const period = `${formatDateForMessage(toDateOnly(closure.start_date))} al ${formatDateForMessage(toDateOnly(closure.end_date))}`;
  return `El hotel estará cerrado del ${period}${closure.reason ? ` por ${closure.reason}` : ""}. No se aceptan reservas que coincidan con ese periodo.`;
}

function reservationQrToken(bookingId) {
  if (!isAdminJwtConfigured()) {
    throw new Error(
      "No se puede generar un enlace de reserva seguro sin ADMIN_JWT_SECRET.",
    );
  }
  return createHmac("sha256", ADMIN_JWT_SECRET)
    .update(`reservation-qr:${bookingId}`)
    .digest("base64url");
}

function safePrecheckinFilePath(storedPath) {
  if (typeof storedPath !== "string") return null;
  const normalized = storedPath.replaceAll("\\", "/");
  const prefix = "assets/imagenes/pre-checking/";
  if (!normalized.startsWith(prefix)) return null;
  const filePath = resolve(
    documentStorageRoot,
    normalized.slice(prefix.length),
  );
  const pathFromRoot = relative(resolve(documentStorageRoot), filePath);
  if (
    !pathFromRoot ||
    pathFromRoot.startsWith(`..${sep}`) ||
    pathFromRoot === ".."
  )
    return null;
  return filePath;
}

function safePrecheckinObjectPath(storedPath) {
  if (typeof storedPath !== "string" || !storedPath.startsWith("storage:")) return null;
  const objectPath = storedPath.slice("storage:".length);
  if (!objectPath.startsWith("pre-checking/") || objectPath.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return objectPath;
}

async function readPrecheckinDocument(storedPath) {
  const objectPath = safePrecheckinObjectPath(storedPath);
  if (objectPath) return downloadStorageObject(storageBuckets.private, objectPath);
  const filePath = safePrecheckinFilePath(storedPath);
  if (!filePath) throw new Error("La ruta del documento de pre-check-in no es válida.");
  return readFile(filePath);
}

async function removePrecheckinDocuments(paths) {
  const uniquePaths = [
    ...new Set(paths.filter((path) => typeof path === "string")),
  ];
  const unreferencedPaths = [];
  for (const storedPath of uniquePaths) {
    const {rowCount} = await pool.query(
      `SELECT 1 FROM pre_checkings
        WHERE document_front_path = $1 OR document_back_path = $1
        LIMIT 1`,
      [storedPath],
    );
    if (!rowCount) unreferencedPaths.push(storedPath);
  }
  const directories = new Set();
  const cloudObjects = [];
  for (const storedPath of unreferencedPaths) {
    const objectPath = safePrecheckinObjectPath(storedPath);
    if (objectPath) {
      cloudObjects.push(objectPath);
      continue;
    }
    const filePath = safePrecheckinFilePath(storedPath);
    if (!filePath) continue;
    await rm(filePath, {force: true});
    directories.add(dirname(filePath));
  }
  for (const directory of directories) {
    try {
      await rm(directory, {recursive: false, force: true});
    } catch (error) {
      if (error.code !== "ENOTEMPTY") throw error;
    }
  }
  await removeStorageObjects(storageBuckets.private, cloudObjects);
}

const adminBookingFields = `
  b.id, b.room_id, b.guest_name, b.identity_document, b.email, b.phone,
  b.check_in, b.check_out, b.adults, b.children, b.breakfast, b.pets,
  b.notes, b.total::float8 AS total, b.room_subtotal::float8 AS room_subtotal,
  b.breakfast_total::float8 AS breakfast_total, b.pets_total::float8 AS pets_total,
  b.vat_breakdown,
  b.discount_code, b.discount_amount::float8 AS discount_amount,
  b.discount_percent::float8 AS discount_percent,
  b.arrival_pin, b.reservation_code, b.created_at,
  r.name AS room_name, r.description AS room_description, r.features AS room_features,
  r.price_per_night::float8 AS room_price_per_night,
  p.completed_at AS precheckin_completed_at,
  p.identity_document AS precheckin_identity_document,
  p.phone_mobile, p.email AS precheckin_email,
  p.first_name, p.first_surname, p.second_surname, p.sex, p.nationality,
  p.birth_date, p.home_address, p.home_city, p.home_country, p.document_type,
  p.document_support_number, p.document_issue_date, p.document_expiry_date,
  p.phone_landline, p.traveler_count, p.minor_relationships,
  p.arrival_time, p.departure_time, p.preferred_bed,
  p.terms_accepted_at, p.marketing_consent, p.signature,
  p.document_front_path, p.document_back_path`;

const sesPaymentTypes = new Set([
  "EFECT",
  "TARJT",
  "PLATF",
  "TRANS",
  "MOVIL",
  "TREG",
  "OTRO",
  "DESTI",
]);
const sesDocumentTypes = new Set(["NIF", "NIE", "PAS", "OTRO", "CIF"]);
const sesSexValues = new Set(["H", "M", "O"]);
const sesRelationshipValues = new Set([
  "AB",
  "BA",
  "BN",
  "CY",
  "CD",
  "HR",
  "HJ",
  "PM",
  "NI",
  "SB",
  "SG",
  "TI",
  "YN",
  "TU",
  "OT",
]);

function validateSesPerson(person, label, errors) {
  const required = [
    ["first_name", "nombre"],
    ["first_surname", "primer apellido"],
    ["document_number", "número de documento"],
    ["birth_date", "fecha de nacimiento"],
    ["nationality_code", "nacionalidad ISO alfa-3"],
    ["address", "dirección"],
    ["postal_code", "código postal"],
    ["country_code", "país ISO alfa-3"],
    ["phone", "teléfono"],
    ["email", "correo"],
  ];
  for (const [field, description] of required) {
    if (typeof person[field] !== "string" || !person[field].trim()) {
      errors.push(`${label}: falta ${description}.`);
    }
  }
  if (!sesDocumentTypes.has(person.document_type)) {
    errors.push(`${label}: el tipo de documento no es válido.`);
  }
  if (person.document_type !== "PAS" && !person.document_support?.trim()) {
    errors.push(`${label}: falta el número de soporte del documento.`);
  }
  if (!sesSexValues.has(person.sex)) {
    errors.push(`${label}: el sexo debe ser H, M u O.`);
  }
  if (!/^[A-Z]{3}$/.test(person.nationality_code ?? "")) {
    errors.push(`${label}: la nacionalidad debe ser un código ISO alfa-3.`);
  }
  if (!/^[A-Z]{3}$/.test(person.country_code ?? "")) {
    errors.push(
      `${label}: el país de residencia debe ser un código ISO alfa-3.`,
    );
  } else if (person.country_code === "ESP") {
    if (!/^\d{5}$/.test(person.municipality_code ?? "")) {
      errors.push(
        `${label}: indica el código INE de municipio de cinco dígitos.`,
      );
    }
  } else if (!person.municipality_name?.trim()) {
    errors.push(`${label}: indica el nombre del municipio de residencia.`);
  }
  if (!isDate(person.birth_date)) {
    errors.push(`${label}: la fecha de nacimiento no es válida.`);
  }
  if (person.relationship && !sesRelationshipValues.has(person.relationship)) {
    errors.push(`${label}: el parentesco no es válido.`);
  }
  if (
    typeof person.email === "string" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)
  ) {
    errors.push(`${label}: el correo electrónico no es válido.`);
  }
}

async function sendBookingEmailForAdmin(booking, {token, accessToken}) {
  const checkIn = toDateOnly(booking.check_in);
  const checkOut = toDateOnly(booking.check_out);
  const nights = Math.round(
    (Date.parse(`${checkOut}T00:00:00.000Z`) -
      Date.parse(`${checkIn}T00:00:00.000Z`)) /
      86_400_000,
  );
  const reservationPdf = await createBookingPdf(booking, {
    includePrecheckin: false,
  });
  const attachments = booking.precheckin_completed_at
    ? [
        {
          filename: `pre-check-in-${booking.reservation_code}.pdf`,
          content: await createPrecheckinPdf(booking),
        },
      ]
    : [];
  await sendBookingConfirmationEmail({
    email: booking.email,
    guestName: booking.guest_name,
    reference: booking.reservation_code,
    roomName: booking.room_name,
    roomFeatures: booking.room_features ?? [],
    checkIn,
    checkOut,
    adults: booking.adults,
    children: booking.children,
    nights,
    breakfast: booking.breakfast,
    breakfastTotal: Number(booking.breakfast_total),
    pets: booking.pets,
    petsTotal: Number(booking.pets_total),
    roomSubtotal: Number(booking.room_subtotal),
    discountCode: booking.discount_code ?? null,
    discountAmount: Number(booking.discount_amount ?? 0),
    vatBreakdown: booking.vat_breakdown ?? [],
    total: Number(booking.total),
    token,
    accessToken,
    arrivalPin: booking.arrival_pin,
    reservationPdf,
    attachments,
  });
}

async function createBookingPdf(booking, {includePrecheckin = true} = {}) {
  const checkIn = toDateOnly(booking.check_in);
  const checkOut = toDateOnly(booking.check_out);
  const nights = Math.round(
    (Date.parse(`${checkOut}T00:00:00.000Z`) -
      Date.parse(`${checkIn}T00:00:00.000Z`)) /
      86_400_000,
  );
  const pdfUrl = reservationDetailsUrl(
    `${booking.id}.${reservationQrToken(booking.id)}`,
  );
  const qrImage = await QRCode.toBuffer(pdfUrl.href, {
    type: "png",
    width: 240,
    margin: 1,
    errorCorrectionLevel: "M",
    color: {dark: "#244536", light: "#ffffff"},
  });
  const imageEntries = [];
  if (
    includePrecheckin &&
    booking.precheckin_completed_at &&
    !booking.document_front_path
  ) {
    throw new Error(
      `El pre-check-in de la reserva ${booking.reservation_code} no tiene el documento frontal guardado.`,
    );
  }
  for (const [label, storedPath] of [
    ...(includePrecheckin
      ? [
          ["Documento de identidad (anverso)", booking.document_front_path],
          ["Documento de identidad (reverso)", booking.document_back_path],
        ]
      : []),
  ]) {
    if (!storedPath) continue;
    let image = await readPrecheckinDocument(storedPath);
    if (image.toString("ascii", 8, 12) === "WEBP") {
      image = await sharp(image).png().toBuffer();
    }
    imageEntries.push([label, image]);
  }
  const site = await readSiteSettings();

  return new Promise((resolvePdf, rejectPdf) => {
    const pdf = new PDFDocument({
      size: "A4",
      margin: 44,
      info: {Title: `Reserva ${booking.reservation_code}`},
    });
    const chunks = [];
    const color = {
      forest: "#244536",
      forestDark: "#1d332b",
      clay: "#b87958",
      ink: "#292b27",
      muted: "#74766f",
      paper: "#f7f5ef",
      line: "#e6e2d9",
      white: "#ffffff",
    };
    const margin = 44;
    const contentWidth = pdf.page.width - margin * 2;
    const bottomLimit = pdf.page.height - margin - 24;
    let pageNumber = 1;
    const drawFooter = () => {
      pdf.save();
      pdf
        .strokeColor(color.line)
        .lineWidth(0.7)
        .moveTo(margin, pdf.page.height - 34)
        .lineTo(pdf.page.width - margin, pdf.page.height - 34)
        .stroke();
      pdf
        .font("Helvetica")
        .fontSize(7)
        .fillColor(color.muted)
        .text(
          `${site.site_name.slice(0, 64)} · Documento confidencial`,
          margin,
          pdf.page.height - 25,
          {
            lineBreak: false,
          },
        );
      pdf.text(
        `Página ${pageNumber}`,
        pdf.page.width - margin - 55,
        pdf.page.height - 25,
        {
          lineBreak: false,
        },
      );
      pdf.restore();
    };
    pdf.on("pageAdded", () => {
      pageNumber += 1;
      drawFooter();
    });
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("error", rejectPdf);
    pdf.on("end", () => resolvePdf(Buffer.concat(chunks)));

    pdf.rect(0, 0, pdf.page.width, 190).fill(color.forest);
    pdf
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#d9c8a4")
      .text(site.site_name.toLocaleUpperCase("es-ES"), margin, 37, {
        characterSpacing: 1.4,
      });
    pdf
      .font("Helvetica-Bold")
      .fontSize(23)
      .fillColor(color.white)
      .text("Informe de reserva", margin, 62, {width: contentWidth - 132});
    pdf
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#e5ebe5")
      .text(booking.guest_name, margin, 98, {width: contentWidth - 132});
    pdf
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(color.white)
      .text(booking.reservation_code, margin, 117, {width: contentWidth - 132});
    pdf
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#e5ebe5")
      .text(
        `${formatDateForEmail(checkIn)}  ·  ${nights} ${nights === 1 ? "noche" : "noches"}  ·  ${booking.room_name}`,
        margin,
        139,
        {width: contentWidth - 132},
      );
    const qrX = pdf.page.width - margin - 102;
    pdf.roundedRect(qrX - 7, 37, 109, 119, 5).fill(color.white);
    pdf.image(qrImage, qrX, 44, {width: 95, height: 95});
    pdf
      .fontSize(7)
      .fillColor(color.forest)
      .text("ESCANEAR PARA VER", qrX - 1, 145, {width: 97, align: "center"});

    pdf.roundedRect(margin, 169, contentWidth, 41, 5).fill("#f3eee4");
    pdf
      .font("Helvetica")
      .fontSize(7)
      .fillColor(color.muted)
      .text("PIN DE LLEGADA", margin + 13, 177);
    pdf
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor(color.forestDark)
      .text(booking.arrival_pin, margin + 13, 187);
    const statusText = booking.precheckin_completed_at
      ? "PRE-CHECK-IN COMPLETADO"
      : "PRE-CHECK-IN PENDIENTE";
    pdf
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(color.forest)
      .text(statusText, pdf.page.width - margin - 190, 185, {
        width: 177,
        align: "right",
      });
    pdf.y = 230;

    const drawSection = (title, fields) => {
      const headingHeight = 25;
      const maxFieldLines = 24;
      const wrapText = (text, width) => {
        const maxLineLength = Math.max(16, Math.floor((width - 18) / 5.2));
        const lines = [];
        let line = "";
        for (const word of text.split(/\s+/u)) {
          if (!word) continue;
          const parts = [];
          for (let offset = 0; offset < word.length; offset += maxLineLength) {
            parts.push(word.slice(offset, offset + maxLineLength));
          }
          for (const part of parts) {
            if (line && line.length + part.length + 1 > maxLineLength) {
              lines.push(line);
              line = "";
            }
            line = line ? `${line} ${part}` : part;
          }
        }
        if (line) lines.push(line);
        return lines.length ? lines : [""];
      };
      const expandedFields = fields.flatMap(
        ([label, rawValue, wide = false]) => {
          const value =
            rawValue === null || rawValue === undefined || rawValue === ""
              ? "No indicado"
              : String(rawValue);
          const lines = wrapText(value, contentWidth);
          if (lines.length <= maxFieldLines) {
            return [[label, value, wide]];
          }
          const chunks = [];
          for (let offset = 0; offset < lines.length; offset += maxFieldLines) {
            chunks.push([
              offset === 0 ? label : `${label} (continuación)`,
              lines.slice(offset, offset + maxFieldLines).join("\n"),
              true,
            ]);
          }
          return chunks;
        },
      );
      if (pdf.y + headingHeight + 35 > bottomLimit) {
        pdf.addPage();
        pdf.y = margin;
      }
      const sectionX = margin;
      pdf
        .roundedRect(sectionX, pdf.y, contentWidth, headingHeight, 4)
        .fill(color.forest);
      pdf
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(color.white)
        .text(title, sectionX + 12, pdf.y + 7, {width: contentWidth - 24});
      pdf.y += headingHeight + 6;

      for (let index = 0; index < expandedFields.length; ) {
        const [label, rawValue, wide = false] = expandedFields[index];
        const paired =
          !wide &&
          index + 1 < expandedFields.length &&
          !expandedFields[index + 1][2];
        const columnGap = 14;
        const columnWidth = paired
          ? (contentWidth - columnGap) / 2
          : contentWidth;
        const value = wrapText(String(rawValue), columnWidth - 18).join("\n");
        const nextLabel = paired ? expandedFields[index + 1][0] : null;
        const nextValueRaw = paired ? expandedFields[index + 1][1] : null;
        const nextValue =
          nextValueRaw === null ||
          nextValueRaw === undefined ||
          nextValueRaw === ""
            ? "No indicado"
            : wrapText(String(nextValueRaw), columnWidth - 18).join("\n");
        const rowHeightFor = (text, width) => {
          pdf.font("Helvetica").fontSize(9);
          return Math.max(29, pdf.heightOfString(text, {width}) + 20);
        };
        const rowHeight = Math.max(
          rowHeightFor(value, columnWidth - 18),
          paired ? rowHeightFor(nextValue, columnWidth - 18) : 0,
        );
        if (pdf.y + rowHeight > bottomLimit) {
          pdf.addPage();
          pdf.y = margin;
          pdf
            .roundedRect(sectionX, pdf.y, contentWidth, headingHeight, 4)
            .fill(color.forest);
          pdf
            .font("Helvetica-Bold")
            .fontSize(10)
            .fillColor(color.white)
            .text(title, sectionX + 12, pdf.y + 7, {width: contentWidth - 24});
          pdf.y += headingHeight + 6;
        }
        const rowY = pdf.y;
        const drawField = (fieldLabel, fieldValue, x, width) => {
          pdf.roundedRect(x, rowY, width, rowHeight - 4, 3).fill(color.paper);
          pdf
            .font("Helvetica-Bold")
            .fontSize(6.5)
            .fillColor(color.muted)
            .text(String(fieldLabel).toUpperCase(), x + 9, rowY + 6, {
              width: width - 18,
            });
          pdf
            .font("Helvetica")
            .fontSize(9)
            .fillColor(color.ink)
            .text(fieldValue, x + 9, rowY + 15, {width: width - 18});
        };
        drawField(label, value, sectionX, columnWidth);
        if (paired) {
          drawField(
            nextLabel,
            nextValue,
            sectionX + columnWidth + columnGap,
            columnWidth,
          );
          index += 2;
        } else {
          index += 1;
        }
        pdf.y += rowHeight;
      }
      pdf.y += 12;
    };

    drawSection("ESTANCIA", [
      ["Habitación", booking.room_name],
      [
        "Precio por noche actual",
        formatCurrency(Number(booking.room_price_per_night)),
      ],
      ["Entrada", formatDateForMessage(checkIn)],
      ["Salida", formatDateForMessage(checkOut)],
      ["Duración", `${nights} ${nights === 1 ? "noche" : "noches"}`],
      ["Huéspedes", `${booking.adults} adultos · ${booking.children} niños`],
      ["Desayuno", booking.breakfast ? "Incluido" : "No incluido"],
      ["Mascotas", booking.pets ? "Sí" : "No"],
      [
        "Características",
        (booking.room_features ?? []).join(", ") || "No indicadas",
        true,
      ],
      ["Descripción", booking.room_description || "No disponible", true],
    ]);
    drawSection("DATOS DEL HUÉSPED", [
      ["Nombre", booking.guest_name],
      ["Documento", booking.identity_document],
      ["Email", booking.email],
      ["Teléfono", booking.phone],
      ["Observaciones", booking.notes || "Ninguna", true],
    ]);
    drawSection("DESGLOSE DEL PRECIO", [
      ["Habitación", formatCurrency(Number(booking.room_subtotal))],
      ["Desayuno", formatCurrency(Number(booking.breakfast_total))],
      ["Mascotas", formatCurrency(Number(booking.pets_total))],
      ...(Number(booking.discount_amount) > 0
        ? [
            [
              `Descuento${booking.discount_code ? ` · ${booking.discount_code}` : ""}`,
              `−${formatCurrency(Number(booking.discount_amount))}`,
            ],
          ]
        : []),
      ...(Array.isArray(booking.vat_breakdown)
        ? booking.vat_breakdown.flatMap((item) => [
            [`IVA incluido · ${item.rate}% · base`, formatCurrency(Number(item.taxable_base))],
            [`IVA incluido · ${item.rate}% · cuota`, formatCurrency(Number(item.vat))],
          ])
        : []),
      ["TOTAL", formatCurrency(Number(booking.total))],
    ]);

    if (includePrecheckin && booking.precheckin_completed_at) {
      const formatOptionalDate = (value) =>
        value ? formatDateForMessage(toDateOnly(value)) : "No indicado";
      drawSection("PRE-CHECK-IN · IDENTIDAD Y CONTACTO", [
        ["Nombre", booking.first_name],
        ["Primer apellido", booking.first_surname],
        ["Segundo apellido", booking.second_surname],
        ["Documento", booking.precheckin_identity_document],
        ["Tipo de documento", booking.document_type],
        ["N.º de soporte", booking.document_support_number],
        ["Nacimiento", formatOptionalDate(booking.birth_date)],
        ["Sexo", booking.sex],
        ["Nacionalidad", booking.nationality],
        ["Expedición", formatOptionalDate(booking.document_issue_date)],
        ["Caducidad", formatOptionalDate(booking.document_expiry_date)],
        ["Móvil", booking.phone_mobile],
        ["Teléfono fijo", booking.phone_landline],
        ["Email de pre-check-in", booking.precheckin_email, true],
        ["Dirección", booking.home_address],
        ["Ciudad", booking.home_city],
        ["País", booking.home_country],
      ]);
      drawSection("PRE-CHECK-IN · ESTANCIA Y CONSENTIMIENTOS", [
        ["Número de viajeros", booking.traveler_count],
        ["Relación con menores", booking.minor_relationships],
        ["Hora de llegada", booking.arrival_time],
        ["Hora de salida", booking.departure_time],
        ["Cama preferida", booking.preferred_bed],
        [
          "Condiciones aceptadas",
          booking.terms_accepted_at
            ? new Date(booking.terms_accepted_at).toLocaleString("es-ES")
            : "No indicado",
          true,
        ],
        ["Consentimiento comercial", booking.marketing_consent ? "Sí" : "No"],
        ["Firma", booking.signature, true],
      ]);
    }

    for (const [label, image] of imageEntries) {
      pdf.addPage();
      pdf.rect(0, 0, pdf.page.width, 80).fill(color.forest);
      pdf
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor(color.white)
        .text("DOCUMENTACIÓN DE IDENTIDAD", margin, 30);
      pdf
        .font("Helvetica")
        .fontSize(10)
        .fillColor(color.ink)
        .text(label, margin, 100);
      pdf.image(image, {
        fit: [contentWidth, pdf.page.height - 190],
        align: "center",
        valign: "center",
      });
    }
    drawFooter();
    pdf.end();
  });
}

async function createPrecheckinPdf(booking) {
  if (!booking.precheckin_completed_at || !booking.document_front_path) {
    throw new Error(
      `El pre-check-in de la reserva ${booking.reservation_code} no tiene el documento frontal guardado.`,
    );
  }
  const imageEntries = [];
  for (const [label, storedPath] of [
    ["Documento de identidad · anverso", booking.document_front_path],
    ["Documento de identidad · reverso", booking.document_back_path],
  ]) {
    if (!storedPath) continue;
    const image = await readPrecheckinDocument(storedPath);
    const optimizedImage = await sharp(image)
      .rotate()
      .resize({
        width: 1400,
        height: 1800,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({quality: 84})
      .toBuffer();
    const {width, height} = await sharp(optimizedImage).metadata();
    if (!width || !height) {
      throw new Error(
        `No se pudieron leer las dimensiones del documento de la reserva ${booking.reservation_code}.`,
      );
    }
    imageEntries.push([label, optimizedImage, width, height]);
  }

  const site = await readSiteSettings();
  const checkIn = formatDateForMessage(toDateOnly(booking.check_in));
  const checkOut = formatDateForMessage(toDateOnly(booking.check_out));
  const formatOptionalDate = (value) =>
    value ? formatDateForMessage(toDateOnly(value)) : "No indicado";
  const sections = [
    [
      "RESERVA",
      [
        ["Código de reserva", booking.reservation_code],
        ["Habitación", booking.room_name],
        ["Entrada", checkIn],
        ["Salida", checkOut],
        ["Adultos", booking.adults],
        ["Niños", booking.children],
        ["Alojamiento", formatCurrency(Number(booking.room_subtotal))],
        ["Desayuno", formatCurrency(Number(booking.breakfast_total))],
        ["Mascotas", formatCurrency(Number(booking.pets_total))],
        ...(Number(booking.discount_amount) > 0
          ? [[`Descuento${booking.discount_code ? ` · ${booking.discount_code}` : ""}`, `−${formatCurrency(Number(booking.discount_amount))}`]]
          : []),
        ...(Array.isArray(booking.vat_breakdown)
          ? booking.vat_breakdown.flatMap((item) => [
              [`IVA incluido · ${item.rate}% · base`, formatCurrency(Number(item.taxable_base))],
              [`IVA incluido · ${item.rate}% · cuota`, formatCurrency(Number(item.vat))],
            ])
          : []),
        ["Total", formatCurrency(Number(booking.total))],
      ],
    ],
    [
      "IDENTIDAD Y CONTACTO",
      [
        ["Nombre", booking.first_name],
        ["Primer apellido", booking.first_surname],
        ["Segundo apellido", booking.second_surname],
        ["Documento", booking.precheckin_identity_document],
        ["Tipo de documento", booking.document_type],
        ["Número de soporte", booking.document_support_number],
        ["Fecha de nacimiento", formatOptionalDate(booking.birth_date)],
        ["Sexo", booking.sex],
        ["Nacionalidad", booking.nationality],
        [
          "Fecha de expedición",
          formatOptionalDate(booking.document_issue_date),
        ],
        [
          "Fecha de caducidad",
          formatOptionalDate(booking.document_expiry_date),
        ],
        ["Teléfono móvil", booking.phone_mobile],
        ["Teléfono fijo", booking.phone_landline],
        ["Email indicado", booking.precheckin_email],
        ["Dirección", booking.home_address],
        ["Ciudad", booking.home_city],
        ["País", booking.home_country],
      ],
    ],
    [
      "ESTANCIA Y CONSENTIMIENTOS",
      [
        ["Número de viajeros", booking.traveler_count],
        ["Relación con menores", booking.minor_relationships],
        ["Hora estimada de llegada", booking.arrival_time],
        ["Hora estimada de salida", booking.departure_time],
        ["Cama preferida", booking.preferred_bed],
        [
          "Condiciones aceptadas",
          booking.terms_accepted_at
            ? new Date(booking.terms_accepted_at).toLocaleString("es-ES")
            : "No indicado",
        ],
        ["Consentimiento comercial", booking.marketing_consent ? "Sí" : "No"],
        ["Firma", booking.signature],
      ],
    ],
  ];

  return new Promise((resolvePdf, rejectPdf) => {
    const pdf = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {Title: `Pre-check-in ${booking.reservation_code}`},
    });
    const chunks = [];
    const pageWidth = pdf.page.width;
    const contentWidth = pageWidth - 96;
    const bottomLimit = pdf.page.height - 48;
    const drawPageHeader = (continuation = false) => {
      pdf.rect(0, 0, pageWidth, 86).fill("#244536");
      pdf
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#d9c8a4")
        .text(site.site_name.toLocaleUpperCase("es-ES").slice(0, 80), 48, 24, {
          lineBreak: false,
        });
      pdf
        .font("Helvetica-Bold")
        .fontSize(18)
        .fillColor("#ffffff")
        .text(
          continuation
            ? "Pre-check-in · continuación"
            : "Pre-check-in completado",
          48,
          43,
          {lineBreak: false},
        );
      pdf.y = 104;
    };
    const nextPage = () => {
      pdf.addPage();
      drawPageHeader(true);
    };
    const ensureSpace = (height) => {
      if (pdf.y + height > bottomLimit) nextPage();
    };
    const drawSectionTitle = (title) => {
      ensureSpace(38);
      pdf.roundedRect(48, pdf.y, contentWidth, 25, 4).fill("#244536");
      pdf
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor("#ffffff")
        .text(title, 59, pdf.y + 7, {lineBreak: false});
      pdf.y += 34;
    };
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("error", rejectPdf);
    pdf.on("end", () => resolvePdf(Buffer.concat(chunks)));
    drawPageHeader();
    pdf
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#292b27")
      .text(`${booking.guest_name} · ${booking.reservation_code}`, 48, pdf.y, {
        width: contentWidth,
      });
    pdf.y += 24;
    for (const [title, fields] of sections) {
      drawSectionTitle(title);
      for (const [label, rawValue] of fields) {
        const value =
          rawValue === null || rawValue === undefined || rawValue === ""
            ? "No indicado"
            : String(rawValue).slice(0, 3000);
        const chunksOfValue = value.match(/.{1,420}(?:\s|$)|.{1,420}/gs) ?? [
          value,
        ];
        for (let index = 0; index < chunksOfValue.length; index += 1) {
          const fieldLabel = index === 0 ? label : `${label} · continuación`;
          const fieldValue = chunksOfValue[index].trim();
          pdf.font("Helvetica").fontSize(8).fillColor("#74766f");
          const labelHeight = pdf.heightOfString(fieldLabel, {
            width: contentWidth,
          });
          pdf.font("Helvetica").fontSize(10).fillColor("#292b27");
          const valueHeight = pdf.heightOfString(fieldValue || " ", {
            width: contentWidth,
          });
          ensureSpace(labelHeight + valueHeight + 20);
          pdf
            .font("Helvetica")
            .fontSize(8)
            .fillColor("#74766f")
            .text(fieldLabel, 48, pdf.y, {width: contentWidth});
          pdf.y += labelHeight + 2;
          pdf
            .font("Helvetica")
            .fontSize(10)
            .fillColor("#292b27")
            .text(fieldValue || " ", 48, pdf.y, {width: contentWidth});
          pdf.y += valueHeight + 10;
        }
      }
      pdf.y += 8;
    }
    for (const [label, image, imageWidth, imageHeight] of imageEntries) {
      nextPage();
      pdf
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#244536")
        .text(label, 48, pdf.y, {lineBreak: false});
      pdf.y += 28;
      const availableHeight = pdf.page.height - pdf.y - 48;
      const scale = Math.min(
        contentWidth / imageWidth,
        availableHeight / imageHeight,
      );
      const renderedWidth = imageWidth * scale;
      const renderedHeight = imageHeight * scale;
      const imageX = 48 + (contentWidth - renderedWidth) / 2;
      const imageY = pdf.y + (availableHeight - renderedHeight) / 2;
      pdf.image(image, imageX, imageY, {
        width: renderedWidth,
        height: renderedHeight,
      });
    }
    pdf.end();
  });
}

async function sendPrecheckinCompletedEmail(booking, pdfAttachment) {
  const site = await readSiteSettings();
  const safeGuestName = escapeHtml(booking.guest_name);
  const safeSiteName = escapeHtml(site.site_name);
  const optionalDate = (value) =>
    value ? formatDateForMessage(toDateOnly(value)) : "No indicado";
  const optionalValue = (value) =>
    value === null || value === undefined || value === ""
      ? "No indicado"
      : String(value);
  const acceptedAt = booking.terms_accepted_at
    ? new Intl.DateTimeFormat("es-ES", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(booking.terms_accepted_at))
    : "No indicado";
  const summarySections = [
    [
      "Reserva y estancia",
      [
        ["Código de reserva", booking.reservation_code],
        ["Habitación", booking.room_name],
        ["Entrada", optionalDate(booking.check_in)],
        ["Salida", optionalDate(booking.check_out)],
        ["Huéspedes", `${booking.adults} adultos · ${booking.children} niños`],
        ["Alojamiento", formatCurrency(Number(booking.room_subtotal))],
        ["Desayuno", formatCurrency(Number(booking.breakfast_total))],
        ["Mascotas", formatCurrency(Number(booking.pets_total))],
        ...(Number(booking.discount_amount) > 0
          ? [[`Descuento${booking.discount_code ? ` · ${booking.discount_code}` : ""}`, `−${formatCurrency(Number(booking.discount_amount))}`]]
          : []),
        ...(Array.isArray(booking.vat_breakdown)
          ? booking.vat_breakdown.flatMap((item) => [
              [`IVA incluido · ${item.rate}% · base`, formatCurrency(Number(item.taxable_base))],
              [`IVA incluido · ${item.rate}% · cuota`, formatCurrency(Number(item.vat))],
            ])
          : []),
        ["Total", formatCurrency(Number(booking.total))],
      ],
    ],
    [
      "Identidad y contacto",
      [
        ["Nombre", booking.guest_name],
        ["Documento", booking.precheckin_identity_document],
        ["Tipo de documento", booking.document_type],
        ["Número de soporte", booking.document_support_number],
        ["Fecha de nacimiento", optionalDate(booking.birth_date)],
        ["Sexo", booking.sex],
        ["Nacionalidad", booking.nationality],
        ["Email", booking.precheckin_email],
        ["Teléfono móvil", booking.phone_mobile],
        ["Teléfono fijo", booking.phone_landline],
        ["Dirección", booking.home_address],
        ["Ciudad", booking.home_city],
        ["País", booking.home_country],
      ],
    ],
    [
      "Preferencias y consentimientos",
      [
        ["Número de viajeros", booking.traveler_count],
        ["Relación con menores", booking.minor_relationships],
        ["Hora estimada de llegada", booking.arrival_time],
        ["Hora estimada de salida", booking.departure_time],
        ["Cama preferida", booking.preferred_bed],
        ["Condiciones aceptadas", acceptedAt],
        ["Consentimiento comercial", booking.marketing_consent ? "Sí" : "No"],
        ["Firma digital", "Recibida"],
      ],
    ],
  ].map(([title, fields]) => [
    title,
    fields.map(([label, value]) => [label, optionalValue(value)]),
  ]);
  const summaryText = summarySections
    .map(([title, fields]) =>
      [title, ...fields.map(([label, value]) => `${label}: ${value}`)].join(
        "\n",
      ),
    )
    .join("\n\n");
  const summaryHtml = summarySections
    .map(
      ([title, fields]) => `
    <section style="margin-top:20px;padding:18px;border:1px solid #e6e2d9;background:#fcfbf8">
      <h2 style="margin:0 0 12px;color:#244536;font-size:16px">${escapeHtml(title)}</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        ${fields
          .map(
            ([label, value]) => `
          <tr>
            <td style="width:42%;padding:7px 10px 7px 0;border-bottom:1px solid #eae8e0;color:#74766f;font-size:13px;vertical-align:top">${escapeHtml(label)}</td>
            <td style="padding:7px 0;border-bottom:1px solid #eae8e0;color:#292b27;font-size:13px;overflow-wrap:anywhere">${escapeHtml(value)}</td>
          </tr>`,
          )
          .join("")}
      </table>
    </section>`,
    )
    .join("");
  await mailer.sendMail({
    from: EMAIL_FROM,
    to: booking.email,
    subject: `Pre-check-in completado · ${booking.reservation_code} | ${site.site_name}`,
    text: [
      `Hola ${booking.guest_name},`,
      "",
      "Hemos recibido correctamente los datos de tu pre-check-in.",
      "",
      "RESUMEN DE TU PRE-CHECK-IN",
      summaryText,
      "",
      `Adjuntamos el resumen en PDF de la reserva ${booking.reservation_code}.`,
      "",
      `¡Gracias!`,
      site.site_name,
    ].join("\n"),
    html: `<div style="max-width:620px;margin:0 auto;padding:32px;background:#f7f5ef;color:#292b27;font-family:Arial,Helvetica,sans-serif;line-height:1.6">
      <div style="padding:24px;background:#244536;color:#fff">
        <p style="margin:0 0 8px;color:#d9c8a4;font-size:12px;letter-spacing:1px;text-transform:uppercase">${safeSiteName}</p>
        <h1 style="margin:0;font-size:24px">Pre-check-in completado</h1>
      </div>
      <div style="padding:24px;background:#fff">
        <p>Hola ${safeGuestName},</p>
        <p>Hemos recibido correctamente los datos de tu pre-check-in para la reserva <strong>${escapeHtml(booking.reservation_code)}</strong>.</p>
        <p>Aquí tienes un resumen de la información que nos has facilitado:</p>
        ${summaryHtml}
        <p style="margin-top:22px">Adjuntamos también este resumen en PDF.</p>
        <p>Gracias por completar el proceso. ¡Te esperamos!</p>
        <p><strong>${safeSiteName}</strong></p>
      </div>
    </div>`,
    attachments: [
      {
        filename: `pre-check-in-${booking.reservation_code}.pdf`,
        content: pdfAttachment,
      },
    ],
  });
}

app.get("/api/admin/bookings", requireAdmin, async (req, res, next) => {
  const normalizeFilter = (value) => {
    if (
      typeof value !== "string" ||
      ["", "undefined", "null"].includes(value.trim().toLowerCase())
    ) {
      return undefined;
    }
    return value.trim();
  };
  const fromDate = normalizeFilter(req.query.from_date);
  const toDate = normalizeFilter(req.query.to_date);
  const precheck = normalizeFilter(req.query.precheck) ?? "all";
  const search = normalizeFilter(req.query.search) ?? "";
  if (
    (fromDate && !isDate(fromDate)) ||
    (toDate && !isDate(toDate)) ||
    (fromDate && toDate && fromDate > toDate) ||
    !["all", "completed", "pending"].includes(precheck) ||
    typeof search !== "string" ||
    search.length > 120
  ) {
    return res
      .status(400)
      .json({errors: ["Los filtros de reservas no son válidos."]});
  }
  const conditions = [];
  const values = [];
  const add = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (fromDate) conditions.push(`b.check_in >= ${add(fromDate)}`);
  if (toDate) conditions.push(`b.check_in <= ${add(toDate)}`);
  if (precheck === "completed") conditions.push("p.completed_at IS NOT NULL");
  if (precheck === "pending") conditions.push("p.completed_at IS NULL");
  if (search.trim()) {
    const query = add(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`(b.guest_name ILIKE ${query} ESCAPE '\\'
      OR b.identity_document ILIKE ${query} ESCAPE '\\'
      OR b.phone ILIKE ${query} ESCAPE '\\'
      OR b.arrival_pin ILIKE ${query} ESCAPE '\\'
      OR b.reservation_code ILIKE ${query} ESCAPE '\\')`);
  }
  try {
    const {rows} = await pool.query(
      `SELECT b.id, b.room_id, b.guest_name, b.identity_document, b.email, b.phone,
              b.check_in, b.check_out, b.adults, b.children, b.breakfast, b.pets,
              b.notes, b.arrival_pin, b.reservation_code,
              r.name AS room_name, p.completed_at AS precheckin_completed_at
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
         LEFT JOIN pre_checkings p ON p.booking_id = b.id
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY b.check_in DESC, b.created_at DESC`,
      values,
    );
    res.set("Cache-Control", "no-store").json(rows);
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/admin/ses-hospedajes/settings",
  requireAdmin,
  async (_req, res, next) => {
    try {
      const {rows} = await pool.query(
        `SELECT establishment_code, internet_available
         FROM ses_hospedajes_settings WHERE id = 1`,
      );
      res.set("Cache-Control", "no-store").json(rows[0]);
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/admin/ses-hospedajes/settings",
  requireAdmin,
  async (req, res, next) => {
    const {establishment_code, internet_available} = req.body ?? {};
    if (
      typeof establishment_code !== "string" ||
      establishment_code.trim().length > 100 ||
      typeof internet_available !== "boolean"
    ) {
      return res.status(400).json({
        errors: [
          "El código del establecimiento o la disponibilidad de internet no son válidos.",
        ],
      });
    }
    try {
      await pool.query(
        `UPDATE ses_hospedajes_settings
          SET establishment_code = $1, internet_available = $2, updated_at = now()
        WHERE id = 1`,
        [establishment_code.trim(), internet_available],
      );
      res.json({ok: true});
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/admin/ses-hospedajes", requireAdmin, async (req, res, next) => {
  const normalize = (value) =>
    typeof value === "string" &&
    !["", "undefined", "null"].includes(value.trim().toLowerCase())
      ? value.trim()
      : undefined;
  const fromDate = normalize(req.query.from_date);
  const toDate = normalize(req.query.to_date);
  const precheck = normalize(req.query.precheck) ?? "all";
  const search = normalize(req.query.search) ?? "";
  if (
    (fromDate && !isDate(fromDate)) ||
    (toDate && !isDate(toDate)) ||
    (fromDate && toDate && fromDate > toDate) ||
    !["all", "completed", "pending"].includes(precheck) ||
    search.length > 120
  ) {
    return res.status(400).json({errors: ["Los filtros no son válidos."]});
  }
  const conditions = [];
  const values = [];
  const add = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (fromDate) conditions.push(`b.check_in >= ${add(fromDate)}`);
  if (toDate) conditions.push(`b.check_in <= ${add(toDate)}`);
  if (precheck === "completed") conditions.push("p.completed_at IS NOT NULL");
  if (precheck === "pending") conditions.push("p.completed_at IS NULL");
  if (search) {
    const query = add(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`(
      b.guest_name ILIKE ${query} ESCAPE '\\'
      OR b.identity_document ILIKE ${query} ESCAPE '\\'
      OR b.phone ILIKE ${query} ESCAPE '\\'
      OR b.arrival_pin ILIKE ${query} ESCAPE '\\'
      OR b.reservation_code ILIKE ${query} ESCAPE '\\'
      OR p.identity_document ILIKE ${query} ESCAPE '\\'
      OR p.phone_mobile ILIKE ${query} ESCAPE '\\'
    )`);
  }
  try {
    const {rows: bookings} = await pool.query(
      `SELECT b.id, b.room_id, b.guest_name, b.identity_document, b.email, b.phone,
              b.check_in, b.check_out, b.adults, b.children, b.arrival_pin,
              b.reservation_code, r.name AS room_name,
              p.completed_at AS precheckin_completed_at,
              p.first_name, p.first_surname, p.second_surname, p.sex,
              p.nationality, p.birth_date, p.home_address, p.home_city,
              p.home_country, p.document_type, p.identity_document AS precheckin_identity_document,
              p.document_support_number, p.phone_mobile, p.phone_landline,
              p.email AS precheckin_email,
              d.payment_type, d.payment_date, d.payment_medium, d.payment_holder,
              d.card_expiry, d.check_in_time, d.check_out_time,
              d.primary_document_type, d.primary_nationality_code, d.primary_country_code,
              d.primary_municipality_code, d.primary_municipality_name,
              d.primary_postal_code, d.primary_address_complement,
              d.additional_travelers
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
         LEFT JOIN pre_checkings p ON p.booking_id = b.id
         LEFT JOIN ses_hospedajes_records d ON d.booking_id = b.id
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY b.check_in DESC, b.created_at DESC`,
      values,
    );
    res.set("Cache-Control", "no-store").json(bookings);
  } catch (error) {
    next(error);
  }
});

app.put(
  "/api/admin/ses-hospedajes/:id",
  requireAdmin,
  async (req, res, next) => {
    const bookingId = Number(req.params.id);
    const data = req.body ?? {};
    if (!Number.isInteger(bookingId) || bookingId < 1) {
      return res.status(400).json({errors: ["La reserva no es válida."]});
    }
    const textFields = [
      "payment_type",
      "payment_medium",
      "payment_holder",
      "card_expiry",
      "check_in_time",
      "check_out_time",
      "primary_document_type",
      "primary_nationality_code",
      "primary_country_code",
      "primary_municipality_code",
      "primary_municipality_name",
      "primary_postal_code",
      "primary_address_complement",
    ];
    if (
      textFields.some(
        (key) => data[key] !== undefined && typeof data[key] !== "string",
      )
    ) {
      return res
        .status(400)
        .json({errors: ["Los datos SES enviados no son válidos."]});
    }
    const paymentType = String(data.payment_type ?? "").trim();
    const paymentDate = data.payment_date || null;
    const checkInTime = String(data.check_in_time ?? "15:00").slice(0, 5);
    const checkOutTime = String(data.check_out_time ?? "11:00").slice(0, 5);
    const travelers = data.additional_travelers ?? [];
    if (
      (paymentType && !sesPaymentTypes.has(paymentType)) ||
      (paymentDate && !isDate(paymentDate)) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(checkInTime) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(checkOutTime) ||
      !Array.isArray(travelers) ||
      travelers.length > 9
    ) {
      return res.status(400).json({
        errors: ["Revisa las fechas, horas, pago y viajeros adicionales."],
      });
    }
    const travelerFields = [
      "first_name",
      "first_surname",
      "second_surname",
      "document_type",
      "document_number",
      "document_support",
      "birth_date",
      "nationality_code",
      "sex",
      "address",
      "address_complement",
      "municipality_code",
      "municipality_name",
      "postal_code",
      "country_code",
      "phone",
      "phone2",
      "email",
      "relationship",
    ];
    const additionalTravelers = travelers.map((traveler) =>
      Object.fromEntries(
        travelerFields.map((field) => [
          field,
          typeof traveler?.[field] === "string"
            ? traveler[field].trim().slice(0, 300)
            : "",
        ]),
      ),
    );
    const travelerCodeFields = new Set([
      "document_type",
      "nationality_code",
      "sex",
      "country_code",
      "relationship",
    ]);
    for (const traveler of additionalTravelers) {
      for (const field of travelerCodeFields) {
        traveler[field] = traveler[field].toUpperCase();
      }
    }
    if (
      additionalTravelers.some(
        (traveler) =>
          !sesRelationshipValues.has(traveler.relationship) &&
          traveler.relationship !== "",
      )
    ) {
      return res.status(400).json({
        errors: ["El parentesco de alguno de los viajeros no es válido."],
      });
    }
    const fields = [
      "payment_medium",
      "payment_holder",
      "card_expiry",
      "primary_document_type",
      "primary_nationality_code",
      "primary_country_code",
      "primary_municipality_code",
      "primary_municipality_name",
      "primary_postal_code",
      "primary_address_complement",
    ];
    const codeFields = new Set([
      "primary_document_type",
      "primary_nationality_code",
      "primary_country_code",
    ]);
    const values = fields.map((key) => {
      const value = String(data[key] ?? "")
        .trim()
        .slice(0, 300);
      return codeFields.has(key) ? value.toUpperCase() : value;
    });
    try {
      const {rowCount} = await pool.query(
        `INSERT INTO ses_hospedajes_records (
         booking_id, payment_type, payment_date, payment_medium, payment_holder,
         card_expiry, check_in_time, check_out_time, primary_document_type,
         primary_nationality_code, primary_country_code, primary_municipality_code,
         primary_municipality_name, primary_postal_code, primary_address_complement,
         additional_travelers, updated_at
       )
       SELECT b.id, $2, $3, $4, $5, $6, $7::time, $8::time, $9, $10, $11, $12,
              $13, $14, $15, $16::jsonb, now()
         FROM bookings b WHERE b.id = $1
       ON CONFLICT (booking_id) DO UPDATE SET
         payment_type = EXCLUDED.payment_type, payment_date = EXCLUDED.payment_date,
         payment_medium = EXCLUDED.payment_medium, payment_holder = EXCLUDED.payment_holder,
         card_expiry = EXCLUDED.card_expiry, check_in_time = EXCLUDED.check_in_time,
         check_out_time = EXCLUDED.check_out_time,
         primary_document_type = EXCLUDED.primary_document_type,
         primary_nationality_code = EXCLUDED.primary_nationality_code,
         primary_country_code = EXCLUDED.primary_country_code,
         primary_municipality_code = EXCLUDED.primary_municipality_code,
         primary_municipality_name = EXCLUDED.primary_municipality_name,
         primary_postal_code = EXCLUDED.primary_postal_code,
         primary_address_complement = EXCLUDED.primary_address_complement,
         additional_travelers = EXCLUDED.additional_travelers,
         updated_at = now()`,
        [
          bookingId,
          paymentType,
          paymentDate,
          ...values.slice(0, 2),
          values[2],
          checkInTime,
          checkOutTime,
          ...values.slice(3),
          JSON.stringify(additionalTravelers),
        ],
      );
      if (!rowCount) {
        return res
          .status(404)
          .json({errors: ["No se ha encontrado la reserva."]});
      }
      res.json({ok: true});
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/ses-hospedajes/:id/reset-pre-checkin",
  requireAdmin,
  async (req, res, next) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId < 1) {
      return res.status(400).json({errors: ["La reserva no es válida."]});
    }
    const client = await pool.connect();
    let documentPaths = [];
    let committed = false;
    try {
      await client.query("BEGIN");
      const {rows} = await client.query(
        `SELECT b.id, b.room_id, b.guest_name, b.email, b.check_in, b.reservation_code,
              p.document_front_path, p.document_back_path
         FROM bookings b
         LEFT JOIN pre_checkings p ON p.booking_id = b.id
        WHERE b.id = $1 FOR UPDATE OF b`,
        [bookingId],
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({errors: ["No se ha encontrado la reserva."]});
      }
      const booking = rows[0];
      documentPaths = [
        booking.document_front_path,
        booking.document_back_path,
      ].filter(Boolean);
      const token = randomBytes(32).toString("base64url");
      const checkIn = toDateOnly(booking.check_in);
      const expiresAt = new Date(
        Date.parse(`${checkIn}T00:00:00.000Z`) + 86_400_000,
      ).toISOString();
      await client.query("DELETE FROM pre_checkings WHERE booking_id = $1", [
        bookingId,
      ]);
      await client.query(
        `INSERT INTO pre_checkings (booking_id, room_id, token_hash, token_expires_at)
       VALUES ($1, $2, $3, $4)`,
        [bookingId, booking.room_id, hashToken(token), expiresAt],
      );
      const site = await readSiteSettings();
      const link = new URL("/pre-check-in", frontendUrl);
      link.hash = token;
      const safeName = escapeHtml(booking.guest_name);
      const safeSite = escapeHtml(site.site_name);
      await mailer.sendMail({
        from: EMAIL_FROM,
        to: booking.email,
        subject: `Actualiza tus datos de pre-check-in · ${booking.reservation_code} | ${site.site_name}`,
        text: [
          `Hola ${booking.guest_name},`,
          "",
          "Necesitamos que completes de nuevo los datos del pre-check-in de tu reserva.",
          `Reserva: ${booking.reservation_code}`,
          `Completar pre-check-in: ${link.href}`,
          "El enlace es personal y de un solo uso.",
          "",
          `Gracias, ${site.site_name}`,
        ].join("\n"),
        html: `<div style="max-width:620px;margin:0 auto;padding:32px;background:#f7f5ef;color:#292b27;font-family:Arial,Helvetica,sans-serif;line-height:1.6">
        <div style="padding:24px;background:#244536;color:#fff"><p style="margin:0 0 8px;color:#d9c8a4;font-size:12px;letter-spacing:1px;text-transform:uppercase">${safeSite}</p><h1 style="margin:0;font-size:24px">Actualiza tu pre-check-in</h1></div>
        <div style="padding:24px;background:#fff"><p>Hola ${safeName},</p><p>Necesitamos que completes de nuevo los datos del pre-check-in de la reserva <strong>${escapeHtml(booking.reservation_code)}</strong>.</p><p style="text-align:center;margin:28px 0"><a href="${escapeHtml(link.href)}" style="display:inline-block;padding:14px 22px;background:#244536;color:#fff;text-decoration:none;font-weight:bold">Completar pre-check-in</a></p><p>El enlace es personal y de un solo uso.</p><p>Gracias,<br><strong>${safeSite}</strong></p></div>
      </div>`,
      });
      await client.query("COMMIT");
      committed = true;
      await removePrecheckinDocuments(documentPaths);
      res.json({ok: true});
    } catch (error) {
      if (!committed) await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  },
);

app.delete(
  "/api/admin/ses-hospedajes/:id",
  requireAdmin,
  async (req, res, next) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId < 1) {
      return res.status(400).json({errors: ["La reserva no es válida."]});
    }
    let documentPaths = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const {rows} = await client.query(
        `SELECT p.document_front_path, p.document_back_path
         FROM bookings b LEFT JOIN pre_checkings p ON p.booking_id = b.id
        WHERE b.id = $1 FOR UPDATE OF b`,
        [bookingId],
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({errors: ["No se ha encontrado la reserva."]});
      }
      documentPaths = rows.flatMap((row) =>
        [row.document_front_path, row.document_back_path].filter(Boolean),
      );
      await client.query("DELETE FROM pre_checkings WHERE booking_id = $1", [
        bookingId,
      ]);
      await client.query(
        "DELETE FROM ses_hospedajes_records WHERE booking_id = $1",
        [bookingId],
      );
      await client.query("COMMIT");
      await removePrecheckinDocuments(documentPaths);
      res.json({ok: true});
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  },
);

app.get(
  "/api/admin/ses-hospedajes/:id/xml",
  requireAdmin,
  async (req, res, next) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId < 1) {
      return res.status(400).json({errors: ["La reserva no es válida."]});
    }
    try {
      const {rows} = await pool.query(
        `SELECT b.id, b.guest_name, b.email, b.check_in, b.check_out, b.adults,
              b.children, b.reservation_code, b.created_at, r.name AS room_name,
              p.completed_at, p.identity_document, p.phone_mobile, p.phone_landline,
              p.email AS precheckin_email, p.first_name, p.first_surname,
              p.second_surname, p.sex, p.nationality, p.birth_date,
              p.home_address, p.home_city, p.home_country, p.document_support_number,
              d.payment_type, d.payment_date, d.payment_medium, d.payment_holder,
              d.card_expiry, d.check_in_time, d.check_out_time,
              d.primary_document_type, d.primary_nationality_code,
              d.primary_country_code, d.primary_municipality_code,
              d.primary_municipality_name, d.primary_postal_code,
              d.primary_address_complement, d.additional_travelers,
              s.establishment_code, s.internet_available
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
         LEFT JOIN pre_checkings p ON p.booking_id = b.id
         LEFT JOIN ses_hospedajes_records d ON d.booking_id = b.id
         CROSS JOIN ses_hospedajes_settings s
        WHERE b.id = $1 AND s.id = 1`,
        [bookingId],
      );
      if (!rows.length) {
        return res
          .status(404)
          .json({errors: ["No se ha encontrado la reserva."]});
      }
      const booking = rows[0];
      const errors = [];
      if (!booking.completed_at)
        errors.push("El huésped todavía no ha completado el pre-check-in.");
      if (!booking.establishment_code?.trim())
        errors.push("Configura el código del establecimiento SES.Hospedajes.");
      if (typeof booking.internet_available !== "boolean") {
        errors.push(
          "Confirma si el establecimiento dispone de internet en la configuración SES.Hospedajes.",
        );
      }
      if (!booking.payment_type || !sesPaymentTypes.has(booking.payment_type)) {
        errors.push("Indica un tipo de pago válido para el contrato.");
      }
      if (!booking.payment_date) errors.push("Indica la fecha del pago.");
      if (!booking.payment_medium?.trim())
        errors.push("Indica el medio de pago.");
      if (!booking.payment_holder?.trim())
        errors.push("Indica el titular del pago.");
      if (
        booking.payment_type === "TARJT" &&
        !/^(0[1-9]|1[0-2])\/20\d{2}$/.test(booking.card_expiry ?? "")
      ) {
        errors.push(
          "Para pago con tarjeta indica su caducidad en formato MM/AAAA.",
        );
      }
      const primaryDocumentType = booking.primary_document_type;
      if (!sesDocumentTypes.has(primaryDocumentType)) {
        errors.push("Selecciona el tipo de documento del titular.");
      }
      const primaryNationality = booking.primary_nationality_code;
      const primaryCountry = booking.primary_country_code;
      const primarySex =
        {male: "H", female: "M", other: "O"}[booking.sex] ?? booking.sex;
      const primary = {
        first_name: booking.first_name,
        first_surname: booking.first_surname,
        second_surname: booking.second_surname ?? "",
        document_type: primaryDocumentType,
        document_number: booking.identity_document,
        document_support: booking.document_support_number ?? "",
        birth_date: booking.birth_date ? toDateOnly(booking.birth_date) : "",
        nationality_code: primaryNationality,
        sex: primarySex,
        address: booking.home_address,
        address_complement: booking.primary_address_complement,
        municipality_code: booking.primary_municipality_code,
        municipality_name:
          booking.primary_municipality_name || booking.home_city,
        postal_code: booking.primary_postal_code,
        country_code: primaryCountry,
        phone: booking.phone_mobile,
        phone2: booking.phone_landline ?? "",
        email: booking.precheckin_email,
      };
      validateSesPerson(primary, "Titular", errors);
      const additionalTravelers = Array.isArray(booking.additional_travelers)
        ? booking.additional_travelers
        : [];
      const expectedTravelers =
        Number(booking.adults) + Number(booking.children);
      if (additionalTravelers.length !== expectedTravelers - 1) {
        errors.push(
          `Añade los datos de los ${Math.max(0, expectedTravelers - 1)} viajero(s) restantes.`,
        );
      }
      additionalTravelers.forEach((traveler, index) =>
        validateSesPerson(traveler, `Viajero ${index + 2}`, errors),
      );
      if (errors.length) {
        return res.status(422).json({errors});
      }
      const xml = buildSesHospedajesXml({
        establishmentCode: booking.establishment_code,
        internetAvailable: booking.internet_available,
        reference: booking.reservation_code,
        contractDate: booking.created_at,
        checkIn: toDateOnly(booking.check_in),
        checkOut: toDateOnly(booking.check_out),
        checkInTime: String(booking.check_in_time ?? HOTEL_CHECK_IN_TIME).slice(
          0,
          5,
        ),
        checkOutTime: String(
          booking.check_out_time ?? HOTEL_CHECK_OUT_TIME,
        ).slice(0, 5),
        travelerCount: expectedTravelers,
        payment: {
          type: booking.payment_type,
          date: toDateOnly(booking.payment_date),
          medium: booking.payment_medium,
          holder: booking.payment_holder,
          cardExpiry: booking.card_expiry,
        },
        travelers: [primary, ...additionalTravelers],
      });
      const filenameCode = String(booking.reservation_code).replace(
        /[^A-Za-z0-9._-]/g,
        "_",
      );
      res
        .set({
          "Cache-Control": "no-store",
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="ses-hospedajes-${filenameCode}.xml"`,
        })
        .send(xml);
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/admin/bookings/:id", requireAdmin, async (req, res, next) => {
  const bookingId = Number(req.params.id);
  if (!Number.isInteger(bookingId) || bookingId < 1)
    return res.status(400).json({errors: ["La reserva no es válida."]});
  try {
    const {rows} = await pool.query(
      `SELECT ${adminBookingFields}
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
         LEFT JOIN pre_checkings p ON p.booking_id = b.id
        WHERE b.id = $1`,
      [bookingId],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({errors: ["No se ha encontrado la reserva."]});
    res.set("Cache-Control", "no-store").json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/admin/bookings/:id/documents/:side",
  requireAdmin,
  async (req, res, next) => {
    const bookingId = Number(req.params.id);
    const field =
      req.params.side === "front"
        ? "document_front_path"
        : req.params.side === "back"
          ? "document_back_path"
          : null;
    if (!Number.isInteger(bookingId) || bookingId < 1 || !field) {
      return res
        .status(400)
        .json({errors: ["El documento solicitado no es válido."]});
    }
    try {
      const {rows} = await pool.query(
        `SELECT ${field} AS document_path FROM pre_checkings WHERE booking_id = $1`,
        [bookingId],
      );
      const storedPath = rows[0]?.document_path;
      if (!safePrecheckinObjectPath(storedPath) && !safePrecheckinFilePath(storedPath))
        return res
          .status(404)
          .json({errors: ["No se ha encontrado el documento."]});
      const file = await readPrecheckinDocument(storedPath);
      const contentType = file.toString("ascii", 0, 4) === "RIFF" ? "image/webp"
        : file.toString("ascii", 1, 4) === "PNG" ? "image/png" : "image/jpeg";
      res.set("Cache-Control", "no-store").type(contentType).send(file);
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/admin/bookings/:id/pdf", requireAdmin, async (req, res, next) => {
  const bookingId = Number(req.params.id);
  if (!Number.isInteger(bookingId) || bookingId < 1)
    return res.status(400).json({errors: ["La reserva no es válida."]});
  try {
    const {rows} = await pool.query(
      `SELECT ${adminBookingFields}
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
         LEFT JOIN pre_checkings p ON p.booking_id = b.id
        WHERE b.id = $1`,
      [bookingId],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({errors: ["No se ha encontrado la reserva."]});
    const pdf = await createBookingPdf(rows[0]);
    res
      .set({
        "Cache-Control": "no-store",
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="reserva-${rows[0].reservation_code}.pdf"`,
      })
      .send(pdf);
  } catch (error) {
    next(error);
  }
});

async function sendAdminBookingEmail(req, res, next) {
  const bookingId = Number(req.params.id);
  if (!Number.isInteger(bookingId) || bookingId < 1)
    return res.status(400).json({errors: ["La reserva no es válida."]});
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const {rows} = await client.query(
      `SELECT ${adminBookingFields}
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
         LEFT JOIN pre_checkings p ON p.booking_id = b.id
        WHERE b.id = $1 FOR UPDATE OF b`,
      [bookingId],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({errors: ["No se ha encontrado la reserva."]});
    }
    const booking = rows[0];
    const accessToken = randomBytes(32).toString("base64url");
    const token = booking.precheckin_completed_at
      ? null
      : randomBytes(32).toString("base64url");
    await client.query(
      "UPDATE bookings SET access_token_hash = $2 WHERE id = $1",
      [bookingId, hashToken(accessToken)],
    );
    if (token) {
      const checkIn = toDateOnly(booking.check_in);
      const expiresAt = new Date(
        Date.parse(`${checkIn}T00:00:00.000Z`) + 86_400_000,
      ).toISOString();
      await client.query(
        `INSERT INTO pre_checkings (booking_id, room_id, token_hash, token_expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (booking_id) DO UPDATE
           SET room_id = EXCLUDED.room_id, token_hash = EXCLUDED.token_hash,
               token_expires_at = EXCLUDED.token_expires_at`,
        [bookingId, booking.room_id, hashToken(token), expiresAt],
      );
    }
    await sendBookingEmailForAdmin(booking, {token, accessToken});
    await client.query("COMMIT");
    res.json({ok: true});
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

app.post("/api/admin/bookings/:id/resend", requireAdmin, sendAdminBookingEmail);
app.post(
  "/api/admin/bookings/:id/pre-check-in",
  requireAdmin,
  sendAdminBookingEmail,
);

app.delete("/api/admin/bookings/:id", requireAdmin, async (req, res, next) => {
  const bookingId = Number(req.params.id);
  if (!Number.isInteger(bookingId) || bookingId < 1)
    return res.status(400).json({errors: ["La reserva no es válida."]});
  const client = await pool.connect();
  let documentPaths = [];
  try {
    await client.query("BEGIN");
    const {rows} = await client.query(
      `SELECT p.document_front_path, p.document_back_path
         FROM bookings b LEFT JOIN pre_checkings p ON p.booking_id = b.id
        WHERE b.id = $1 FOR UPDATE OF b`,
      [bookingId],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({errors: ["No se ha encontrado la reserva."]});
    }
    documentPaths = rows.flatMap((row) =>
      [row.document_front_path, row.document_back_path].filter(Boolean),
    );
    await client.query("DELETE FROM bookings WHERE id = $1", [bookingId]);
    await client.query("COMMIT");
    await removePrecheckinDocuments(documentPaths);
    res.json({ok: true});
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.put("/api/admin/bookings/:id", requireAdmin, async (req, res, next) => {
  const bookingId = Number(req.params.id);
  const body = req.body ?? {};
  const {
    room_id,
    guest_name,
    identity_document,
    phone,
    email,
    check_in,
    check_out,
    adults,
    children,
    breakfast,
    pets,
    notes,
    remove_precheckin = false,
  } = body;
  const errors = [];
  if (!Number.isInteger(bookingId) || bookingId < 1)
    errors.push("La reserva no es válida.");
  if (!Number.isInteger(room_id) || room_id < 1)
    errors.push("Elige una habitación.");
  if (
    typeof guest_name !== "string" ||
    guest_name.trim().length < 2 ||
    guest_name.trim().length > 120
  )
    errors.push("Escribe un nombre válido.");
  if (typeof identity_document !== "string" || identity_document.length > 50)
    errors.push("El DNI no es válido.");
  if (typeof phone !== "string" || phone.trim().length < 6 || phone.length > 40)
    errors.push("Escribe un teléfono válido.");
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    errors.push("Escribe un correo válido.");
  if (!isDate(check_in) || !isDate(check_out) || check_out <= check_in)
    errors.push("Indica fechas válidas y una salida posterior a la entrada.");
  if (!Number.isInteger(adults) || adults < 1 || adults > 13)
    errors.push("Indica entre 1 y 13 adultos.");
  if (!Number.isInteger(children) || children < 0 || children > 12)
    errors.push("Indica entre 0 y 12 niños.");
  if (adults + children > 13)
    errors.push("La reserva admite hasta 13 huéspedes.");
  if (typeof breakfast !== "boolean" || typeof pets !== "boolean")
    errors.push("Las opciones de desayuno o mascotas no son válidas.");
  if (typeof notes !== "string" || notes.length > 2000)
    errors.push("Las observaciones no pueden superar los 2000 caracteres.");
  if (typeof remove_precheckin !== "boolean")
    errors.push(
      "La confirmación de eliminación del pre-check-in no es válida.",
    );
  if (errors.length) return res.status(400).json({errors});

  const client = await pool.connect();
  let documentsToRemove = [];
  try {
    await client.query("BEGIN");
    const {rows: currentRows} = await client.query(
      `SELECT b.id, b.room_id, b.discount_percent,
              p.completed_at, p.document_front_path, p.document_back_path
         FROM bookings b LEFT JOIN pre_checkings p ON p.booking_id = b.id
        WHERE b.id = $1 FOR UPDATE OF b`,
      [bookingId],
    );
    if (!currentRows.length) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({errors: ["No se ha encontrado la reserva."]});
    }
    const current = currentRows[0];
    if (current.completed_at && !remove_precheckin) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        errors: [
          "La reserva tiene el pre-check-in completado. Confirma su eliminación para poder editarla.",
        ],
      });
    }
    const closure = await findActiveClosure(check_in, check_out, client);
    if (closure) {
      await client.query("ROLLBACK");
      return res.status(409).json({errors: [closureMessage(closure)]});
    }
    const {rows: roomRows} = await client.query(
      `SELECT id, name, price_per_night::float8 AS price, pricing_type,
              single_price::float8 AS single_price, double_price::float8 AS double_price,
              extra_bed_price::float8 AS extra_bed_price,
              capacity, features, is_active
         FROM rooms WHERE id = $1 FOR UPDATE`,
      [room_id],
    );
    const room = roomRows[0];
    if (!room) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({errors: ["No se ha encontrado la habitación."]});
    }
    if (!room.is_active && room_id !== current.room_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        errors: [
          "La habitación seleccionada no está disponible para nuevas reservas.",
        ],
      });
    }
    if (adults + children > room.capacity) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        errors: [`La habitación admite hasta ${room.capacity} personas.`],
      });
    }
    const {rowCount: clash} = await client.query(
      `SELECT 1 FROM bookings WHERE room_id = $1 AND id <> $2 AND check_in < $4 AND check_out > $3
       UNION ALL
       SELECT 1 FROM room_availability_blocks WHERE room_id = $1 AND start_date < $4 AND end_date > $3
       LIMIT 1`,
      [room_id, bookingId, check_in, check_out],
    );
    if (clash) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({errors: ["La habitación no está disponible en esas fechas."]});
    }
    const siteSettings = await readSiteSettings();
    const pricing = calculateBookingPrice({
      pricingType: room.pricing_type,
      singlePrice: room.single_price,
      doublePrice: room.double_price,
      extraBedPrice: room.extra_bed_price,
      ruralHousePrice: room.price,
      pricePerNight: room.price,
      checkIn: check_in,
      checkOut: check_out,
      adults,
      children,
      breakfast,
      pets,
      breakfastPrice: Number(siteSettings.breakfast_price),
      petsPrice: Number(siteSettings.pets_price),
    });
    const discountPercent = Number(current.discount_percent ?? 0);
    const discountAmount = discountPercent
      ? calculateDiscount(pricing.total, discountPercent)
      : 0;
    const total = pricing.total - discountAmount;
    const vatBreakdown = await calculateStoredVat(
      client,
      check_in,
      check_out,
      pricing,
      discountAmount,
    );
    const accessToken = randomBytes(32).toString("base64url");
    const precheckinToken = randomBytes(32).toString("base64url");
    const tokenExpiresAt = new Date(
      Date.parse(`${check_in}T00:00:00.000Z`) + 86_400_000,
    ).toISOString();
    if (current.completed_at) {
      documentsToRemove = [
        current.document_front_path,
        current.document_back_path,
      ].filter(Boolean);
      await client.query("DELETE FROM pre_checkings WHERE booking_id = $1", [
        bookingId,
      ]);
    }
    await client.query(
      `UPDATE bookings
          SET room_id = $2, guest_name = $3, identity_document = $4, phone = $5, email = $6,
              check_in = $7, check_out = $8, adults = $9, children = $10, breakfast = $11,
              pets = $12, notes = $13, total = $14, room_subtotal = $15,
              breakfast_total = $16, pets_total = $17, discount_amount = $18,
              vat_breakdown = $19, access_token_hash = $20
        WHERE id = $1`,
      [
        bookingId,
        room_id,
        guest_name.trim(),
        identity_document.trim(),
        phone.trim(),
        email.trim().toLowerCase(),
        check_in,
        check_out,
        adults,
        children,
        breakfast,
        pets,
        notes.trim(),
        total,
        pricing.roomSubtotal,
        pricing.breakfastTotal,
        pricing.petsTotal,
        discountAmount,
        JSON.stringify(vatBreakdown),
        hashToken(accessToken),
      ],
    );
    await client.query(
      `INSERT INTO pre_checkings (booking_id, room_id, token_hash, token_expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (booking_id) DO UPDATE
         SET room_id = EXCLUDED.room_id, token_hash = EXCLUDED.token_hash,
             token_expires_at = EXCLUDED.token_expires_at`,
      [bookingId, room_id, hashToken(precheckinToken), tokenExpiresAt],
    );
    const {rows: updatedRows} = await client.query(
      `SELECT ${adminBookingFields}
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
         LEFT JOIN pre_checkings p ON p.booking_id = b.id
        WHERE b.id = $1`,
      [bookingId],
    );
    await sendBookingEmailForAdmin(
      {
        ...updatedRows[0],
        check_in,
        check_out,
        adults,
        children,
        breakfast,
        pets,
        room_subtotal: pricing.roomSubtotal,
        breakfast_total: pricing.breakfastTotal,
        pets_total: pricing.petsTotal,
        discount_amount: discountAmount,
        vat_breakdown: vatBreakdown,
        total,
      },
      {token: precheckinToken, accessToken},
    );
    await client.query("COMMIT");
    await removePrecheckinDocuments(documentsToRemove);
    res.json({ok: true});
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/admin/rooms", requireAdmin, async (_req, res, next) => {
  try {
    const [{rows: rooms}, {rows: blocks}] = await Promise.all([
      pool.query(
        `SELECT id, name, slug, description, price_per_night::float8 AS price_per_night,
                pricing_type, catalog_category, single_price::float8 AS single_price,
                double_price::float8 AS double_price,
                extra_bed_price::float8 AS extra_bed_price,
                capacity, features, image_url, is_active,
                COALESCE((SELECT json_agg(json_build_object('id', ri.id, 'image_url', ri.image_url, 'position', ri.position)
                  ORDER BY ri.position, ri.id) FROM room_images ri WHERE ri.room_id = rooms.id), '[]'::json) AS images
           FROM rooms ORDER BY name`,
      ),
      pool.query(
        `SELECT id, room_id, start_date, end_date, reason
           FROM room_availability_blocks
          WHERE end_date >= CURRENT_DATE
          ORDER BY start_date`,
      ),
    ]);
    res.json(
      rooms.map((room) => ({
        ...room,
        availability_blocks: blocks.filter(
          (block) => block.room_id === room.id,
        ),
      })),
    );
  } catch (error) {
    next(error);
  }
});

function validateRoomInput(body) {
  const errors = [];
  if (
    typeof body.name !== "string" ||
    body.name.trim().length < 2 ||
    body.name.trim().length > 100
  ) {
    errors.push("El nombre debe tener entre 2 y 100 caracteres.");
  }
  if (
    typeof body.description !== "string" ||
    body.description.trim().length < 10 ||
    body.description.trim().length > 2000
  ) {
    errors.push("La descripción debe tener entre 10 y 2000 caracteres.");
  }
  if (
    typeof body.price_per_night !== "number" ||
    !Number.isFinite(body.price_per_night) ||
    body.price_per_night <= 0 ||
    body.price_per_night > 100000
  ) {
    errors.push("El precio por noche debe ser mayor que cero.");
  }
  if (!["standard", "rural_house"].includes(body.pricing_type)) {
    errors.push("El tipo de alojamiento no es válido.");
  }
  if (
    typeof body.catalog_category !== "string" ||
    body.catalog_category.trim().length < 2 ||
    body.catalog_category.trim().length > 70
  ) {
    errors.push("Indica una categoría válida de entre 2 y 70 caracteres.");
  }
  for (const [field, label] of [
    ["single_price", "uso individual"],
    ["double_price", "uso doble"],
    ["extra_bed_price", "cama supletoria"],
  ]) {
    if (
      typeof body[field] !== "number" ||
      !Number.isFinite(body[field]) ||
      body[field] < 0 ||
      body[field] > 100000
    ) {
      errors.push(`El precio de ${label} no es válido.`);
    }
  }
  if (
    (body.pricing_type === "standard" && body.double_price <= 0) ||
    (body.pricing_type === "rural_house" && body.price_per_night <= 0)
  ) {
    errors.push("El precio base por noche debe ser mayor que cero.");
  }
  if (body.pricing_type === "rural_house" && body.capacity !== 13) {
    errors.push("La casa rural debe tener una capacidad de 13 personas.");
  }
  if (
    !Number.isInteger(body.capacity) ||
    body.capacity < 1 ||
    body.capacity > 20
  ) {
    errors.push("La capacidad debe ser un número entre 1 y 20.");
  }
  if (
    !Array.isArray(body.features) ||
    body.features.length > 30 ||
    body.features.some(
      (feature) =>
        typeof feature !== "string" ||
        feature.trim().length < 1 ||
        feature.trim().length > 120,
    )
  ) {
    errors.push(
      "Añade hasta 30 características, cada una de entre 1 y 120 caracteres.",
    );
  }
  if (body.is_active !== undefined && typeof body.is_active !== "boolean") {
    errors.push("El estado de la habitación no es válido.");
  }
  return errors;
}

async function saveRoomImage(slug, imageDataUrl) {
  const image = decodeRoomImage(imageDataUrl);
  if (!image) return null;
  const objectPath = `rooms/${slug}/${randomUUID()}.webp`;
  const optimized = await sharp(image.buffer).rotate().resize({width: 2400, height: 1600, fit: "inside", withoutEnlargement: true}).webp({quality: 82}).toBuffer();
  await uploadStorageObject(storageBuckets.public, objectPath, optimized, "image/webp");
  return {
    imageUrl: publicStorageUrl(objectPath),
    objectPath,
  };
}

async function saveWebImage(filename, imageDataUrl) {
  const image = decodeRoomImage(imageDataUrl);
  if (!image) throw new Error("La imagen enviada no es válida.");
  const optimizedImage = await sharp(image.buffer)
    .rotate()
    .resize({
      width: 2400,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({quality: 82})
    .toBuffer();
  const objectPath = `site/${randomUUID()}-${filename}`;
  await uploadStorageObject(storageBuckets.public, objectPath, optimizedImage, "image/webp");
  return {
    imageUrl: publicStorageUrl(objectPath),
    objectPath,
  };
}

async function removeOldRoomImageFiles(directory, keepPath) {
  for (const extension of ["jpg", "png", "webp"]) {
    const path = join(directory, `habitacion.${extension}`);
    if (path !== keepPath) await rm(path, {force: true});
  }
}

function validateDiscountInput(body) {
  const errors = [];
  if (
    typeof body.code !== "string" ||
    !/^[A-Za-z0-9_-]{2,40}$/.test(body.code.trim())
  ) {
    errors.push(
      "El código debe tener entre 2 y 40 caracteres alfanuméricos, guion o guion bajo.",
    );
  }
  if (
    typeof body.discount_percent !== "number" ||
    !Number.isFinite(body.discount_percent) ||
    body.discount_percent <= 0 ||
    body.discount_percent > 100
  ) {
    errors.push("El descuento debe estar entre 0,01 % y 100 %.");
  }
  if (
    typeof body.minimum_amount !== "number" ||
    !Number.isFinite(body.minimum_amount) ||
    body.minimum_amount < 0 ||
    body.minimum_amount > 1000000
  ) {
    errors.push("El importe mínimo no es válido.");
  }
  for (const [field, label] of [
    ["starts_on", "inicio"],
    ["ends_on", "fin"],
  ]) {
    if (body[field] !== null && body[field] !== "" && !isDate(body[field])) {
      errors.push(`La fecha de ${label} no es válida.`);
    }
  }
  if (body.starts_on && body.ends_on && body.ends_on < body.starts_on) {
    errors.push(
      "La fecha final debe ser igual o posterior a la fecha inicial.",
    );
  }
  if (
    body.max_uses !== null &&
    body.max_uses !== "" &&
    (!Number.isInteger(body.max_uses) ||
      body.max_uses < 1 ||
      body.max_uses > 1000000)
  ) {
    errors.push(
      "El límite de usos debe ser un entero positivo o quedar vacío.",
    );
  }
  if (typeof body.is_active !== "boolean") {
    errors.push("El estado del código no es válido.");
  }
  if (
    !Array.isArray(body.excluded_dates) ||
    body.excluded_dates.length > 30 ||
    body.excluded_dates.some(
      (range) =>
        !range ||
        !isDate(range.start_date) ||
        !isDate(range.end_date) ||
        range.end_date < range.start_date,
    )
  ) {
    errors.push("Añade hasta 30 periodos excluidos con fechas válidas.");
  }
  return errors;
}

async function findDiscountCode(queryable, code, lock = false) {
  const {rows} = await queryable.query(
    `SELECT id, code, discount_percent::float8 AS discount_percent,
            minimum_amount::float8 AS minimum_amount, starts_on, ends_on,
            max_uses, is_active
       FROM discount_codes
      WHERE upper(code) = $1${lock ? " FOR UPDATE" : ""}`,
    [code.trim().toUpperCase()],
  );
  const discount = rows[0];
  if (!discount || !discount.is_active)
    return {error: "El código no existe o está desactivado."};
  const {rows: usageRows} = await queryable.query(
    "SELECT COUNT(*)::int AS usage_count FROM booking_discount_redemptions WHERE discount_code_id = $1",
    [discount.id],
  );
  discount.usage_count = usageRows[0].usage_count;
  if (discount.max_uses !== null && discount.usage_count >= discount.max_uses) {
    return {error: "El código ha alcanzado su límite de usos."};
  }
  return {discount};
}

function nextDateOnly(date) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

async function validateDiscountForStay(
  queryable,
  {code, amount, checkIn, checkOut},
  lock = false,
) {
  const result = await findDiscountCode(queryable, code, lock);
  if (result.error) return result;
  const discount = result.discount;
  if (discount.starts_on && checkIn < toDateOnly(discount.starts_on)) {
    return {error: "El código todavía no está vigente para esas fechas."};
  }
  if (
    discount.ends_on &&
    checkOut > nextDateOnly(toDateOnly(discount.ends_on))
  ) {
    return {
      error: "La estancia queda fuera de las fechas de vigencia del código.",
    };
  }
  if (amount < discount.minimum_amount) {
    return {
      error: `El código requiere un importe mínimo de ${discount.minimum_amount.toFixed(2)} €.`,
    };
  }
  const {rows: excluded} = await queryable.query(
    `SELECT 1 FROM discount_code_excluded_dates
      WHERE discount_code_id = $1 AND start_date < $3 AND end_date >= $2
      LIMIT 1`,
    [discount.id, checkIn, checkOut],
  );
  if (excluded.length)
    return {error: "El código no puede aplicarse en las fechas seleccionadas."};
  return {discount};
}

app.get("/api/admin/discount-codes", requireAdmin, async (_req, res, next) => {
  try {
    const {rows} = await pool.query(
      `SELECT c.id, c.code, c.discount_percent::float8 AS discount_percent,
              c.minimum_amount::float8 AS minimum_amount,
              c.starts_on::text AS starts_on, c.ends_on::text AS ends_on,
              c.max_uses, c.is_active, c.created_at,
              (SELECT COUNT(*)::int FROM booking_discount_redemptions r WHERE r.discount_code_id = c.id) AS usage_count,
              COALESCE((SELECT json_agg(json_build_object(
                'id', d.id, 'start_date', d.start_date, 'end_date', d.end_date
              ) ORDER BY d.start_date)
                FROM discount_code_excluded_dates d WHERE d.discount_code_id = c.id), '[]'::json) AS excluded_dates
         FROM discount_codes c
        ORDER BY c.created_at DESC`,
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/admin/discount-codes/:id/recipients",
  requireAdmin,
  async (req, res, next) => {
    const discountId = Number(req.params.id);
    if (!Number.isInteger(discountId) || discountId < 1)
      return res.status(400).json({errors: ["El código no es válido."]});
    try {
      const {rows: codeRows} = await pool.query(
        "SELECT id FROM discount_codes WHERE id = $1",
        [discountId],
      );
      if (!codeRows.length)
        return res
          .status(404)
          .json({errors: ["No se ha encontrado el código."]});
      const {rows} = await pool.query(
        `SELECT DISTINCT ON (lower(b.email))
                b.guest_name, b.email, b.check_in
           FROM bookings b
           JOIN pre_checkings p ON p.booking_id = b.id
          WHERE p.marketing_consent = TRUE
            AND p.marketing_consent_at IS NOT NULL
            AND b.email <> ''
          ORDER BY lower(b.email), b.check_in DESC, b.id DESC`,
      );
      res.set("Cache-Control", "no-store");
      res.json(rows);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/discount-codes/:id/send",
  requireAdmin,
  async (req, res, next) => {
    if (!isSameOrigin(req))
      return res.status(403).json({errors: ["Solicitud no permitida."]});
    const discountId = Number(req.params.id);
    const emails = req.body?.emails;
    if (
      !Number.isInteger(discountId) ||
      discountId < 1 ||
      !Array.isArray(emails) ||
      emails.length < 1 ||
      emails.length > 500 ||
      emails.some(
        (email) =>
          typeof email !== "string" ||
          email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      )
    ) {
      return res
        .status(400)
        .json({errors: ["La selección de huéspedes no es válida."]});
    }
    const selectedEmails = [
      ...new Set(emails.map((email) => email.trim().toLowerCase())),
    ];
    try {
      const {rows: codeRows} = await pool.query(
        `SELECT c.id, c.code, c.discount_percent::float8 AS discount_percent,
                c.minimum_amount::float8 AS minimum_amount,
                c.starts_on::text AS starts_on, c.ends_on::text AS ends_on,
                to_char(c.starts_on, 'DD/MM/YYYY') AS starts_on_display,
                to_char(c.ends_on, 'DD/MM/YYYY') AS ends_on_display,
                c.max_uses, c.is_active,
                (SELECT COUNT(*)::int FROM booking_discount_redemptions r
                  WHERE r.discount_code_id = c.id) AS usage_count,
                COALESCE((SELECT json_agg(json_build_object(
                  'start_date', to_char(d.start_date, 'DD/MM/YYYY'),
                  'end_date', to_char(d.end_date, 'DD/MM/YYYY')
                ) ORDER BY d.start_date)
                  FROM discount_code_excluded_dates d
                 WHERE d.discount_code_id = c.id), '[]'::json) AS excluded_dates
           FROM discount_codes c
          WHERE c.id = $1`,
        [discountId],
      );
      const promotion = codeRows[0];
      if (!promotion)
        return res
          .status(404)
          .json({errors: ["No se ha encontrado el código."]});
      if (!promotion.is_active)
        return res
          .status(409)
          .json({errors: ["Activa el código antes de enviarlo."]});
      if (promotion.ends_on && promotion.ends_on < today())
        return res.status(409).json({errors: ["El código ya ha caducado."]});
      if (promotion.max_uses && promotion.max_uses <= promotion.usage_count)
        return res
          .status(409)
          .json({errors: ["El código ya ha alcanzado su límite de usos."]});
      const {rows: eligibleRecipients} = await pool.query(
        `SELECT DISTINCT ON (lower(b.email))
                b.guest_name, b.email, b.check_in
           FROM bookings b
           JOIN pre_checkings p ON p.booking_id = b.id
          WHERE p.marketing_consent = TRUE
            AND p.marketing_consent_at IS NOT NULL
            AND b.email <> ''
            AND lower(b.email) = ANY($1::text[])
          ORDER BY lower(b.email), b.check_in DESC, b.id DESC`,
        [selectedEmails],
      );
      const eligibleByEmail = new Map(
        eligibleRecipients.map((recipient) => [
          recipient.email.toLowerCase(),
          recipient,
        ]),
      );
      const site = await readSiteSettings();
      const safe = {
        siteName: escapeHtml(site.site_name),
        code: escapeHtml(promotion.code),
        discount: escapeHtml(String(promotion.discount_percent)),
      };
      const validity = [
        promotion.starts_on
          ? `Válido desde el ${promotion.starts_on_display}`
          : "",
        promotion.ends_on
          ? `hasta el ${promotion.ends_on_display}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      const excludedDates = promotion.excluded_dates.map(
        ({start_date, end_date}) => `${start_date} – ${end_date}`,
      );
      const sent = [];
      const failed = [];
      for (const email of selectedEmails) {
        const recipient = eligibleByEmail.get(email);
        if (!recipient) {
          failed.push({
            email,
            reason: "No consta consentimiento de marketing.",
          });
          continue;
        }
        const safeName = escapeHtml(recipient.guest_name);
        const conditions = [
          `Descuento del ${promotion.discount_percent}%`,
          `en reservas desde ${Number(promotion.minimum_amount).toFixed(2)} €`,
          validity,
          promotion.max_uses
            ? `quedan ${promotion.max_uses - promotion.usage_count} usos disponibles`
            : "",
          excludedDates.length
            ? `excepto las fechas ${excludedDates.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join(". ");
        try {
          await mailer.sendMail({
            from: EMAIL_FROM,
            to: recipient.email,
            replyTo: site.site_email || HOTEL_CONTACT_EMAIL,
            subject: `Una invitación especial para tu próxima estancia · ${site.site_name}`,
            text: `Hola ${recipient.guest_name},\n\nGracias por haberte alojado en ${site.site_name}. Nos encantará recibirte de nuevo. Usa el código ${promotion.code} para obtener un ${promotion.discount_percent}% de descuento. ${conditions}.\n\nConsulta disponibilidad en ${frontendUrl}/habitaciones.\n\n${site.site_name}`,
            html: `<div style="margin:0;padding:32px 16px;background:#f4f3ed;font-family:Arial,sans-serif;color:#252a22;line-height:1.6">
              <div style="max-width:600px;margin:auto;padding:36px;background:#fff;border:1px solid #e2e1d8">
                <p style="margin:0 0 8px;color:#87704c;text-transform:uppercase;letter-spacing:2px;font-size:12px">${safe.siteName}</p>
                <h1 style="margin:0 0 22px;color:#26382d;font-size:28px">Hola ${safeName},</h1>
                <p>Gracias por haberte alojado con nosotros. Nos encantará recibirte de nuevo y ayudarte a preparar tu próxima escapada.</p>
                <div style="margin:26px 0;padding:22px;text-align:center;background:#f3f5ef;border:1px solid #dfe4d9">
                  <p style="margin:0 0 8px">Hemos preparado para ti</p>
                  <p style="margin:0;color:#26382d;font-size:30px;font-weight:bold">${safe.discount}% de descuento</p>
                  <p style="margin:12px 0 0">Código: <strong style="letter-spacing:2px">${safe.code}</strong></p>
                </div>
                <p><strong>Condiciones:</strong> ${escapeHtml(conditions)}.</p>
                <p style="text-align:center;margin:30px 0"><a href="${frontendUrl}/habitaciones" style="display:inline-block;padding:14px 24px;background:#26382d;color:#fff;text-decoration:none">Ver habitaciones</a></p>
                <p style="font-size:12px;color:#777">Recibes este mensaje porque aceptaste recibir comunicaciones comerciales durante tu estancia.</p>
                <p><strong>${safe.siteName}</strong></p>
              </div>
            </div>`,
          });
          sent.push(email);
        } catch (error) {
          console.error(
            `No se pudo enviar la promoción ${promotion.code} a ${email}.`,
            error,
          );
          failed.push({email, reason: "No se pudo enviar el correo."});
        }
      }
      res.status(failed.length ? 207 : 200).json({sent, failed});
    } catch (error) {
      next(error);
    }
  },
);

app.post("/api/admin/discount-codes", requireAdmin, async (req, res, next) => {
  const body = req.body ?? {};
  const errors = validateDiscountInput(body);
  if (errors.length) return res.status(400).json({errors});
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const {rows} = await client.query(
      `INSERT INTO discount_codes
        (code, discount_percent, minimum_amount, starts_on, ends_on, max_uses, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        body.code.trim().toUpperCase(),
        body.discount_percent,
        body.minimum_amount,
        body.starts_on || null,
        body.ends_on || null,
        body.max_uses || null,
        body.is_active,
      ],
    );
    for (const range of body.excluded_dates) {
      await client.query(
        `INSERT INTO discount_code_excluded_dates (discount_code_id, start_date, end_date)
         VALUES ($1, $2, $3)`,
        [rows[0].id, range.start_date, range.end_date],
      );
    }
    await client.query("COMMIT");
    res.status(201).json({id: rows[0].id});
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      return res
        .status(409)
        .json({errors: ["Ya existe un código con ese nombre."]});
    }
    next(error);
  } finally {
    client.release();
  }
});

app.put(
  "/api/admin/discount-codes/:id",
  requireAdmin,
  async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1)
      return res.status(400).json({errors: ["El código no es válido."]});
    const body = req.body ?? {};
    const errors = validateDiscountInput(body);
    if (errors.length) return res.status(400).json({errors});
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const {rows: currentRows} = await client.query(
        "SELECT id, (SELECT COUNT(*)::int FROM booking_discount_redemptions r WHERE r.discount_code_id = discount_codes.id) AS usage_count FROM discount_codes WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!currentRows.length) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({errors: ["No se ha encontrado el código."]});
      }
      if (body.max_uses && body.max_uses < currentRows[0].usage_count) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          errors: [
            "El límite de usos no puede ser menor que los canjes ya realizados.",
          ],
        });
      }
      await client.query(
        `UPDATE discount_codes
          SET code = $2, discount_percent = $3, minimum_amount = $4, starts_on = $5,
              ends_on = $6, max_uses = $7, is_active = $8
        WHERE id = $1`,
        [
          id,
          body.code.trim().toUpperCase(),
          body.discount_percent,
          body.minimum_amount,
          body.starts_on || null,
          body.ends_on || null,
          body.max_uses || null,
          body.is_active,
        ],
      );
      await client.query(
        "DELETE FROM discount_code_excluded_dates WHERE discount_code_id = $1",
        [id],
      );
      for (const range of body.excluded_dates) {
        await client.query(
          `INSERT INTO discount_code_excluded_dates (discount_code_id, start_date, end_date)
         VALUES ($1, $2, $3)`,
          [id, range.start_date, range.end_date],
        );
      }
      await client.query("COMMIT");
      res.json({ok: true});
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error.code === "23505") {
        return res
          .status(409)
          .json({errors: ["Ya existe un código con ese nombre."]});
      }
      next(error);
    } finally {
      client.release();
    }
  },
);

app.delete(
  "/api/admin/discount-codes/:id",
  requireAdmin,
  async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1)
      return res.status(400).json({errors: ["El código no es válido."]});
    try {
      const {rows} = await pool.query(
        "DELETE FROM discount_codes WHERE id = $1 RETURNING id",
        [id],
      );
      if (!rows.length)
        return res
          .status(404)
          .json({errors: ["No se ha encontrado el código."]});
      res.json({ok: true});
    } catch (error) {
      if (error.code === "23503") {
        return res.status(409).json({
          errors: [
            "El código tiene reservas asociadas. Desactívalo para conservar el histórico.",
          ],
        });
      }
      next(error);
    }
  },
);

app.post("/api/discount-codes/validate", async (req, res, next) => {
  const {
    code,
    room_id,
    check_in,
    check_out,
    adults,
    children,
    breakfast,
    pets,
  } = req.body ?? {};
  if (
    typeof code !== "string" ||
    !/^[A-Za-z0-9_-]{2,40}$/.test(code.trim()) ||
    !Number.isInteger(room_id) ||
    !isDate(check_in) ||
    !isDate(check_out) ||
    check_out <= check_in ||
    !Number.isInteger(adults) ||
    adults < 1 ||
    adults > 13 ||
    !Number.isInteger(children) ||
    children < 0 ||
    children > 12 ||
    adults + children > 13 ||
    typeof breakfast !== "boolean" ||
    typeof pets !== "boolean"
  ) {
    return res.status(400).json({
      errors: ["Completa los datos de la estancia para validar el código."],
    });
  }
  try {
    const {rows} = await pool.query(
      `SELECT pricing_type, price_per_night::float8 AS price_per_night,
              single_price::float8 AS single_price, double_price::float8 AS double_price,
              extra_bed_price::float8 AS extra_bed_price, capacity, is_active
         FROM rooms WHERE id = $1`,
      [room_id],
    );
    const room = rows[0];
    if (!room || !room.is_active || adults + children > room.capacity) {
      return res
        .status(400)
        .json({errors: ["La habitación no admite la ocupación indicada."]});
    }
    const settings = await readSiteSettings();
    const pricing = calculateBookingPrice({
      pricingType: room.pricing_type,
      singlePrice: room.single_price,
      doublePrice: room.double_price,
      extraBedPrice: room.extra_bed_price,
      ruralHousePrice: room.price_per_night,
      pricePerNight: room.price_per_night,
      checkIn: check_in,
      checkOut: check_out,
      adults,
      children,
      breakfast,
      pets,
      breakfastPrice: Number(settings.breakfast_price),
      petsPrice: Number(settings.pets_price),
    });
    const validation = await validateDiscountForStay(pool, {
      code,
      amount: pricing.total,
      checkIn: check_in,
      checkOut: check_out,
    });
    if (validation.error)
      return res.status(400).json({errors: [validation.error]});
    const discountAmount = calculateDiscount(
      pricing.total,
      validation.discount.discount_percent,
    );
    res.json({
      code: validation.discount.code,
      discount_percent: validation.discount.discount_percent,
      discount_amount: discountAmount,
      total: Math.max(0, pricing.total - discountAmount),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/rooms", requireAdmin, async (req, res, next) => {
  const body = req.body ?? {};
  const errors = validateRoomInput(body);
  const slug =
    typeof body.name === "string" ? slugifyRoomName(body.name.trim()) : "";
  if (!slug) errors.push("El nombre no genera un identificador válido.");
  const imageDataUrls = Array.isArray(body.image_data_urls)
    ? body.image_data_urls
    : body.image_data_url ? [body.image_data_url] : [];
  const decodedImages = imageDataUrls.map(decodeRoomImage);
  if (imageDataUrls.length > 10 || decodedImages.some((image) => !image))
    errors.push("Selecciona hasta 10 imágenes JPG, PNG o WebP de hasta 5 MB cada una.");
  if (errors.length) return res.status(400).json({errors});

  let roomId = null;
  const savedImages = [];
  try {
    const {rows} = await pool.query(
      `INSERT INTO rooms (name, slug, description, price_per_night, pricing_type,
                          catalog_category, single_price, double_price, extra_bed_price,
                          capacity, features, image_url, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, name, slug, description, price_per_night::float8 AS price_per_night,
                 pricing_type, catalog_category, single_price::float8 AS single_price,
                 double_price::float8 AS double_price, extra_bed_price::float8 AS extra_bed_price,
                 capacity, features, image_url, is_active`,
      [
        body.name.trim(),
        slug,
        body.description.trim(),
        body.pricing_type === "rural_house"
          ? body.price_per_night
          : body.double_price,
        body.pricing_type,
        body.catalog_category.trim(),
        body.single_price,
        body.double_price,
        body.extra_bed_price,
        body.capacity,
        JSON.stringify(body.features.map((feature) => feature.trim())),
        null,
        body.is_active ?? true,
      ],
    );
    roomId = rows[0].id;
    if (decodedImages.length) {
      for (const dataUrl of imageDataUrls) savedImages.push(await saveRoomImage(slug, dataUrl));
      const savedImage = savedImages[0];
      const {rows: updatedRows} = await pool.query(
        `UPDATE rooms SET image_url = $2
          WHERE id = $1
          RETURNING id, name, slug, description, price_per_night::float8 AS price_per_night,
                    pricing_type, catalog_category, single_price::float8 AS single_price,
                    double_price::float8 AS double_price, extra_bed_price::float8 AS extra_bed_price,
                    capacity, features, image_url, is_active`,
        [roomId, savedImage.imageUrl],
      );
      for (const [position, image] of savedImages.entries()) {
        await pool.query(
          "INSERT INTO room_images (room_id, object_path, image_url, position) VALUES ($1, $2, $3, $4)",
          [roomId, image.objectPath, image.imageUrl, position],
        );
      }
      res.status(201).json({...updatedRows[0], availability_blocks: []});
    } else {
      res.status(201).json({...rows[0], availability_blocks: []});
    }
  } catch (error) {
    if (roomId !== null)
      await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
    await Promise.allSettled(savedImages.map((image) => removeStorageObjects(storageBuckets.public, [image.objectPath])));
    if (error.code === "23505") {
      return res.status(409).json({
        errors: ["Ya existe una habitación con un nombre equivalente."],
      });
    }
    next(error);
  }
});

app.put("/api/admin/rooms/:id", requireAdmin, async (req, res, next) => {
  const roomId = Number(req.params.id);
  if (!Number.isInteger(roomId) || roomId < 1)
    return res.status(400).json({errors: ["La habitación no es válida."]});
  const body = req.body ?? {};
  const errors = validateRoomInput(body);
  const imageDataUrls = Array.isArray(body.image_data_urls)
    ? body.image_data_urls
    : body.image_data_url ? [body.image_data_url] : [];
  const decodedImages = imageDataUrls.map(decodeRoomImage);
  const removeImageIds = Array.isArray(body.remove_image_ids) ? body.remove_image_ids : [];
  if (imageDataUrls.length > 10 || decodedImages.some((image) => !image))
    errors.push("Selecciona hasta 10 imágenes JPG, PNG o WebP de hasta 5 MB cada una.");
  if (removeImageIds.some((id) => !Number.isInteger(id) || id < 1))
    errors.push("La selección de fotos para eliminar no es válida.");
  if (errors.length) return res.status(400).json({errors});

  const savedImages = [];
  try {
    const {rows: existingRows} = await pool.query(
      "SELECT id, slug, image_url FROM rooms WHERE id = $1",
      [roomId],
    );
    const existing = existingRows[0];
    if (!existing)
      return res
        .status(404)
        .json({errors: ["No se ha encontrado la habitación."]});
    for (const dataUrl of imageDataUrls) savedImages.push(await saveRoomImage(existing.slug, dataUrl));
    const {rows: currentImages} = await pool.query(
      "SELECT id, object_path, image_url, position FROM room_images WHERE room_id = $1 ORDER BY position, id",
      [roomId],
    );
    const removedImages = currentImages.filter((image) => removeImageIds.includes(image.id));
    const keptImages = currentImages.filter((image) => !removeImageIds.includes(image.id));
    const mergedImages = [...keptImages, ...savedImages.map((image) => ({...image, id: null}))];
    const imageUrl = mergedImages[0]?.image_url ?? (currentImages.length ? null : existing.image_url);
    const {rows} = await pool.query(
      `UPDATE rooms
          SET name = $2, description = $3, price_per_night = $4, pricing_type = $5,
              catalog_category = $6, single_price = $7, double_price = $8,
              extra_bed_price = $9, capacity = $10, features = $11::jsonb,
              image_url = $12, is_active = $13
        WHERE id = $1
        RETURNING id, name, slug, description, price_per_night::float8 AS price_per_night,
                  pricing_type, catalog_category, single_price::float8 AS single_price,
                  double_price::float8 AS double_price, extra_bed_price::float8 AS extra_bed_price,
                  capacity, features, image_url, is_active`,
      [
        roomId,
        body.name.trim(),
        body.description.trim(),
        body.pricing_type === "rural_house"
          ? body.price_per_night
          : body.double_price,
        body.pricing_type,
        body.catalog_category.trim(),
        body.single_price,
        body.double_price,
        body.extra_bed_price,
        body.capacity,
        JSON.stringify(body.features.map((feature) => feature.trim())),
        imageUrl,
        body.is_active ?? true,
      ],
    );
    for (const image of savedImages) {
      await pool.query(
        "INSERT INTO room_images (room_id, object_path, image_url, position) VALUES ($1, $2, $3, $4)",
        [roomId, image.objectPath, image.imageUrl, mergedImages.findIndex((entry) => entry.objectPath === image.objectPath)],
      );
    }
    if (removeImageIds.length) {
      await pool.query("DELETE FROM room_images WHERE room_id = $1 AND id = ANY($2::bigint[])", [roomId, removeImageIds]);
      await removeStorageObjects(storageBuckets.public, removedImages.map((image) => image.object_path));
    }
    await pool.query("UPDATE room_images SET position = position WHERE room_id = $1", [roomId]);
    res.json({...rows[0]});
  } catch (error) {
    await Promise.allSettled(savedImages.map((image) => removeStorageObjects(storageBuckets.public, [image.objectPath])));
    if (error.code === "23505") {
      return res.status(409).json({
        errors: ["Ya existe una habitación con un nombre equivalente."],
      });
    }
    next(error);
  }
});

app.delete("/api/admin/rooms/:id", requireAdmin, async (req, res, next) => {
  const roomId = Number(req.params.id);
  if (!Number.isInteger(roomId) || roomId < 1)
    return res.status(400).json({errors: ["La habitación no es válida."]});
  try {
    const {rows: roomImages} = await pool.query(
      "SELECT object_path FROM room_images WHERE room_id = $1",
      [roomId],
    );
    const {rows} = await pool.query(
      "DELETE FROM rooms WHERE id = $1 RETURNING slug",
      [roomId],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({errors: ["No se ha encontrado la habitación."]});
    await removeStorageObjects(storageBuckets.public, roomImages.map((image) => image.object_path));
    await rm(join(roomImageStorageRoot, rows[0].slug), {
      recursive: true,
      force: true,
    });
    res.json({ok: true});
  } catch (error) {
    if (error.code === "23503") {
      return res.status(409).json({
        errors: [
          "Esta habitación tiene reservas asociadas. Desactívala para conservar el histórico.",
        ],
      });
    }
    next(error);
  }
});

app.post("/api/admin/rooms/bulk", requireAdmin, async (req, res, next) => {
  const {room_ids, action} = req.body ?? {};
  if (
    !Array.isArray(room_ids) ||
    !["set_prices", "activate", "deactivate", "delete"].includes(action)
  ) {
    return res
      .status(400)
      .json({errors: ["La selección o acción masiva no es válida."]});
  }
  const ids = [...new Set(room_ids)];
  if (
    ids.length < 1 ||
    ids.length > 500 ||
    ids.some((id) => !Number.isInteger(id) || id < 1)
  ) {
    return res
      .status(400)
      .json({errors: ["La selección o acción masiva no es válida."]});
  }
  try {
    if (action === "set_prices") {
      const {single_price, double_price, extra_bed_price} = req.body;
      if (
        [single_price, double_price, extra_bed_price].some(
          (value) =>
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > 100000,
        ) ||
        double_price <= 0
      ) {
        return res.status(400).json({
          errors: ["Indica precios válidos para las habitaciones."],
        });
      }
      const {rowCount} = await pool.query(
        `UPDATE rooms
            SET single_price = $2,
                double_price = $3,
                extra_bed_price = $4,
                price_per_night = $3
          WHERE id = ANY($1::int[])
            AND pricing_type = 'standard'`,
        [ids, single_price, double_price, extra_bed_price],
      );
      return res.json({updated: rowCount});
    }
    if (action === "activate" || action === "deactivate") {
      const {rowCount} = await pool.query(
        "UPDATE rooms SET is_active = $2 WHERE id = ANY($1::int[]) AND pricing_type = 'standard'",
        [ids, action === "activate"],
      );
      return res.json({updated: rowCount});
    }

    const {rows: imageObjects} = await pool.query(
      `SELECT ri.room_id, ri.object_path FROM room_images ri
        JOIN rooms r ON r.id = ri.room_id
        WHERE r.id = ANY($1::int[]) AND r.pricing_type = 'standard'
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.id)`,
      [ids],
    );
    const {rows: deleted} = await pool.query(
      `DELETE FROM rooms r
        WHERE r.id = ANY($1::int[])
          AND r.pricing_type = 'standard'
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.id)
        RETURNING r.id, r.slug`,
      [ids],
    );
    const deletedIds = deleted.map((room) => room.id);
    const {rows: retained} = await pool.query(
      `SELECT id, name FROM rooms
        WHERE id = ANY($1::int[])
          AND pricing_type = 'standard'
          AND EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = rooms.id)
        ORDER BY name`,
      [ids],
    );
    if (retained.length) {
      await pool.query(
        "UPDATE rooms SET is_active = FALSE WHERE id = ANY($1::int[]) AND pricing_type = 'standard'",
        [retained.map((room) => room.id)],
      );
    }
    await Promise.all(
      deleted.map((room) =>
        rm(join(roomImageStorageRoot, room.slug), {
          recursive: true,
          force: true,
        }),
      ),
    );
    const deletedSet = new Set(deletedIds);
    await removeStorageObjects(storageBuckets.public, imageObjects
      .filter((image) => deletedSet.has(image.room_id))
      .map((image) => image.object_path));
    res.json({
      deleted: deletedIds,
      retained: retained.map(({id, name}) => ({id, name})),
    });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/admin/rooms/:id/availability-blocks",
  requireAdmin,
  async (req, res, next) => {
    const roomId = Number(req.params.id);
    const {start_date, end_date, reason = ""} = req.body ?? {};
    if (
      !Number.isInteger(roomId) ||
      roomId < 1 ||
      !isDate(start_date) ||
      !isDate(end_date) ||
      end_date <= start_date ||
      typeof reason !== "string" ||
      reason.length > 200
    ) {
      return res.status(400).json({
        errors: [
          "Indica un intervalo válido y un motivo de hasta 200 caracteres.",
        ],
      });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const {rows: roomRows} = await client.query(
        "SELECT id FROM rooms WHERE id = $1 FOR UPDATE",
        [roomId],
      );
      if (!roomRows.length) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({errors: ["No se ha encontrado la habitación."]});
      }
      const {rowCount} = await client.query(
        `SELECT 1 FROM bookings
        WHERE room_id = $1 AND check_in < $2 AND check_out > $3
        LIMIT 1`,
        [roomId, end_date, start_date],
      );
      if (rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({errors: ["El intervalo coincide con una reserva existente."]});
      }
      const {rows} = await client.query(
        `INSERT INTO room_availability_blocks (room_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id, room_id, start_date, end_date, reason`,
        [roomId, start_date, end_date, reason.trim()],
      );
      await client.query("COMMIT");
      res.status(201).json(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  },
);

app.delete(
  "/api/admin/rooms/:roomId/availability-blocks/:blockId",
  requireAdmin,
  async (req, res, next) => {
    const roomId = Number(req.params.roomId);
    const blockId = Number(req.params.blockId);
    if (!Number.isInteger(roomId) || !Number.isInteger(blockId)) {
      return res.status(400).json({errors: ["El bloqueo no es válido."]});
    }
    try {
      const {rowCount} = await pool.query(
        "DELETE FROM room_availability_blocks WHERE id = $1 AND room_id = $2",
        [blockId, roomId],
      );
      if (!rowCount)
        return res
          .status(404)
          .json({errors: ["No se ha encontrado el bloqueo."]});
      res.json({ok: true});
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/admin/rooms/:roomId/availability-blocks/:blockId",
  requireAdmin,
  async (req, res, next) => {
    const roomId = Number(req.params.roomId);
    const blockId = Number(req.params.blockId);
    const {start_date, end_date, reason = ""} = req.body ?? {};
    if (
      !Number.isInteger(roomId) ||
      roomId < 1 ||
      !Number.isInteger(blockId) ||
      blockId < 1 ||
      !isDate(start_date) ||
      !isDate(end_date) ||
      end_date <= start_date ||
      typeof reason !== "string" ||
      reason.length > 200
    ) {
      return res.status(400).json({
        errors: [
          "Indica un intervalo válido y un motivo de hasta 200 caracteres.",
        ],
      });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const {rows: roomRows} = await client.query(
        "SELECT id FROM rooms WHERE id = $1 FOR UPDATE",
        [roomId],
      );
      if (!roomRows.length) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({errors: ["No se ha encontrado la habitación."]});
      }
      const {rowCount: bookingCount} = await client.query(
        `SELECT 1 FROM bookings
        WHERE room_id = $1 AND check_in < $2 AND check_out > $3
        LIMIT 1`,
        [roomId, end_date, start_date],
      );
      if (bookingCount) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({errors: ["El intervalo coincide con una reserva existente."]});
      }
      const {rows} = await client.query(
        `UPDATE room_availability_blocks
          SET start_date = $3, end_date = $4, reason = $5
        WHERE id = $1 AND room_id = $2
        RETURNING id, room_id, start_date, end_date, reason`,
        [blockId, roomId, start_date, end_date, reason.trim()],
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({errors: ["No se ha encontrado el bloqueo."]});
      }
      await client.query("COMMIT");
      res.json(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  },
);

app.get("/api/rooms/availability", async (req, res, next) => {
  const {check_in, check_out} = req.query;
  const adults = Number(req.query.adults);
  const children = Number(req.query.children);
  const errors = [];

  if (!isDate(check_in) || !isDate(check_out))
    errors.push("Elige las fechas de entrada y salida.");
  else if (check_in < today())
    errors.push("La fecha de entrada no puede ser anterior a hoy.");
  else if (check_out <= check_in)
    errors.push("La salida debe ser posterior a la entrada.");
  if (!Number.isInteger(adults) || adults < 1 || adults > 13)
    errors.push("Indica entre 1 y 13 adultos.");
  if (!Number.isInteger(children) || children < 0 || children > 12)
    errors.push("Indica entre 0 y 12 niños.");
  if (adults + children > 13)
    errors.push("La reserva admite hasta 13 huéspedes.");
  if (errors.length) return res.status(400).json({errors});

  try {
    const closure = await findActiveClosure(check_in, check_out);
    if (closure) {
      return res.status(409).json({errors: [closureMessage(closure)]});
    }
    const {rows} = await pool.query(
      `SELECT r.id, r.name, r.slug, r.description, r.price_per_night::float8 AS price_per_night,
              r.pricing_type, r.single_price::float8 AS single_price,
              r.double_price::float8 AS double_price,
              r.extra_bed_price::float8 AS extra_bed_price,
              r.capacity, r.features, r.image_url, r.catalog_category,
              COALESCE((SELECT json_agg(json_build_object('id', ri.id, 'image_url', ri.image_url, 'position', ri.position)
                ORDER BY ri.position, ri.id) FROM room_images ri WHERE ri.room_id = r.id), '[]'::json) AS images
         FROM rooms r
        WHERE r.is_active = TRUE
          AND r.capacity >= $3
          AND NOT EXISTS (
            SELECT 1
              FROM bookings b
             WHERE b.room_id = r.id
               AND b.check_in < $2
               AND b.check_out > $1
          )
          AND NOT EXISTS (
            SELECT 1
              FROM room_availability_blocks blocked
             WHERE blocked.room_id = r.id
               AND blocked.start_date < $2
               AND blocked.end_date > $1
          )
        ORDER BY r.price_per_night DESC`,
      [check_in, check_out, adults + children],
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.post("/api/bookings", async (req, res, next) => {
  const {
    room_id,
    guest_name,
    identity_document,
    phone,
    email,
    check_in,
    check_out,
    adults = 1,
    children = 0,
    breakfast = false,
    pets = false,
    notes = "",
    discount_code = "",
  } = req.body ?? {};
  const errors = [];
  if (!Number.isInteger(room_id)) errors.push("Elige una habitación.");
  if (typeof guest_name !== "string" || guest_name.trim().length < 2)
    errors.push("Escribe tu nombre.");
  if (
    typeof identity_document !== "string" ||
    identity_document.trim().length < 3
  )
    errors.push("Escribe tu documento de identidad.");
  if (typeof phone !== "string" || phone.trim().length < 6)
    errors.push("Escribe un teléfono válido.");
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email))
    errors.push("Escribe un correo válido.");
  if (!isDate(check_in) || !isDate(check_out))
    errors.push("Elige las fechas de entrada y salida.");
  else if (check_in < today())
    errors.push("La fecha de entrada no puede ser anterior a hoy.");
  else if (check_out <= check_in)
    errors.push("La salida debe ser posterior a la entrada.");
  if (!Number.isInteger(adults) || adults < 1 || adults > 13)
    errors.push("Indica entre 1 y 13 adultos.");
  if (!Number.isInteger(children) || children < 0 || children > 12)
    errors.push("Indica entre 0 y 12 niños.");
  if (adults + children > 13)
    errors.push("La reserva admite hasta 13 huéspedes.");
  if (typeof breakfast !== "boolean") errors.push("Indica si deseas desayuno.");
  if (typeof pets !== "boolean")
    errors.push("Indica si viajarás con mascotas.");
  if (typeof notes !== "string" || notes.length > 2000)
    errors.push("Las observaciones no pueden superar los 2000 caracteres.");
  if (
    discount_code !== "" &&
    (typeof discount_code !== "string" ||
      !/^[A-Za-z0-9_-]{2,40}$/.test(discount_code.trim()))
  ) {
    errors.push("El código de descuento no es válido.");
  }
  if (errors.length) return res.status(400).json({errors});

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const closure = await findActiveClosure(check_in, check_out, client);
    if (closure) {
      await client.query("ROLLBACK");
      return res.status(409).json({errors: [closureMessage(closure)]});
    }
    // Bloquea la habitación para que dos reservas simultáneas no se solapen.
    const room = (
      await client.query(
        `SELECT name, price_per_night::float8 AS price, pricing_type,
                single_price::float8 AS single_price, double_price::float8 AS double_price,
                extra_bed_price::float8 AS extra_bed_price,
                capacity, features, is_active
           FROM rooms WHERE id = $1 FOR UPDATE`,
        [room_id],
      )
    ).rows[0];
    if (!room) {
      await client.query("ROLLBACK");
      return res.status(404).json({errors: ["Esa habitación no existe."]});
    }
    if (!room.is_active) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        errors: ["Esa habitación no está disponible para nuevas reservas."],
      });
    }
    if (adults + children > room.capacity) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        errors: [`Esa habitación admite hasta ${room.capacity} personas.`],
      });
    }
    const clash = await client.query(
      `SELECT 1
         FROM bookings
        WHERE room_id = $1 AND check_in < $3 AND check_out > $2
       UNION ALL
       SELECT 1
         FROM room_availability_blocks
        WHERE room_id = $1 AND start_date < $3 AND end_date > $2
        LIMIT 1`,
      [room_id, check_in, check_out],
    );
    if (clash.rowCount) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({errors: ["Esa habitación no está disponible en esas fechas."]});
    }
    const siteSettings = await readSiteSettings();
    const pricing = calculateBookingPrice({
      pricingType: room.pricing_type,
      singlePrice: room.single_price,
      doublePrice: room.double_price,
      extraBedPrice: room.extra_bed_price,
      ruralHousePrice: room.price,
      pricePerNight: room.price,
      checkIn: check_in,
      checkOut: check_out,
      adults,
      children,
      breakfast,
      pets,
      breakfastPrice: Number(siteSettings.breakfast_price),
      petsPrice: Number(siteSettings.pets_price),
    });
    const nights = pricing.nights;
    const {roomSubtotal, breakfastTotal, petsTotal} = pricing;
    let activeDiscount = null;
    let discountAmount = 0;
    if (discount_code.trim()) {
      const validation = await validateDiscountForStay(
        client,
        {
          code: discount_code,
          amount: pricing.total,
          checkIn: check_in,
          checkOut: check_out,
        },
        true,
      );
      if (validation.error) {
        await client.query("ROLLBACK");
        return res.status(400).json({errors: [validation.error]});
      }
      activeDiscount = validation.discount;
      discountAmount = calculateDiscount(
        pricing.total,
        activeDiscount.discount_percent,
      );
    }
    const total = pricing.total - discountAmount;
    const vatBreakdown = await calculateStoredVat(
      client,
      check_in,
      check_out,
      pricing,
      discountAmount,
    );
    const reference = newReservationCode();
    const arrivalPin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const token = randomBytes(32).toString("base64url");
    const accessToken = randomBytes(32).toString("base64url");
    const tokenExpiresAt = new Date(
      Date.parse(`${check_in}T00:00:00.000Z`) + 86_400_000,
    ).toISOString();
    const {rows: insertedBookings} = await client.query(
      `INSERT INTO bookings
         (room_id, guest_name, identity_document, phone, email, check_in, check_out,
          adults, children, breakfast, pets, notes, total, room_subtotal, breakfast_total,
          pets_total, vat_breakdown, discount_code, discount_amount, discount_percent,
          arrival_pin, reservation_code, access_token_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING id`,
      [
        room_id,
        guest_name.trim(),
        identity_document.trim(),
        phone.trim(),
        email.trim(),
        check_in,
        check_out,
        adults,
        children,
        breakfast,
        pets,
        notes.trim(),
        total,
        roomSubtotal,
        breakfastTotal,
        petsTotal,
        JSON.stringify(vatBreakdown),
        activeDiscount?.code ?? null,
        discountAmount,
        activeDiscount?.discount_percent ?? 0,
        arrivalPin,
        reference,
        hashToken(accessToken),
      ],
    );
    if (activeDiscount) {
      await client.query(
        "INSERT INTO booking_discount_redemptions (booking_id, discount_code_id) VALUES ($1, $2)",
        [insertedBookings[0].id, activeDiscount.id],
      );
    }
    await client.query(
      `INSERT INTO pre_checkings (booking_id, room_id, token_hash, token_expires_at)
       VALUES ($1, $2, $3, $4)`,
      [insertedBookings[0].id, room_id, hashToken(token), tokenExpiresAt],
    );
    let emailSent = true;
    await client.query("COMMIT");
    try {
      const {rows: bookingRows} = await client.query(
        `SELECT ${adminBookingFields}
           FROM bookings b
           JOIN rooms r ON r.id = b.room_id
           LEFT JOIN pre_checkings p ON p.booking_id = b.id
          WHERE b.id = $1`,
        [insertedBookings[0].id],
      );
      const reservationPdf = await createBookingPdf(bookingRows[0], {
        includePrecheckin: false,
      });
      await sendBookingConfirmationEmail({
        email: email.trim(),
        guestName: guest_name.trim(),
        reference,
        roomName: room.name,
        roomFeatures: room.features,
        checkIn: check_in,
        checkOut: check_out,
        adults,
        children,
        nights,
        breakfast,
        breakfastTotal,
        pets,
        petsTotal,
        roomSubtotal,
        discountCode: activeDiscount?.code ?? null,
        discountAmount,
        vatBreakdown,
        total,
        token,
        accessToken,
        arrivalPin,
        reservationPdf,
      });
    } catch (error) {
      emailSent = false;
      console.error(
        `La reserva ${reference} se guardó, pero no se pudo enviar el enlace de pre-check-in.`,
        error,
      );
    }
    res.status(201).json({
      reference,
      pin: arrivalPin,
      email_sent: emailSent,
      nights,
      total,
      discount_code: activeDiscount?.code ?? null,
      discount_amount: discountAmount,
      breakfast_total: breakfastTotal,
      pets_total: petsTotal,
      vat_breakdown: vatBreakdown,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

app.get("/api/pre-check-in/:token", async (req, res, next) => {
  const {token} = req.params;
  res.set("Cache-Control", "no-store");
  if (!/^[\w-]{43}$/.test(token))
    return res.status(404).json({
      errors: ["El enlace de pre-check-in no es válido o ha caducado."],
    });

  try {
    const {rows} = await pool.query(
      `SELECT b.reservation_code, b.guest_name, b.identity_document, b.email, b.phone,
              b.check_in, b.check_out, b.adults, b.children, r.capacity AS room_capacity,
              b.breakfast, b.pets
         FROM bookings b
         JOIN pre_checkings p ON p.booking_id = b.id
         JOIN rooms r ON r.id = b.room_id
        WHERE (p.token_hash = $1 OR b.access_token_hash = $1)
          AND p.completed_at IS NULL
          AND p.token_expires_at > now()
          AND (b.check_in::timestamp AT TIME ZONE 'UTC') <= now() + INTERVAL '72 hours'
          AND (b.check_in::timestamp + INTERVAL '1 day') AT TIME ZONE 'UTC' > now()`,
      [hashToken(token)],
    );
    if (!rows.length)
      return res.status(404).json({
        errors: ["El enlace de pre-check-in no es válido o ha caducado."],
      });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post("/api/pre-check-in/:token", async (req, res, next) => {
  const {token} = req.params;
  res.set("Cache-Control", "no-store");
  if (!/^[\w-]{43}$/.test(token))
    return res.status(404).json({
      errors: ["El enlace de pre-check-in no es válido o ha caducado."],
    });
  const data = req.body ?? {};
  const errors = [];
  const frontImage = decodeDocumentImage(data.identity_document_front);
  const backImage =
    data.identity_document_back == null
      ? null
      : decodeDocumentImage(data.identity_document_back);
  if (!frontImage)
    errors.push("Sube una imagen frontal JPG, PNG o WebP de hasta 5 MB.");
  if (data.document_type !== "passport" && !backImage)
    errors.push("Sube una imagen trasera JPG, PNG o WebP de hasta 5 MB.");
  if (
    data.document_type === "passport" &&
    data.identity_document_back != null
  ) {
    errors.push("Para el pasaporte solo debes enviar la imagen frontal.");
  }
  const requiredText = [
    ["first_name", "Escribe el nombre."],
    ["first_surname", "Escribe el primer apellido."],
    ["nationality", "Escribe la nacionalidad."],
    ["address", "Escribe la dirección habitual."],
    ["city", "Escribe la localidad."],
    ["country", "Escribe el país de residencia."],
    ["identity_document", "Escribe el número de documento."],
  ];
  for (const [field, message] of requiredText) {
    if (
      typeof data[field] !== "string" ||
      data[field].trim().length < 2 ||
      data[field].length > 200
    )
      errors.push(message);
  }
  if (
    data.second_surname !== undefined &&
    (typeof data.second_surname !== "string" ||
      data.second_surname.length > 200)
  ) {
    errors.push("El segundo apellido no es válido.");
  }
  if (!["identity", "dni", "passport", "tie"].includes(data.document_type))
    errors.push("Selecciona el tipo de documento.");
  if (
    data.document_type !== "passport" &&
    (typeof data.document_support_number !== "string" ||
      data.document_support_number.trim().length < 2 ||
      data.document_support_number.length > 200)
  ) {
    errors.push("Escribe el número de soporte del documento.");
  }
  if (!["female", "male", "other"].includes(data.sex))
    errors.push("Selecciona una opción de sexo válida.");
  if (!isDate(data.birth_date) || data.birth_date >= today())
    errors.push("Indica una fecha de nacimiento válida.");
  if (!isDate(data.document_issue_date) || data.document_issue_date > today())
    errors.push("Indica una fecha de expedición válida.");
  if (!isDate(data.document_expiry_date))
    errors.push("Indica una fecha de caducidad válida.");
  if (
    typeof data.email !== "string" ||
    data.email.length > 254 ||
    !/^\S+@\S+\.\S+$/.test(data.email)
  )
    errors.push("Escribe un correo electrónico válido.");
  if (
    typeof data.phone_mobile !== "string" ||
    data.phone_mobile.trim().length < 6 ||
    data.phone_mobile.length > 40
  ) {
    errors.push("Escribe un teléfono móvil válido.");
  }
  if (
    data.phone_landline !== undefined &&
    (typeof data.phone_landline !== "string" || data.phone_landline.length > 40)
  )
    errors.push("El teléfono fijo no es válido.");
  if (
    data.minor_relationships !== undefined &&
    (typeof data.minor_relationships !== "string" ||
      data.minor_relationships.length > 2000)
  ) {
    errors.push("El parentesco indicado no es válido.");
  }
  if (
    !Number.isInteger(data.traveler_count) ||
    data.traveler_count < 1 ||
    data.traveler_count > 10
  )
    errors.push("Indica el número total de viajeros.");
  if (
    data.arrival_time !== undefined &&
    data.arrival_time !== null &&
    data.arrival_time !== "" &&
    (typeof data.arrival_time !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.arrival_time))
  ) {
    errors.push("Indica una hora estimada de llegada válida.");
  }
  if (
    data.departure_time !== undefined &&
    data.departure_time !== null &&
    data.departure_time !== "" &&
    (typeof data.departure_time !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.departure_time))
  ) {
    errors.push("Indica una hora de salida válida.");
  }
  if (!["individual", "any", "double", "twin"].includes(data.preferred_bed))
    errors.push("Selecciona una preferencia de cama válida.");
  if (data.terms_accepted !== true)
    errors.push("Debes aceptar las condiciones generales.");
  if (typeof data.marketing_consent !== "boolean")
    errors.push("Indica si autorizas comunicaciones comerciales.");
  if (
    typeof data.digital_signature !== "string" ||
    data.digital_signature.trim().length < 2
  )
    errors.push("Firma las condiciones escribiendo tu nombre completo.");
  const documentDirectory =
    typeof data.identity_document === "string"
      ? data.identity_document
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
      : "";
  if (!documentDirectory || documentDirectory.length > 50)
    errors.push(
      "El número de documento no es válido para guardar las imágenes.",
    );
  if (errors.length) return res.status(400).json({errors});

  const client = await pool.connect();
  const uploadedDocumentPaths = [];
  let databaseCommitted = false;
  try {
    await client.query("BEGIN");
    const {rows: bookings} = await client.query(
      `SELECT p.id AS pre_checking_id, b.id AS booking_id, b.check_in, b.adults, b.children,
              r.capacity AS room_capacity
         FROM bookings b
         JOIN pre_checkings p ON p.booking_id = b.id
         JOIN rooms r ON r.id = b.room_id
        WHERE (p.token_hash = $1 OR b.access_token_hash = $1)
          AND p.completed_at IS NULL
          AND p.token_expires_at > now()
          AND (b.check_in::timestamp AT TIME ZONE 'UTC') <= now() + INTERVAL '72 hours'
          AND (b.check_in::timestamp + INTERVAL '1 day') AT TIME ZONE 'UTC' > now()
        FOR UPDATE OF p`,
      [hashToken(token)],
    );
    if (!bookings.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        errors: ["El enlace de pre-check-in no es válido o ha caducado."],
      });
    }
    const booking = bookings[0];
    if (data.traveler_count !== booking.adults + booking.children) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        errors: ["El número de viajeros debe coincidir con la reserva."],
      });
    }
    const individualBedOnly =
      booking.room_capacity === 1 || booking.adults + booking.children === 1;
    if (individualBedOnly !== (data.preferred_bed === "individual")) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        errors: [
          individualBedOnly
            ? "La cama debe ser individual para esta reserva."
            : "Elige una preferencia de cama válida para esta reserva.",
        ],
      });
    }
    if (data.document_issue_date <= data.birth_date) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        errors: [
          `La fecha de expedición recibida (${formatDateForMessage(data.document_issue_date)}) debe ser posterior a la fecha de nacimiento recibida (${formatDateForMessage(data.birth_date)}). Revisa ambos campos.`,
        ],
      });
    }
    if (
      booking.children > 0 &&
      (typeof data.minor_relationships !== "string" ||
        !data.minor_relationships.trim())
    ) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({errors: ["Indica el parentesco de los menores."]});
    }
    if (
      data.document_expiry_date < toDateOnly(booking.check_in)
    ) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        errors: ["El documento debe estar vigente durante la estancia."],
      });
    }
    const secondSurname = data.second_surname?.trim() ?? "";
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const storageDirectory = String(booking.booking_id);
    const saveDocumentFile = async (filename, buffer, contentType) => {
      const objectPath = `pre-checking/${year}/${month}/${storageDirectory}/${randomUUID()}-${filename}`;
      await uploadStorageObject(storageBuckets.private, objectPath, buffer, contentType);
      uploadedDocumentPaths.push(objectPath);
      return `storage:${objectPath}`;
    };
    const frontFilename = `frontal.${frontImage.extension}`;
    const frontDocumentPath = await saveDocumentFile(frontFilename, frontImage.buffer, `image/${frontImage.extension === "jpg" ? "jpeg" : frontImage.extension}`);
    let backDocumentPath = null;
    if (backImage) {
      const backFilename = `trasera.${backImage.extension}`;
      backDocumentPath = await saveDocumentFile(backFilename, backImage.buffer, `image/${backImage.extension === "jpg" ? "jpeg" : backImage.extension}`);
    }

    await client.query(
      `UPDATE pre_checkings
          SET identity_document = $2, phone_mobile = $3, email = $4,
              first_name = $5, first_surname = $6, second_surname = $7,
              sex = $8, nationality = $9, birth_date = $10, home_address = $11,
              home_city = $12, home_country = $13, document_type = $14,
              document_support_number = $15, document_issue_date = $16,
              document_expiry_date = $17, phone_landline = $18, traveler_count = $19,
              minor_relationships = $20, arrival_time = $21, preferred_bed = $22,
              departure_time = $23, terms_accepted_at = now(), marketing_consent = $24,
              marketing_consent_at = CASE WHEN $24 THEN now() ELSE NULL END,
              signature = $25, document_front_path = $26, document_back_path = $27,
              completed_at = now(), token_hash = NULL
        WHERE id = $1`,
      [
        booking.pre_checking_id,
        data.identity_document.trim(),
        data.phone_mobile.trim(),
        data.email.trim(),
        data.first_name.trim(),
        data.first_surname.trim(),
        secondSurname,
        data.sex,
        data.nationality.trim(),
        data.birth_date,
        data.address.trim(),
        data.city.trim(),
        data.country.trim(),
        data.document_type,
        (data.document_support_number ?? "").trim(),
        data.document_issue_date,
        data.document_expiry_date,
        (data.phone_landline ?? "").trim(),
        data.traveler_count,
        (data.minor_relationships ?? "").trim(),
        data.arrival_time || null,
        data.preferred_bed,
        data.departure_time || null,
        data.marketing_consent,
        data.digital_signature.trim(),
        frontDocumentPath,
        backDocumentPath,
      ],
    );
    const {rows: completedBookingRows} = await client.query(
      `SELECT ${adminBookingFields}
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
         LEFT JOIN pre_checkings p ON p.booking_id = b.id
        WHERE b.id = $1`,
      [booking.booking_id],
    );
    const completedBooking = completedBookingRows[0];
    const precheckinPdf = await createPrecheckinPdf(completedBooking);
    await sendPrecheckinCompletedEmail(completedBooking, precheckinPdf);
    await client.query("COMMIT");
    databaseCommitted = true;
    res.json({ok: true});
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (!databaseCommitted) {
      await removeStorageObjects(storageBuckets.private, uploadedDocumentPaths).catch((restoreError) => {
        console.error("No se pudieron retirar los documentos tras fallar el pre-check-in.", restoreError);
      });
    }
    next(error);
  } finally {
    client.release();
  }
});

app.use((_req, res) => {
  res.status(404).json({errors: ["Ruta no encontrada."]});
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.type === "entity.too.large") {
    return res
      .status(413)
      .json({errors: ["Las imágenes superan el tamaño máximo permitido."]});
  }
  res.status(500).json({errors: ["Error interno del servidor."]});
});

async function ensureBootstrapAdministrator() {
  const {rows} = await pool.query("SELECT id FROM administradores LIMIT 1");
  if (rows.length) return;
  if (!ADMIN_USERNAME && !ADMIN_PASSWORD) {
    console.warn(
      "No hay administradores configurados. Define ADMIN_USERNAME y ADMIN_PASSWORD una vez para crear el primer usuario.",
    );
    return;
  }
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error(
      "Para crear el primer administrador debes configurar ADMIN_USERNAME y ADMIN_PASSWORD.",
    );
  }
  if (ADMIN_USERNAME.trim().length === 0 || ADMIN_USERNAME.length > 100) {
    throw new Error("ADMIN_USERNAME debe tener entre 1 y 100 caracteres.");
  }
  if (Buffer.byteLength(ADMIN_PASSWORD, "utf8") > 72) {
    throw new Error(
      "ADMIN_PASSWORD no puede superar 72 bytes UTF-8 porque bcrypt solo procesa hasta 72 bytes.",
    );
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await pool.query(
    `INSERT INTO administradores (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [ADMIN_USERNAME.trim(), passwordHash],
  );
  console.log("Administrador inicial creado en la base de datos.");
}

async function sendDailyTestimonialInvitations() {
  const {rows: bookings} = await pool.query(
    `SELECT b.id, b.guest_name, b.email
       FROM bookings b
      WHERE b.check_out >= CURRENT_DATE - INTERVAL '7 days'
        AND b.check_out < CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM booking_testimonials t WHERE t.booking_id = b.id
        )
      ORDER BY b.check_out DESC`,
  );
  const site = await readSiteSettings();
  for (const booking of bookings) {
    const token = randomBytes(32).toString("base64url");
    const {rows: invitationRows} = await pool.query(
      `INSERT INTO booking_testimonials
         (booking_id, invitation_token_hash, invitation_sent_at)
       VALUES ($1, $2, now())
       ON CONFLICT (booking_id) DO NOTHING
       RETURNING id`,
      [booking.id, hashToken(token)],
    );
    if (!invitationRows.length) continue;

    const reviewLink = new URL(`/testimonio/${token}`, frontendUrl).href;
    const guestName = escapeHtml(booking.guest_name);
    const siteName = escapeHtml(site.site_name);
    try {
      await mailer.sendMail({
        from: EMAIL_FROM,
        to: booking.email,
        subject: `¿Cómo fue tu estancia? · ${site.site_name}`,
        text: `Hola ${booking.guest_name},\n\nGracias por elegirnos para tu estancia. Nos encantaría conocer tu opinión: ${reviewLink}\n\n${site.site_name}`,
        html: `<div style="margin:0;padding:32px 16px;background:#f3f4ef;color:#242820;font-family:Arial,Helvetica,sans-serif">
          <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e3e5dc">
            <div style="padding:28px 32px;background:#244536;color:#fff">
              <p style="margin:0 0 10px;color:#d9c8a4;font-size:12px;letter-spacing:2px;text-transform:uppercase">${siteName}</p>
              <h1 style="margin:0;font-size:25px">Gracias por tu visita</h1>
            </div>
            <div style="padding:28px 32px;line-height:1.7">
              <p>Hola ${guestName},</p>
              <p>Esperamos que hayas disfrutado de tu estancia. Nos encantaría conocer tu experiencia para seguir cuidando cada detalle.</p>
              <p style="margin:26px 0">
                <a href="${escapeHtml(reviewLink)}" style="display:inline-block;padding:14px 22px;background:#244536;color:#fff;text-decoration:none;font-weight:bold">Compartir mi opinión</a>
              </p>
              <p>Podrás valorar tu estancia y contarnos qué te ha parecido en solo un momento.</p>
              <p>¡Esperamos volver a verte pronto!</p>
              <p style="margin-bottom:0"><strong>${siteName}</strong></p>
            </div>
          </div>
        </div>`,
      });
    } catch (error) {
      await pool.query(
        "DELETE FROM booking_testimonials WHERE id = $1 AND invitation_token_hash = $2",
        [invitationRows[0].id, hashToken(token)],
      );
      console.error(
        `No se pudo enviar la invitación para la reserva ${booking.id}.`,
        error,
      );
    }
  }
}

async function start() {
  await prepareImageStorage();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS room_images (
        id SERIAL PRIMARY KEY,
        room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        object_path TEXT NOT NULL UNIQUE,
        image_url TEXT NOT NULL,
        position INT NOT NULL DEFAULT 0 CHECK (position >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS room_images_room_position_idx ON room_images(room_id, position, id);
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS image_url TEXT;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS pricing_type TEXT NOT NULL DEFAULT 'standard';
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS catalog_category TEXT NOT NULL DEFAULT 'Habitación doble';
      UPDATE rooms SET catalog_category = 'Casa rural'
        WHERE pricing_type = 'rural_house' AND catalog_category = 'Habitación doble';
      UPDATE rooms SET catalog_category = 'Suite'
        WHERE pricing_type = 'standard' AND name ILIKE '%suite%' AND catalog_category = 'Habitación doble';
      UPDATE rooms SET catalog_category = 'Habitación individual'
        WHERE pricing_type = 'standard' AND name ILIKE '%individual%' AND catalog_category = 'Habitación doble';
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS single_price NUMERIC(8,2) NOT NULL DEFAULT 30;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS double_price NUMERIC(8,2) NOT NULL DEFAULT 45;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS extra_bed_price NUMERIC(8,2) NOT NULL DEFAULT 15;
      ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_pricing_type_check;
      ALTER TABLE rooms ADD CONSTRAINT rooms_pricing_type_check
        CHECK (pricing_type IN ('standard', 'rural_house'));
      UPDATE rooms SET price_per_night = double_price WHERE pricing_type = 'standard';
      INSERT INTO rooms
        (name, slug, description, price_per_night, pricing_type, catalog_category, single_price,
         double_price, extra_bed_price, capacity, features, is_active)
      VALUES
        ('Casa Rural Paso Camino de Santiago', 'casa-rural',
         'Construcción centenaria rehabilitada, de arquitectura tradicional en adobe y madera. Tiene capacidad para alojar de 2 a 13 personas y cuenta con habitaciones dobles con baño, salón con chimenea, juegos de mesa y cocina totalmente equipada. Dispone de calefacción, agua caliente, patio-terraza, barbacoa, parking y los servicios del hotel.',
         90, 'rural_house', 'Casa rural', 30, 45, 15,
         13, '["Habitaciones dobles con baño","Salón con chimenea","Juegos de mesa","Cocina totalmente equipada","Calefacción y agua caliente","Patio-terraza","Barbacoa","Parking","Servicios del hotel"]'::jsonb,
         TRUE)
      ON CONFLICT (slug) DO NOTHING;
      UPDATE rooms
         SET name = CASE WHEN name = 'Casa rural' THEN 'Casa Rural Paso Camino de Santiago' ELSE name END,
             description = CASE
               WHEN description = 'Casa rural independiente con capacidad para hasta 13 personas.'
               THEN 'Construcción centenaria rehabilitada, de arquitectura tradicional en adobe y madera. Tiene capacidad para alojar de 2 a 13 personas y cuenta con habitaciones dobles con baño, salón con chimenea, juegos de mesa y cocina totalmente equipada. Dispone de calefacción, agua caliente, patio-terraza, barbacoa, parking y los servicios del hotel.'
               ELSE description
             END,
             features = CASE WHEN features = '[]'::jsonb
               THEN '["Habitaciones dobles con baño","Salón con chimenea","Juegos de mesa","Cocina totalmente equipada","Calefacción y agua caliente","Patio-terraza","Barbacoa","Parking","Servicios del hotel"]'::jsonb
               ELSE features
             END,
             image_url = COALESCE(image_url, '${publicStorageUrl("site/casa-rural.webp")}')
       WHERE slug = 'casa-rural';
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_code TEXT;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
      ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_adults_check;
      ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_children_check;
      ALTER TABLE bookings ADD CONSTRAINT bookings_adults_check CHECK (adults BETWEEN 1 AND 13);
      ALTER TABLE bookings ADD CONSTRAINT bookings_children_check CHECK (children BETWEEN 0 AND 12);
      CREATE TABLE IF NOT EXISTS discount_codes (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        discount_percent NUMERIC(5,2) NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
        minimum_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (minimum_amount >= 0),
        starts_on DATE,
        ends_on DATE,
        max_uses INT CHECK (max_uses IS NULL OR max_uses > 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
      );
      CREATE TABLE IF NOT EXISTS discount_code_excluded_dates (
        id SERIAL PRIMARY KEY,
        discount_code_id INT NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        CHECK (end_date >= start_date)
      );
      CREATE INDEX IF NOT EXISTS discount_code_excluded_dates_idx
        ON discount_code_excluded_dates (discount_code_id, start_date, end_date);
      CREATE TABLE IF NOT EXISTS booking_discount_redemptions (
        booking_id INT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
        discount_code_id INT NOT NULL REFERENCES discount_codes(id) ON DELETE RESTRICT,
        redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS booking_discount_redemptions_code_idx
        ON booking_discount_redemptions (discount_code_id);
      DO $migration$
      BEGIN
        IF (
          SELECT data_type FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'rooms'
             AND column_name = 'features'
        ) <> 'jsonb' THEN
          ALTER TABLE rooms ALTER COLUMN features DROP DEFAULT;
          ALTER TABLE rooms ALTER COLUMN features TYPE JSONB USING to_jsonb(features);
        END IF;
      END
      $migration$;
      ALTER TABLE rooms ALTER COLUMN features SET DEFAULT '[]'::jsonb;
      CREATE TABLE IF NOT EXISTS room_availability_blocks (
        id SERIAL PRIMARY KEY,
        room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (end_date > start_date)
      );
      CREATE INDEX IF NOT EXISTS room_availability_blocks_dates
        ON room_availability_blocks (room_id, start_date, end_date);
      CREATE TABLE IF NOT EXISTS administradores (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        session_version INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS administradores_username_lower_idx
        ON administradores (lower(username));
      CREATE OR REPLACE FUNCTION update_administradores_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS administradores_updated_at_trigger ON administradores;
      CREATE TRIGGER administradores_updated_at_trigger
        BEFORE UPDATE ON administradores
        FOR EACH ROW EXECUTE FUNCTION update_administradores_updated_at();
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS identity_document TEXT NOT NULL DEFAULT '';
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS breakfast BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pets BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reservation_code TEXT;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS access_token_hash TEXT;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS room_subtotal NUMERIC(10,2);
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS breakfast_total NUMERIC(10,2);
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pets_total NUMERIC(10,2);
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS vat_breakdown JSONB;
      CREATE TABLE IF NOT EXISTS vat_rates (
        id SERIAL PRIMARY KEY,
        effective_from DATE NOT NULL UNIQUE,
        rate NUMERIC(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO vat_rates (effective_from, rate)
      VALUES ('1900-01-01', 10)
      ON CONFLICT (effective_from) DO NOTHING;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS arrival_pin TEXT;
      UPDATE bookings
         SET breakfast_total = CASE WHEN breakfast
               THEN 5 * (adults + children) * (check_out - check_in)
               ELSE 0 END
       WHERE breakfast_total IS NULL OR (breakfast AND breakfast_total = 0);
      UPDATE bookings
         SET pets_total = CASE WHEN pets THEN 10 ELSE 0 END
       WHERE pets_total IS NULL OR (pets AND pets_total = 0);
      UPDATE bookings
         SET room_subtotal = total - breakfast_total - pets_total
       WHERE room_subtotal IS NULL OR (room_subtotal = 0 AND total > 0);
      CREATE UNIQUE INDEX IF NOT EXISTS bookings_access_token_hash_idx
        ON bookings(access_token_hash);
      CREATE TABLE IF NOT EXISTS pre_checkings (
        id SERIAL PRIMARY KEY,
        booking_id INT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
        room_id INT NOT NULL REFERENCES rooms(id),
        token_hash TEXT UNIQUE,
        token_expires_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        identity_document TEXT,
        phone_mobile TEXT,
        email TEXT,
        first_name TEXT,
        first_surname TEXT,
        second_surname TEXT,
        sex TEXT,
        nationality TEXT,
        birth_date DATE,
        home_address TEXT,
        home_city TEXT,
        home_country TEXT,
        document_type TEXT,
        document_support_number TEXT,
        document_issue_date DATE,
        document_expiry_date DATE,
        phone_landline TEXT,
        traveler_count INT,
        minor_relationships TEXT,
        arrival_time TIME,
        departure_time TIME,
        preferred_bed TEXT,
        terms_accepted_at TIMESTAMPTZ,
        marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
        marketing_consent_at TIMESTAMPTZ,
        signature TEXT,
        document_front_path TEXT,
        document_back_path TEXT
      );
      CREATE TABLE IF NOT EXISTS ses_hospedajes_settings (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        establishment_code TEXT NOT NULL DEFAULT '',
        internet_available BOOLEAN,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO ses_hospedajes_settings (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING;
      ALTER TABLE ses_hospedajes_settings
        ALTER COLUMN internet_available DROP NOT NULL,
        ALTER COLUMN internet_available DROP DEFAULT;
      UPDATE ses_hospedajes_settings
         SET internet_available = NULL
       WHERE establishment_code = '';
      CREATE TABLE IF NOT EXISTS ses_hospedajes_records (
        booking_id INT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
        payment_type TEXT NOT NULL DEFAULT '',
        payment_date DATE,
        payment_medium TEXT NOT NULL DEFAULT '',
        payment_holder TEXT NOT NULL DEFAULT '',
        card_expiry TEXT NOT NULL DEFAULT '',
        check_in_time TIME NOT NULL DEFAULT '15:00',
        check_out_time TIME NOT NULL DEFAULT '11:00',
        primary_document_type TEXT NOT NULL DEFAULT '',
        primary_nationality_code TEXT NOT NULL DEFAULT '',
        primary_country_code TEXT NOT NULL DEFAULT '',
        primary_municipality_code TEXT NOT NULL DEFAULT '',
        primary_municipality_name TEXT NOT NULL DEFAULT '',
        primary_postal_code TEXT NOT NULL DEFAULT '',
        primary_address_complement TEXT NOT NULL DEFAULT '',
        additional_travelers JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS site_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS site_closures (
        id SERIAL PRIMARY KEY,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (end_date >= start_date)
      );
      CREATE INDEX IF NOT EXISTS site_closures_dates_idx
        ON site_closures (start_date, end_date);
      CREATE TABLE IF NOT EXISTS booking_testimonials (
        id SERIAL PRIMARY KEY,
        booking_id INT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
        invitation_token_hash TEXT UNIQUE,
        invitation_sent_at TIMESTAMPTZ,
        submitted_at TIMESTAMPTZ,
        display_name TEXT,
        rating INT CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
        message TEXT,
        travel_type TEXT,
        travel_type_other TEXT,
        publication_consent_at TIMESTAMPTZ,
        is_approved BOOLEAN NOT NULL DEFAULT FALSE,
        moderated_at TIMESTAMPTZ,
        CHECK (
          submitted_at IS NULL OR
          (display_name IS NOT NULL AND rating IS NOT NULL AND message IS NOT NULL AND travel_type IS NOT NULL)
        )
      );
      ALTER TABLE booking_testimonials
        ADD COLUMN IF NOT EXISTS publication_consent_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS booking_testimonials_public_idx
        ON booking_testimonials (moderated_at DESC, submitted_at DESC)
        WHERE submitted_at IS NOT NULL AND is_approved = TRUE;
      CREATE TABLE IF NOT EXISTS contact_messages (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
        email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
        phone TEXT NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
        subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 120),
        message JSONB NOT NULL CHECK (jsonb_typeof(message) = 'array'),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'responded')),
        privacy_accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
      CREATE INDEX IF NOT EXISTS contact_messages_created_at_idx
        ON contact_messages (created_at DESC);
      CREATE INDEX IF NOT EXISTS contact_messages_status_created_at_idx
        ON contact_messages (status, created_at DESC);
      DO $migration$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'bookings'
             AND column_name = 'precheckin_token_hash'
        ) THEN
          EXECUTE $copy$
            INSERT INTO pre_checkings (
              booking_id, room_id, token_hash, token_expires_at, completed_at,
              identity_document, phone_mobile, email, first_name, first_surname,
              second_surname, sex, nationality, birth_date, home_address, home_city,
              home_country, document_type, document_support_number, document_issue_date,
              document_expiry_date, phone_landline, traveler_count, minor_relationships,
              arrival_time, departure_time, preferred_bed, terms_accepted_at,
              marketing_consent, marketing_consent_at, signature, document_front_path,
              document_back_path
            )
            SELECT
              id, room_id, precheckin_token_hash, precheckin_token_expires_at,
              precheckin_completed_at, identity_document, phone, email,
              precheckin_first_name, precheckin_first_surname, precheckin_second_surname,
              precheckin_sex, nationality, birth_date, home_address, home_city,
              home_country, document_type, document_support_number, document_issue_date,
              document_expiry_date, phone_landline, traveler_count, minor_relationships,
              arrival_time, departure_time, preferred_bed, terms_accepted_at,
              marketing_consent, marketing_consent_at, precheckin_signature,
              precheckin_document_front_path, precheckin_document_back_path
            FROM bookings
            ON CONFLICT (booking_id) DO NOTHING
          $copy$;
        END IF;
      END
      $migration$;
      ALTER TABLE bookings
        DROP COLUMN IF EXISTS precheckin_token_hash,
        DROP COLUMN IF EXISTS precheckin_token_expires_at,
        DROP COLUMN IF EXISTS precheckin_completed_at,
        DROP COLUMN IF EXISTS precheckin_first_name,
        DROP COLUMN IF EXISTS precheckin_first_surname,
        DROP COLUMN IF EXISTS precheckin_second_surname,
        DROP COLUMN IF EXISTS precheckin_sex,
        DROP COLUMN IF EXISTS nationality,
        DROP COLUMN IF EXISTS birth_date,
        DROP COLUMN IF EXISTS home_address,
        DROP COLUMN IF EXISTS home_city,
        DROP COLUMN IF EXISTS home_country,
        DROP COLUMN IF EXISTS document_type,
        DROP COLUMN IF EXISTS document_support_number,
        DROP COLUMN IF EXISTS document_issue_date,
        DROP COLUMN IF EXISTS document_expiry_date,
        DROP COLUMN IF EXISTS phone_landline,
        DROP COLUMN IF EXISTS traveler_count,
        DROP COLUMN IF EXISTS minor_relationships,
        DROP COLUMN IF EXISTS arrival_time,
        DROP COLUMN IF EXISTS departure_time,
        DROP COLUMN IF EXISTS preferred_floor,
        DROP COLUMN IF EXISTS preferred_view,
        DROP COLUMN IF EXISTS preferred_bed,
        DROP COLUMN IF EXISTS parking,
        DROP COLUMN IF EXISTS payment_method,
        DROP COLUMN IF EXISTS terms_accepted_at,
        DROP COLUMN IF EXISTS marketing_consent,
        DROP COLUMN IF EXISTS marketing_consent_at,
        DROP COLUMN IF EXISTS precheckin_signature,
        DROP COLUMN IF EXISTS precheckin_document_front_path,
        DROP COLUMN IF EXISTS precheckin_document_back_path;
    `);
    await pool.query(await readFile(gallerySchemaPath, "utf8"));
    await pool.query(
        `UPDATE site_settings
            SET setting_value = $2, updated_at = now()
          WHERE setting_key = $1 AND setting_value = $3`,
        [
          "privacy_policy_content",
          siteSettingDefaults.privacy_policy_content,
          "Información pendiente de completar por el hotel.",
        ],
    );
    await pool.query(
        `UPDATE site_settings
            SET setting_value = $2, updated_at = now()
          WHERE setting_key = $1 AND setting_value = $3`,
        [
          "legal_notice_content",
          siteSettingDefaults.legal_notice_content,
          "Información pendiente de completar por el hotel.",
        ],
    );
    await pool.query(
        `UPDATE site_settings
            SET setting_value = $2, updated_at = now()
          WHERE setting_key = $1 AND setting_value = $3`,
        [
          "cookies_policy_content",
          siteSettingDefaults.cookies_policy_content,
          "Este sitio no utiliza cookies de análisis ni publicidad. Guarda en el almacenamiento local del navegador la preferencia del aviso de cookies durante 6 meses para no volver a mostrarlo. El acceso de administración puede emplear cookies técnicas necesarias para mantener la sesión.",
        ],
    );
    for (const [key, value] of Object.entries(siteSettingDefaults)) {
      await pool.query(
        `INSERT INTO site_settings (setting_key, setting_value)
       VALUES ($1, $2)
       ON CONFLICT (setting_key) DO NOTHING`,
        [key, value],
      );
    }
    await pool.query(
      `DELETE FROM site_settings
      WHERE setting_key IN ('intro_image_url', 'experience_image_url')`,
    );
    const {rows: bookingsWithoutReference} = await pool.query(
      "SELECT id FROM bookings WHERE reservation_code IS NULL",
    );
    for (const booking of bookingsWithoutReference) {
      await pool.query(
        "UPDATE bookings SET reservation_code = $1 WHERE id = $2",
        [newReservationCode(), booking.id],
      );
    }
    const {rows: bookingsWithoutPin} = await pool.query(
      "SELECT id FROM bookings WHERE arrival_pin IS NULL",
    );
    for (const booking of bookingsWithoutPin) {
      await pool.query("UPDATE bookings SET arrival_pin = $1 WHERE id = $2", [
        String(randomInt(0, 1_000_000)).padStart(6, "0"),
        booking.id,
      ]);
    }
    await pool.query(`
      ALTER TABLE bookings ALTER COLUMN reservation_code SET NOT NULL;
      ALTER TABLE bookings ALTER COLUMN room_subtotal SET NOT NULL;
      ALTER TABLE bookings ALTER COLUMN breakfast_total SET NOT NULL;
      ALTER TABLE bookings ALTER COLUMN pets_total SET NOT NULL;
      ALTER TABLE bookings ALTER COLUMN arrival_pin SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS bookings_reservation_code_key ON bookings (reservation_code);
    `);
    const {rows: bookingsWithoutVat} = await pool.query(
      `SELECT id, check_in, check_out, total::float8 AS total,
              room_subtotal::float8 AS room_subtotal,
              breakfast_total::float8 AS breakfast_total, pets_total::float8 AS pets_total,
              discount_amount::float8 AS discount_amount, vat_breakdown
         FROM bookings
        WHERE vat_breakdown IS NULL OR vat_breakdown = '[]'::jsonb`,
    );
    for (const booking of bookingsWithoutVat) {
      const {pricing, discountAmount} = normalizeLegacyVatAmounts({
        total: booking.total,
        roomSubtotal: booking.room_subtotal,
        breakfastTotal: booking.breakfast_total,
        petsTotal: booking.pets_total,
        discountAmount: booking.discount_amount,
      });
      const vatBreakdown = await calculateStoredVat(
        pool,
        booking.check_in,
        booking.check_out,
        pricing,
        discountAmount,
      );
      await pool.query(
        "UPDATE bookings SET vat_breakdown = $2::jsonb WHERE id = $1",
        [booking.id, JSON.stringify(vatBreakdown)],
      );
    }
    await ensureBootstrapAdministrator();
    if (!isAdminJwtConfigured()) {
      console.warn(
        "ADMIN_JWT_SECRET no está configurado o tiene menos de 32 bytes; el login de administración está deshabilitado.",
      );
    }
  } catch (error) {
    console.error("No se pudo actualizar el esquema de reservas.", error);
    process.exitCode = 1;
    return;
  }

  app.listen(Number(BACKEND_PORT), "0.0.0.0", () =>
    console.log(`Backend escuchando en el puerto ${BACKEND_PORT}`),
  );
  cron.schedule(
    "00 10 * * *",
    () => {
      sendDailyTestimonialInvitations().catch((error) =>
        console.error(
          "No se pudieron enviar las invitaciones a opinar.",
          error,
        ),
      );
    },
    {timezone: "Europe/Madrid"},
  );
  console.log("Invitaciones de testimonios programadas cada día a las 09:00.");
}

start();
