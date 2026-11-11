-- MFA TOTP (RFC 6238). Secretos cifrados (AES-256-GCM, clave MFA_ENCRYPTION_KEY separada de SESSION_SECRET);
-- códigos de recuperación solo como HMAC; desafíos de login de un solo uso con intentos acotados.
CREATE TABLE user_mfa (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc text NOT NULL,                  -- v1.<iv>.<tag>.<ciphertext> (base64url); nunca en claro
  pending boolean NOT NULL DEFAULT true,     -- true hasta confirmar con un código válido
  enabled_at timestamptz,
  last_used_step bigint,                     -- anti-reutilización: paso TOTP más reciente aceptado
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,                   -- HMAC-SHA256 con clave derivada; no se guarda el código
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);

CREATE TABLE mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,           -- SHA-256 del token opaco (cookie HttpOnly lz_mfa)
  source text NOT NULL CHECK (source IN ('password','google')),
  ip inet,
  attempts smallint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_challenges_user_idx ON mfa_challenges(user_id, created_at DESC);

-- Alcance de sesión: 'mfa_setup' = solo puede enrolar MFA (administradores sin MFA)
ALTER TABLE sessions ADD COLUMN scope text NOT NULL DEFAULT 'full' CHECK (scope IN ('full','mfa_setup'));
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;
CREATE INDEX audit_action_idx ON audit_log(user_id, action, created_at DESC);
