CREATE TABLE rooms (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT NOT NULL,
  price_per_night NUMERIC(8,2) NOT NULL CHECK (price_per_night > 0),
  pricing_type    TEXT NOT NULL DEFAULT 'standard' CHECK (pricing_type IN ('standard', 'rural_house')),
  catalog_category TEXT NOT NULL DEFAULT 'Habitación doble',
  single_price    NUMERIC(8,2) NOT NULL DEFAULT 30 CHECK (single_price >= 0),
  double_price    NUMERIC(8,2) NOT NULL DEFAULT 45 CHECK (double_price >= 0),
  extra_bed_price NUMERIC(8,2) NOT NULL DEFAULT 15 CHECK (extra_bed_price >= 0),
  capacity        INT NOT NULL CHECK (capacity > 0),
  features        JSONB NOT NULL DEFAULT '[]'::jsonb,
  image_url       TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE bookings (
  id          SERIAL PRIMARY KEY,
  room_id     INT NOT NULL REFERENCES rooms(id),
  guest_name  TEXT NOT NULL,
  email       TEXT NOT NULL,
  identity_document TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  check_in    DATE NOT NULL,
  check_out   DATE NOT NULL,
  adults      INT NOT NULL CHECK (adults BETWEEN 1 AND 13),
  children    INT NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 12),
  breakfast   BOOLEAN NOT NULL DEFAULT FALSE,
  pets        BOOLEAN NOT NULL DEFAULT FALSE,
  notes       TEXT NOT NULL DEFAULT '',
  total       NUMERIC(10,2) NOT NULL,
  room_subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  breakfast_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  pets_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  vat_breakdown JSONB,
  discount_code TEXT,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  arrival_pin TEXT NOT NULL,
  reservation_code TEXT NOT NULL UNIQUE,
  access_token_hash TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);

CREATE TABLE contact_messages (
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
CREATE INDEX contact_messages_created_at_idx ON contact_messages (created_at DESC);
CREATE INDEX contact_messages_status_created_at_idx ON contact_messages (status, created_at DESC);

CREATE TABLE vat_rates (
  id SERIAL PRIMARY KEY,
  effective_from DATE NOT NULL UNIQUE,
  rate NUMERIC(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO vat_rates (effective_from, rate)
VALUES ('1900-01-01', 10)
ON CONFLICT (effective_from) DO NOTHING;

CREATE TABLE discount_codes (
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

CREATE TABLE discount_code_excluded_dates (
  id SERIAL PRIMARY KEY,
  discount_code_id INT NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE TABLE booking_discount_redemptions (
  booking_id INT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  discount_code_id INT NOT NULL REFERENCES discount_codes(id) ON DELETE RESTRICT,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pre_checkings (
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
CREATE TABLE site_settings (
  setting_key   TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE site_closures (
  id SERIAL PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX site_closures_dates_idx ON site_closures (start_date, end_date);
CREATE TABLE booking_testimonials (
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
CREATE INDEX booking_testimonials_public_idx
  ON booking_testimonials (moderated_at DESC, submitted_at DESC)
  WHERE submitted_at IS NOT NULL AND is_approved = TRUE;
CREATE TABLE administradores (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE room_availability_blocks (
  id SERIAL PRIMARY KEY,
  room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date > start_date)
);
CREATE INDEX room_availability_blocks_dates
  ON room_availability_blocks (room_id, start_date, end_date);
CREATE UNIQUE INDEX administradores_username_lower_idx
  ON administradores (lower(username));
CREATE OR REPLACE FUNCTION update_administradores_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER administradores_updated_at_trigger
  BEFORE UPDATE ON administradores
  FOR EACH ROW EXECUTE FUNCTION update_administradores_updated_at();
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS identity_document TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS breakfast BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pets BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reservation_code TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS room_subtotal NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS breakfast_total NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pets_total NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS vat_breakdown JSONB;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS arrival_pin TEXT;
CREATE INDEX bookings_room_dates ON bookings (room_id, check_in, check_out);

INSERT INTO rooms (name, slug, description, price_per_night, capacity, features) VALUES
 ('Suite ejecutiva', 'suite-ejecutiva',
  'La habitación más amplia del hotel, con salón independiente y zona de trabajo junto a la ventana.',
  189.00, 4, '["Ropa de cama de algodón egipcio","Termostato individual","Bañera de hidromasaje"]'::jsonb),
 ('Habitación deluxe', 'habitacion-deluxe',
  'Cama king, baño con ducha de lluvia y mucha luz natural. Ideal para estancias de una semana.',
  129.00, 3, '["Wifi de alta velocidad","Toallas de sobra","Cocina pequeña (disponibilidad limitada)"]'::jsonb),
 ('Habitación clásica', 'habitacion-clasica',
  'Sencilla, silenciosa y con una cama muy cómoda. Da al patio interior.',
  89.00, 2, '["Cama doble o dos individuales","Teléfono","Secador de pelo"]'::jsonb);

INSERT INTO rooms
  (name, slug, description, price_per_night, pricing_type, catalog_category, single_price,
   double_price, extra_bed_price, capacity, features, image_url)
VALUES
  ('Casa Rural Paso Camino de Santiago', 'casa-rural',
   'Construcción centenaria rehabilitada, de arquitectura tradicional en adobe y madera. Tiene capacidad para alojar de 2 a 13 personas y cuenta con habitaciones dobles con baño, salón con chimenea, juegos de mesa y cocina totalmente equipada. Dispone de calefacción, agua caliente, patio-terraza, barbacoa, parking y los servicios del hotel.',
   90, 'rural_house', 'Casa rural', 30, 45, 15, 13,
   '["Habitaciones dobles con baño","Salón con chimenea","Juegos de mesa","Cocina totalmente equipada","Calefacción y agua caliente","Patio-terraza","Barbacoa","Parking","Servicios del hotel"]'::jsonb,
   '/api/web-images/casa-rural.webp')
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
       image_url = COALESCE(image_url, '/api/web-images/casa-rural.webp')
 WHERE slug = 'casa-rural';
