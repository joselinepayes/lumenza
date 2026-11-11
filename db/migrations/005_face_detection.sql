-- Detección de rostros (Fase 5). Solo se guardan recuadros normalizados {x,y,w,h,score} en photos.faces (JSONB, ya existente).
-- NO se guardan landmarks, descriptores/plantillas biométricas, recortes de rostros ni atributos inferidos.
ALTER TABLE photos
  ADD COLUMN faces_status text NOT NULL DEFAULT 'pending' CHECK (faces_status IN ('pending','done','failed')),
  ADD COLUMN faces_model text;
CREATE INDEX photos_faces_pending_idx ON photos(updated_at) WHERE faces_status = 'pending' AND status = 'ready';
