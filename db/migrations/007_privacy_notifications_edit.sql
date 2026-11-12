-- Fase 6: perfiles privados (solicitudes de seguimiento), notificaciones ampliadas y edición de publicaciones.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'follow_request';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'follow_accepted';

CREATE TABLE IF NOT EXISTS follow_requests (
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id),
  CHECK (requester_id <> target_id)
);
CREATE INDEX IF NOT EXISTS follow_requests_target_idx ON follow_requests(target_id, created_at DESC);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS edited_at timestamptz;
-- Versión que el autor elige mostrar en el feed (NULL = fotografía de visualización estándar).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS cover_variant text CHECK (cover_variant IN ('bw_editorial','sepia_cinema','lumen_tone'));

CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC, id DESC);
