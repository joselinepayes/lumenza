-- Pipeline de procesamiento asíncrono (Fase 4): progreso real, trazabilidad del worker y parámetros de cada transformación.
ALTER TABLE photos
  ADD COLUMN progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  ADD COLUMN stage text,
  ADD COLUMN sanitized boolean NOT NULL DEFAULT false,      -- el original ya fue re-codificado sin metadatos
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN processing_finished_at timestamptz,
  ADD COLUMN processed_by text,                             -- identificador del worker que terminó el trabajo
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE photo_variants ADD COLUMN params jsonb NOT NULL DEFAULT '{}';  -- receta aplicada (reproducibilidad)

-- Las fotos ya procesadas por la Fase 3 (sin transformaciones) se vuelven a encolar en el arranque del worker.
UPDATE photos SET sanitized = true WHERE status = 'ready';

CREATE INDEX photos_status_idx ON photos(status, updated_at) WHERE status IN ('pending','processing');
