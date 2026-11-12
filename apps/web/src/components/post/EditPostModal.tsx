import { Globe2, Lock, Users } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { useUpdatePost } from '../../lib/social';
import { CATEGORIES, type Post } from '../../lib/types';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Feedback';
import { Modal } from '../ui/Modal';

const field = 'w-full rounded-md border border-line bg-surface px-3.5 text-ink placeholder:text-ink-2/70 transition-colors focus:border-accent focus:outline-none focus:shadow-[var(--glow)]';
const VIS = [
  { id: 'public', label: 'Pública', hint: 'la ve cualquier persona', icon: Globe2 },
  { id: 'followers', label: 'Seguidores', hint: 'solo quienes te siguen', icon: Users },
  { id: 'private', label: 'Solo tú', hint: 'nadie más', icon: Lock },
] as const;
const COVERS = [
  { id: '', label: 'Estándar (sin filtro)' },
  { id: 'bw_editorial', label: 'Blanco y negro editorial' },
  { id: 'sepia_cinema', label: 'Sepia Cinema' },
  { id: 'lumen_tone', label: 'Tono LUMENZA' },
];

/** Edición de una publicación propia. Las versiones/filtros de la foto son una decisión de quien publica. */
export function EditPostModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const upd = useUpdatePost(post.id);
  const toast = useToast();
  const [caption, setCaption] = useState(post.caption);
  const [tags, setTags] = useState(post.tags.map((t) => `#${t}`).join(' '));
  const [category, setCategory] = useState(post.category ?? '');
  const [visibility, setVisibility] = useState(post.visibility);
  const [allowDownload, setAllowDownload] = useState(post.allowDownload);
  const [cover, setCover] = useState(post.coverVariant ?? '');
  const available = new Set(post.variants.map((v) => v.kind));

  const save = () =>
    upd.mutate(
      { caption, tags, category: category || null, visibility, allowDownload, coverVariant: cover || null },
      { onSuccess: () => { toast('Publicación actualizada'); onClose(); } },
    );

  return (
    <Modal title="Editar publicación" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4 p-5">
        <div>
          <label htmlFor="ed-caption" className="mb-1.5 block text-sm font-medium">Descripción</label>
          <textarea id="ed-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={4} className={`${field} resize-none py-2.5`} />
        </div>
        <div>
          <label htmlFor="ed-tags" className="mb-1.5 block text-sm font-medium">Etiquetas</label>
          <input id="ed-tags" value={tags} onChange={(e) => setTags(e.target.value)} className={`${field} h-11`} placeholder="luz, montaña, atardecer" />
          <p className="mt-1 text-xs text-ink-2">Separadas por espacios o comas (máx. 10).</p>
        </div>
        <div>
          <label htmlFor="ed-cat" className="mb-1.5 block text-sm font-medium">Categoría</label>
          <select id="ed-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={`${field} h-11`}>
            <option value="">Sin categoría</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ed-cover" className="mb-1.5 block text-sm font-medium">Versión que se muestra en el inicio</label>
          <select id="ed-cover" value={cover} onChange={(e) => setCover(e.target.value)} className={`${field} h-11`}>
            {COVERS.map((c) => <option key={c.id} value={c.id} disabled={c.id !== '' && !available.has(c.id)}>{c.label}{c.id !== '' && !available.has(c.id) ? ' (no disponible)' : ''}</option>)}
          </select>
          <p className="mt-1 text-xs text-ink-2">Las demás versiones siguen disponibles en LUMENZA Studio al abrir la publicación.</p>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Visibilidad</legend>
          <div className="grid gap-2">
            {VIS.map(({ id, label, hint, icon: Icon }) => (
              <label key={id} className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors ${visibility === id ? 'border-accent bg-surface-2' : 'border-line hover:border-accent/60'}`}>
                <input type="radio" name="ed-vis" value={id} checked={visibility === id} onChange={() => setVisibility(id)} className="sr-only" />
                <Icon className="size-4 shrink-0 text-accent" aria-hidden />
                <span className="text-sm"><span className="font-medium">{label}</span> <span className="text-ink-2">· {hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Permitir descargar la fotografía original
        </label>
        {upd.error && <p role="alert" className="text-sm text-danger">{upd.error instanceof ApiError ? upd.error.message : 'No se pudo guardar'}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={upd.isPending}>Guardar cambios</Button></div>
      </form>
    </Modal>
  );
}
