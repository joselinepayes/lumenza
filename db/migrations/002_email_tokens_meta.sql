-- Metadatos para tokens de correo: control de reenvío (cooldown) y trazabilidad.
ALTER TABLE email_tokens ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE email_tokens ADD COLUMN ip inet;
CREATE INDEX email_tokens_user_purpose_idx ON email_tokens(user_id, purpose, created_at DESC);
