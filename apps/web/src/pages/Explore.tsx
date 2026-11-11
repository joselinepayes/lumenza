import { Hash, Search, SearchX, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PhotoImage } from '../components/post/PhotoImage';
import { UserRow } from '../components/layout/SuggestionsPanel';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { InfiniteSentinel } from '../components/ui/Infinite';
import { flat, useExplore, useFeatured, useSearchTags, useSearchUsers } from '../lib/social';
import { CATEGORIES, type Post } from '../lib/types';

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

function Tile({ p, large = false }: { p: Post; large?: boolean }) {
  return (
    <Link to={`/p/${p.id}`} className="group relative mb-3 block break-inside-avoid overflow-hidden rounded-lg border border-line" aria-label={`Fotografía de ${p.author.displayName}${p.caption ? `: ${p.caption.slice(0, 80)}` : ''}`}>
      <PhotoImage src={large ? p.photo.displayUrl : p.photo.thumbUrl} width={p.photo.width} height={p.photo.height} alt="" className="transition-transform duration-300 ease-out group-hover:scale-[1.03]" />
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-8 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="truncate">@{p.author.username}</span><span>{p.likeCount} me gusta</span>
      </span>
    </Link>
  );
}

const Masonry = ({ posts }: { posts: Post[] }) => <div className="columns-2 gap-3 md:columns-3">{posts.map((p) => <Tile key={p.id} p={p} />)}</div>;
const MasonrySkeleton = () => (
  <div className="columns-2 gap-3 md:columns-3" aria-hidden="true">{[5, 7, 4, 6, 8, 5].map((h, i) => <Skeleton key={i} className="mb-3 break-inside-avoid" style={{ height: h * 36 }} />)}</div>
);

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const cat = params.get('cat') ?? undefined;
  const tag = params.get('tag') ?? undefined;
  const urlQ = params.get('q') ?? '';
  const [text, setText] = useState(urlQ);
  const dq = useDebounced(text.trim());
  const [tab, setTab] = useState<'fotos' | 'usuarios' | 'hashtags'>('fotos');

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (dq) next.set('q', dq); else next.delete('q');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = dq.startsWith('#') ? { tag: dq.slice(1).toLowerCase() || undefined } : { q: dq || undefined };
  const filters = { category: cat, tag: tag ?? search.tag, q: 'q' in search ? search.q : undefined };
  const photos = useExplore(filters);
  const featured = useFeatured();
  const users = useSearchUsers(tab === 'usuarios' ? dq.replace(/^#/, '') : '');
  const tags = useSearchTags(tab === 'hashtags' ? dq.replace(/^#/, '') : '');
  const list = flat(photos.data);
  const hasFilter = Boolean(cat || filters.tag || filters.q);
  const more = useCallback(() => photos.fetchNextPage(), [photos]);

  const setCat = (c?: string) => {
    const next = new URLSearchParams(params);
    if (c) next.set('cat', c); else next.delete('cat');
    next.delete('tag');
    setParams(next);
  };

  return (
    <div className="px-4 pt-4 sm:px-0 sm:pt-0">
      <h1 className="font-display text-4xl font-light tracking-tight">Explorar</h1>
      <p className="mb-5 mt-1 text-ink-2">Descubre fotografías, personas y etiquetas.</p>

      <div className="relative">
        <label htmlFor="q" className="sr-only">Buscar</label>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
        <input id="q" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar fotos, personas o #etiquetas" className="h-11 w-full rounded-md border border-line bg-surface pl-10 pr-3 text-ink placeholder:text-ink-2/70 focus:border-accent focus:outline-none focus:shadow-[var(--glow)]" />
      </div>

      {dq && (
        <div role="tablist" aria-label="Tipo de resultado" className="mt-4 flex gap-1 border-b border-line">
          {([['fotos', 'Fotos'], ['usuarios', 'Personas'], ['hashtags', 'Etiquetas']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${tab === id ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}>{label}</button>
          ))}
        </div>
      )}

      {tab === 'fotos' || !dq ? (
        <>
          <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Categorías">
            {[{ id: undefined, label: 'Todas' }, ...CATEGORIES].map((c) => (
              <button key={c.label} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)} className={`shrink-0 rounded-md border px-3.5 py-1.5 text-sm transition-colors ${cat === c.id ? 'border-accent bg-surface-2 text-ink' : 'border-line text-ink-2 hover:border-accent/60 hover:text-ink'}`}>{c.label}</button>
            ))}
          </div>
          {filters.tag && <p className="mt-4 text-sm text-ink-2">Mostrando <span className="text-accent-soft">#{filters.tag}</span> · <button className="underline hover:text-ink" onClick={() => { const n = new URLSearchParams(params); n.delete('tag'); setText(''); setParams(n); }}>quitar</button></p>}

          {!hasFilter && featured.data && featured.data.items.length > 0 && (
            <section className="mt-6" aria-labelledby="dest">
              <h2 id="dest" className="mb-3 text-xs font-medium uppercase tracking-[0.22em] text-ink-2">Destacadas</h2>
              <div className="grid aspect-[3/2] grid-cols-3 grid-rows-2 gap-2 sm:gap-3">
                {featured.data.items.slice(0, 3).map((p, i) => (
                  <Link key={p.id} to={`/p/${p.id}`} className={`group relative overflow-hidden rounded-lg border border-line ${i === 0 ? 'col-span-2 row-span-2' : ''}`} aria-label={`Destacada de ${p.author.displayName}`}>
                    <PhotoImage fill src={p.photo.displayUrl} width={p.photo.width} height={p.photo.height} alt="" className="transition-transform duration-300 group-hover:scale-[1.03]" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <div className="mt-6">
            {photos.isPending ? <MasonrySkeleton />
              : photos.isError ? <ErrorState onRetry={() => photos.refetch()} />
              : list.length === 0 ? <EmptyState icon={SearchX} title="Sin resultados">{hasFilter ? 'No encontramos fotografías con esos criterios. Prueba otra categoría o búsqueda.' : 'Todavía no hay fotografías públicas. Sé la primera persona en publicar.'}</EmptyState>
              : (<><Masonry posts={list} /><InfiniteSentinel hasNext={Boolean(photos.hasNextPage)} loading={photos.isFetchingNextPage} error={photos.isFetchNextPageError} onMore={more} onRetry={() => photos.fetchNextPage()} /></>)}
          </div>
        </>
      ) : tab === 'usuarios' ? (
        <div className="mt-4">
          {users.isPending ? <Skeleton className="h-12" /> : users.data?.items.length ? <ul>{users.data.items.map((u) => <UserRow key={u.id} u={u} />)}</ul> : <EmptyState icon={Users} title="Sin personas">No encontramos a nadie con ese nombre.</EmptyState>}
        </div>
      ) : (
        <div className="mt-4">
          {tags.isPending ? <Skeleton className="h-12" /> : tags.data?.items.length ? (
            <ul>{tags.data.items.map((t) => (
              <li key={t.tag}><Link to={`/explorar?tag=${t.tag}`} onClick={() => { setText(''); setTab('fotos'); }} className="flex items-center gap-3 rounded-md px-2 py-3 hover:bg-surface-2"><span className="grid size-9 place-items-center rounded-full border border-line"><Hash className="size-4 text-accent" /></span><span className="font-medium">#{t.tag}</span><span className="ml-auto text-sm text-ink-2">{t.posts} {t.posts === 1 ? 'foto' : 'fotos'}</span></Link></li>
            ))}</ul>
          ) : <EmptyState icon={Hash} title="Sin etiquetas">No hay etiquetas que empiecen así.</EmptyState>}
        </div>
      )}
    </div>
  );
}
