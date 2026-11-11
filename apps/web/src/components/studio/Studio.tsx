import { Columns2, Download, Expand, Loader2, Minimize2, ScanFace } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useReanalyzeFaces, useReprocess } from '../../lib/social';
import { VERSIONS, fmtBytes, urlFor, variantFor, versionOf, type VersionId } from '../../lib/studio';
import { isProcessing, type FaceBox, type Post } from '../../lib/types';
import { Button } from '../ui/Button';
import { LogoMark } from '../ui/Logo';
import { Modal } from '../ui/Modal';
import { Compare } from './Compare';
import { FaceOverlay } from './FaceOverlay';
import { ProcessingPanel } from './ProcessingPanel';

const alt = (post: Post, label: string) => `${label}: ${post.caption ? post.caption.slice(0, 100) : `fotografía de ${post.author.displayName}`}`;

function Stage({ post, sel, compare, immersive, faces }: { post: Post; sel: VersionId; compare: boolean; immersive: boolean; faces: FaceBox[] | null }) {
  const ratio = post.photo.width / post.photo.height;
  const maxH = immersive ? 70 : 76;
  const original = urlFor(post, 'original');
  const chosen = urlFor(post, sel);
  return (
    <div className="grid place-items-center bg-bg px-0 py-0 sm:py-4">
      <div className="relative overflow-hidden sm:rounded-md" style={{ aspectRatio: `${post.photo.width} / ${post.photo.height}`, width: `min(100%, ${ratio * maxH}dvh)` }}>
        {compare && original && chosen ? (
          <Compare before={original} after={chosen} beforeLabel="Original" afterLabel={versionOf(sel).label} alt={alt(post, 'Original')} />
        ) : (
          // Todas las versiones apiladas: el cambio es un fundido instantáneo, sin esperar descargas
          VERSIONS.map((v) => {
            const u = urlFor(post, v.id);
            return u ? <img key={v.id} src={u} alt={sel === v.id ? alt(post, v.label) : ''} aria-hidden={sel !== v.id} draggable={false} loading={v.id === 'original' || sel === v.id ? 'eager' : 'lazy'} className={`absolute inset-0 size-full object-contain transition-opacity duration-300 ${sel === v.id ? 'opacity-100' : 'opacity-0'}`} /> : null;
          })
        )}
        {faces && faces.length > 0 && <FaceOverlay boxes={faces} />}
      </div>
    </div>
  );
}

function FaceSummary({ post }: { post: Post }) {
  const re = useReanalyzeFaces(post.id);
  const { status, count } = post.faces;
  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:mx-6" role="status" aria-live="polite" data-testid="face-summary">
      <ScanFace className="size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
      {status === 'pending' && <span className="flex items-center gap-2 text-ink-2"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Analizando rostros…</span>}
      {status === 'failed' && (
        <>
          <span className="text-ink-2">No se pudo analizar los rostros de esta fotografía.</span>
          {post.isOwner && <Button size="sm" variant="secondary" loading={re.isPending} onClick={() => re.mutate()}>Reintentar análisis</Button>}
        </>
      )}
      {status === 'done' && <span className="font-medium">{count === 0 ? 'No se detectaron rostros' : count === 1 ? '1 rostro detectado' : `${count} rostros detectados`}</span>}
      {status === 'done' && count > 0 && <span className="text-xs text-ink-2">Solo localización: LUMENZA no identifica personas ni guarda plantillas biométricas.</span>}
    </div>
  );
}

function Selector({ post, sel, onSelect }: { post: Post; sel: VersionId; onSelect: (v: VersionId) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const busy = isProcessing(post);
  const move = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    for (let k = 1; k <= VERSIONS.length; k++) {
      const n = VERSIONS[(i + d * k + VERSIONS.length * 4) % VERSIONS.length]!;
      if (urlFor(post, n.id)) { onSelect(n.id); refs.current[n.id]?.focus(); return; }
    }
  };
  return (
    <div role="radiogroup" aria-label="Versiones de la fotografía" className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {VERSIONS.map((v, i) => {
        const u = urlFor(post, v.id);
        const on = sel === v.id;
        return (
          <button
            key={v.id}
            ref={(el) => { refs.current[v.id] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={!u}
            onClick={() => onSelect(v.id)}
            onKeyDown={(e) => move(e, i)}
            className={`group flex flex-col gap-2 rounded-md border p-1.5 text-left transition-[border-color,box-shadow,background] duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'border-accent bg-surface-2 shadow-[var(--glow)]' : 'border-line hover:border-accent/60'}`}
          >
            <span className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-sm bg-surface-2">
              {u ? <img src={u} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-110" loading="lazy" draggable={false} />
                : busy ? <span className="absolute inset-0 grid animate-pulse place-items-center"><Loader2 className="size-4 animate-spin text-ink-2" /></span> : null}
            </span>
            <span className="min-w-0 px-1 pb-1">
              <span className="block text-sm font-medium leading-tight">{v.label}</span>
              <span className="block text-xs text-ink-2">{u ? v.tag : busy ? 'Generando…' : 'No disponible'}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Info({ post, sel }: { post: Post; sel: VersionId }) {
  const v = versionOf(sel);
  const variant = variantFor(post, sel);
  const rows: [string, string][] = sel === 'original'
    ? [['Dimensiones', `${post.photo.width} × ${post.photo.height} px`], ['Archivo', `${post.photo.mime.replace('image/', '').toUpperCase()} · ${fmtBytes(post.photo.bytes)}`]]
    : variant ? [['Dimensiones', `${variant.width} × ${variant.height} px`], ['Archivo', `WEBP q${String(variant.params.quality ?? '')} · ${fmtBytes(variant.bytes)}`], ['Receta', String(variant.params.recipe ?? '—')]] : [];
  const canDownload = post.isOwner || post.allowDownload;
  const href = `/api/media/photo/${post.photo.id}/${sel === 'original' ? 'original' : sel}?download=1`;
  return (
    <div className="grid gap-5 sm:grid-cols-[1.3fr_1fr]" aria-live="polite">
      <div key={sel} className="rise">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-accent-soft">{v.tag}</p>
        <h3 className="font-display mt-1 text-2xl font-light">{v.label}</h3>
        <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-ink-2">{v.blurb}</p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">{v.details.map((d) => <li key={d} className="before:mr-2 before:text-accent before:content-['·']">{d}</li>)}</ul>
      </div>
      <div className="flex flex-col gap-3">
        <dl className="grid gap-1.5 text-sm">
          {rows.map(([k, val]) => (<div key={k} className="flex justify-between gap-4 border-b border-line pb-1.5"><dt className="text-ink-2">{k}</dt><dd className="text-right font-medium tabular-nums">{val}</dd></div>))}
        </dl>
        {canDownload ? (
          <a href={href} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-surface-2 px-4 text-sm font-medium transition-[border-color,box-shadow] duration-200 hover:border-accent hover:shadow-[var(--glow)]">
            <Download className="size-4" /> Descargar {sel === 'original' ? 'original' : v.label.toLowerCase()}
          </a>
        ) : (
          <p className="text-xs text-ink-2">El autor no ha permitido descargas de esta fotografía.</p>
        )}
      </div>
    </div>
  );
}

function Body({ post, immersive, onToggle }: { post: Post; immersive: boolean; onToggle: () => void }) {
  const [sel, setSel] = useState<VersionId>('original');
  const [compare, setCompare] = useState(false);
  // Preferencia del visitante (solo en su navegador): mostrar u ocultar los recuadros
  const [showFaces, setShowFaces] = useState(() => { try { return localStorage.getItem('lumenza-faces') !== 'off'; } catch { return true; } });
  const toggleFaces = () => setShowFaces((v) => { try { localStorage.setItem('lumenza-faces', v ? 'off' : 'on'); } catch { /* sin almacenamiento */ } return !v; });
  const faceCount = post.faces.status === 'done' ? post.faces.count : 0;
  const retry = useReprocess(post.id);
  const partial = post.processing.status === 'partial';
  const canCompare = sel !== 'original' && Boolean(urlFor(post, sel));

  if (post.processing.status !== 'ready' && !partial) return <ProcessingPanel post={post} />;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 pb-3 pt-4 sm:px-6">
        <LogoMark size={20} />
        <h2 className="text-xs font-medium uppercase tracking-[0.28em] text-ink-2 max-[400px]:tracking-[0.18em]">LUMENZA Studio</h2>
        <div className="ml-auto flex flex-wrap justify-end gap-1.5">
          <Button variant={showFaces && faceCount > 0 ? 'primary' : 'secondary'} size="sm" aria-pressed={showFaces && faceCount > 0} disabled={faceCount === 0} title={faceCount > 0 ? 'Mostrar u ocultar los recuadros de rostros' : post.faces.status === 'pending' ? 'Analizando rostros…' : 'No hay rostros que mostrar'} icon={<ScanFace className="size-4" />} onClick={toggleFaces}>Rostros{faceCount > 0 ? <span className="tabular-nums"> {faceCount}</span> : null}</Button>
          <Button variant={compare && canCompare ? 'primary' : 'secondary'} size="sm" aria-pressed={compare && canCompare} disabled={!canCompare} title={canCompare ? 'Comparar con el original' : 'Elige una transformación para comparar'} icon={<Columns2 className="size-4" />} onClick={() => setCompare((c) => !c)}>Comparar</Button>
          <Button variant="secondary" size="sm" aria-label={immersive ? 'Salir de pantalla completa' : 'Abrir en pantalla completa'} icon={immersive ? <Minimize2 className="size-4" /> : <Expand className="size-4" />} onClick={onToggle}><span className="max-sm:sr-only">{immersive ? 'Cerrar' : 'Pantalla completa'}</span></Button>
        </div>
      </div>
      <Stage post={post} sel={sel} compare={compare && canCompare} immersive={immersive} faces={showFaces && faceCount > 0 ? post.faces.boxes : null} />
      <FaceSummary post={post} />
      {partial && (
        <div role="status" className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2 px-3.5 py-2.5 text-sm sm:mx-6">
          <span className="min-w-0 flex-1 text-ink-2">Algunas versiones no se pudieron generar{post.processing.error ? ` (${post.processing.error})` : ''}. Las disponibles funcionan con normalidad.</span>
          {post.isOwner && <Button size="sm" variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}>Reintentar</Button>}
        </div>
      )}
      <div className="space-y-5 px-4 pb-5 pt-4 sm:px-6">
        <Selector post={post} sel={sel} onSelect={(v) => { setSel(v); if (v === 'original') setCompare(false); }} />
        <Info post={post} sel={sel} />
      </div>
    </>
  );
}

/** LUMENZA Studio: fotografía principal, selector de versiones reales, comparador y ficha técnica; integrado en el detalle. */
export function Studio({ post }: { post: Post }) {
  const [immersive, setImmersive] = useState(false);
  return (
    <section id="studio" aria-label="LUMENZA Studio" className="scroll-mt-4">
      <Body post={post} immersive={false} onToggle={() => setImmersive(true)} />
      {immersive && (
        <Modal title="LUMENZA Studio" full onClose={() => setImmersive(false)}>
          <Body post={post} immersive onToggle={() => setImmersive(false)} />
        </Modal>
      )}
    </section>
  );
}
