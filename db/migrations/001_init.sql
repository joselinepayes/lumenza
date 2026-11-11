-- LUMENZA esquema inicial. Las imágenes NUNCA se guardan en la BD: solo claves de almacenamiento y metadatos.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE post_visibility AS ENUM ('public', 'followers', 'private');
CREATE TYPE post_category AS ENUM ('naturaleza','arquitectura','retratos','viajes','arte','urbana','gastronomia');
CREATE TYPE processing_status AS ENUM ('pending','processing','ready','partial','failed');
CREATE TYPE variant_kind AS ENUM ('thumbnail','bw_editorial','sepia_cinema','lumen_tone');
CREATE TYPE notification_type AS ENUM ('follow','like','comment','system');
CREATE TYPE email_token_purpose AS ENUM ('verify_email','reset_password');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  username citext NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.]{3,30}$'),
  password_hash text,                       -- Argon2id (sal embebida); NULL si solo Google
  google_sub text UNIQUE,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);

CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 300),
  avatar_key text,
  cover_key text,
  is_private boolean NOT NULL DEFAULT false,
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark')),
  notif_prefs jsonb NOT NULL DEFAULT '{"follow":true,"like":true,"comment":true}'
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,          -- SHA-256 del token opaco
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE email_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose email_token_purpose NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 2200),
  category post_category,
  visibility post_visibility NOT NULL DEFAULT 'public',
  allow_download boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_author_created_idx ON posts(author_id, created_at DESC);
CREATE INDEX posts_created_idx ON posts(created_at DESC, id DESC);
CREATE INDEX posts_category_idx ON posts(category, created_at DESC);
CREATE INDEX posts_caption_trgm_idx ON posts USING gin (caption gin_trgm_ops);

-- Ubicación de la fotografía en la nube (requisito: BD con fotografías y sus ubicaciones)
CREATE TABLE photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  storage_provider text NOT NULL CHECK (storage_provider IN ('s3','local')),
  bucket text NOT NULL,
  storage_key text NOT NULL,
  region text,
  mime text NOT NULL,
  width int NOT NULL,
  height int NOT NULL,
  bytes bigint NOT NULL,
  sha256 char(64) NOT NULL,
  status processing_status NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  faces jsonb NOT NULL DEFAULT '[]',       -- solo cuadros delimitadores, sin descriptores biométricos
  faces_analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, storage_key)
);

CREATE TABLE photo_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  kind variant_kind NOT NULL,
  bucket text NOT NULL,
  storage_key text NOT NULL,
  mime text NOT NULL,
  width int NOT NULL,
  height int NOT NULL,
  bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (photo_id, kind),
  UNIQUE (bucket, storage_key)
);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_post_idx ON comments(post_id, created_at);

CREATE TABLE likes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX likes_post_idx ON likes(post_id);

CREATE TABLE saves (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows(followee_id);

CREATE TABLE hashtags (
  id serial PRIMARY KEY,
  tag citext NOT NULL UNIQUE CHECK (tag ~ '^[[:alnum:]_]{1,50}$')
);
CREATE TABLE post_hashtags (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  hashtag_id int NOT NULL REFERENCES hashtags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, hashtag_id)
);
CREATE INDEX post_hashtags_tag_idx ON post_hashtags(hashtag_id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  ip inet,
  meta jsonb NOT NULL DEFAULT '{}',        -- nunca contraseñas ni tokens
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_user_idx ON audit_log(user_id, created_at DESC);
