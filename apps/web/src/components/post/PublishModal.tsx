import { useQueryClient } from '@tanstack/react-query';
import { Globe2, ImagePlus, Lock, Users } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CATEGORIES, type Post } from '../../lib/types';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Feedback';
import { Modal } from '../ui/Modal';

const MAX = 15 * 1024 * 1024;
const OK = ['image/jpeg', 'image/png', 'image/webp'];
const vis = [
  { id: 'public', label: 'Pública', hint: 'Cualquier persona en LUMENZA', icon: Globe2 },
  { id: 'followers', label: 'Seguidores', hint: 'Solo quienes te siguen', icon: Users },
  { id: 'private', label: 'Solo yo', hint: 'Nadie más la verá', icon: Lock },
] as const;

/** Subida real con progreso (XHR) hacia POST /api/posts; el servidor valida por contenido. */
function upload(form: FormData, onProgress: (p: number) => void, signal: AbortSignal): Promise<Post> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/posts');
    x.withCredentials = true;
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let data: { post?: Post; error?: { message?: string } } = {};
      try { data = JSON.parse(x.responseText); } catch { /* respuesta no JSON */ }
      if (x.status >= 200 && x.status < 300 && data.post) resolve(data.post);
      else reject(new Error(data.error?.message ?? 'No se pudo publicar la fotografía'));
    };
    x.onerror = () => reject(new Error('No se pudo conectar con el servidor'));
    signal.addEventListener('abort', () => { x.abort(); reject(new DOMException('abort', 'AbortError')); });
    x.send(form);
  });
}

export function PublishModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [category, setCategory] = useState('');
  const [visibility, setVisibility] = useState<(typeof vis)[number]['id']>('public');
  const [allowDownload, setAllowDownload] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => abort.current?.abort(), []);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!OK.includes(f.type)) return setError('Formato no admitido. Usa JPEG, PNG o WebP.');
    if (f.size > MAX) return setError('La imagen supera el máximo de 15 MB.');
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); };

  const publish = async () => {
    if (!file) return;
    const f = new FormData();
    f.append('caption', caption);
    f.append('tags', tags);
    f.append('category', category);
    f.append('visibility', visibility);
    f.append('allowDownload', String(allowDownload));
    f.append('photo', file);
    setError(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const post = await upload(f, setProgress, abort.current.signal);
      await Promise.all(['feed', 'explore', 'user-posts', 'profile', 'featured', 'suggestions'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast('Publicada · generando tus versiones…');
      onClose();
      nav(`/p/${post.id}`);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setProgress(null);
      setError((e as Error).message);
    }
  };

  const busy = progress !== null;
  const field = 'w-full rounded-md border border-line bg-surface px-3.5 text-ink placeholder:text-ink-2/70 transition-colors focus:border-accent focus:outline-none focus:shadow-[var(--glow)]';

  return (
    <Modal title="Nueva publicación" onClose={() => (busy ? abort.current?.abort() || onClose() : onClose())} wide={Boolean(file)}>
      {!file ? (
        <div className="p-5">
          <label
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={drop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center transition-colors ${over ? 'border-accent bg-surface-2' : 'border-line hover:border-accent'}`}
          >
            <ImagePlus className="size-9 text-accent" strokeWidth={1.4} aria-hidden />
            <span className="font-display text-2xl font-light">Arrastra tu fotografía</span>
            <span className="text-sm text-ink-2">o selecciónala desde tu dispositivo · JPEG, PNG o WebP · hasta 15 MB</span>
            <input type="file" accept={OK.join(',')} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            <span className="mt-1 inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-on-accent">Elegir archivo</span>
          </label>
          {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
        </div>
      ) : (
        <div className="grid sm:grid-cols-[1.1fr_1fr]">
          <div className="grid place-items-center bg-bg p-4 sm:border-r sm:border-line">
            <img src={preview!} alt="Vista previa de la fotografía" className="max-h-[50dvh] w-auto max-w-full rounded-md object-contain sm:max-h-[60dvh]" />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); publish(); }} className="flex flex-col gap-4 p-5">
            <div>
              <label htmlFor="pub-caption" className="mb-1.5 block text-sm font-medium">Descripción</label>
              <textarea id="pub-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={3} disabled={busy} placeholder="Cuenta la historia detrás de la imagen…" className={`${field} resize-none py-2.5`} />
            </div>
            <div>
              <label htmlFor="pub-tags" className="mb-1.5 block text-sm font-medium">Etiquetas</label>
              <input id="pub-tags" value={tags} onChange={(e) => setTags(e.target.value)} disabled={busy} placeholder="luz, montaña, atardecer" className={`${field} h-11`} />
              <p className="mt-1 text-xs text-ink-2">Separadas por espacios o comas (máx. 10).</p>
            </div>
            <div>
              <label htmlFor="pub-cat" className="mb-1.5 block text-sm font-medium">Categoría</label>
              <select id="pub-cat" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy} className={`${field} h-11`}>
                <option value="">Sin categoría</option>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <fieldset disabled={busy}>
              <legend className="mb-1.5 text-sm font-medium">Visibilidad</legend>
              <div className="grid gap-2">
                {vis.map(({ id, label, hint, icon: Icon }) => (
                  <label key={id} className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors ${visibility === id ? 'border-accent bg-surface-2' : 'border-line hover:border-accent/60'}`}>
                    <input type="radio" name="vis" value={id} checked={visibility === id} onChange={() => setVisibility(id)} className="sr-only" />
                    <Icon className="size-4 shrink-0 text-accent" aria-hidden />
                    <span className="text-sm"><span className="font-medium">{label}</span> <span className="text-ink-2">· {hint}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} disabled={busy} className="size-4 accent-[var(--accent)]" />
              Permitir descargar la fotografía original
            </label>

            <p className="text-xs leading-relaxed text-ink-2">LUMENZA genera versiones de tu foto y detecta la <strong className="font-medium text-ink">posición</strong> de los rostros para mostrar recuadros. No identifica a nadie, no guarda plantillas biométricas ni infiere atributos, y no usa tu cámara.</p>

            {busy && (
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)} aria-label="Subiendo fotografía">
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(6, (progress ?? 0) * 100)}%` }} /></div>
                <p className="mt-1.5 text-xs text-ink-2">{(progress ?? 0) >= 1 ? 'Guardando en la nube…' : 'Subiendo…'}</p>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="mt-1 flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => { abort.current?.abort(); setFile(null); setPreview(null); setProgress(null); setError(null); }}>Cambiar foto</Button>
              <Button type="submit" loading={busy}>Publicar</Button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}
