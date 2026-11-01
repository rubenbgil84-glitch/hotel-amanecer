CREATE TABLE IF NOT EXISTS gallery_albums (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 3000),
  allow_comments BOOLEAN NOT NULL DEFAULT FALSE,
  allow_uploads BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gallery_photos (
  id BIGSERIAL PRIMARY KEY,
  album_id BIGINT NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
  object_path TEXT NOT NULL UNIQUE,
  image_url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '' CHECK (char_length(caption) <= 240),
  submitted_by TEXT NOT NULL DEFAULT '' CHECK (char_length(submitted_by) <= 80),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  moderated_at TIMESTAMPTZ,
  moderated_by INTEGER REFERENCES administradores(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS gallery_photos_album_status_created_idx
  ON gallery_photos (album_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS gallery_comments (
  id BIGSERIAL PRIMARY KEY,
  album_id BIGINT NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 80),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 2 AND 1500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  moderated_at TIMESTAMPTZ,
  moderated_by INTEGER REFERENCES administradores(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS gallery_comments_album_status_created_idx
  ON gallery_comments (album_id, status, created_at DESC);

ALTER TABLE gallery_albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_comments ENABLE ROW LEVEL SECURITY;
