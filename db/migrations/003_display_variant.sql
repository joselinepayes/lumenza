-- Variante de visualización (1440 px) para el feed y el detalle. Las transformaciones creativas llegan en la Fase 4.
ALTER TYPE variant_kind ADD VALUE IF NOT EXISTS 'display';
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS profiles_display_name_trgm_idx ON profiles USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_username_trgm_idx ON users USING gin ((username::text) gin_trgm_ops);
