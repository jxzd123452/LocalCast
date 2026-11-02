import { useEffect, useMemo, useState } from 'react';
import { deviceId, getJson, guestApi, uploadFile, wsUrl, type GuestState } from './api';
import { ClipboardPanel } from './clipboard';
import { formatBytes } from './format';
import { IconAudio, IconDownload, IconFile, IconFolder, IconImage, IconSearch, IconVideo, Mark } from './icons';
import { useI18n } from './i18n-context';
import { Lightbox } from './lightbox';
import { navigate, withSearch } from './location';
import { moveTvFocus } from './tv';
import type { Entry } from './types';

type Filter = 'all' | 'folders' | 'images' | 'videos' | 'audio' | 'docs';
type SortKey = 'name' | 'size' | 'modified' | 'kind';

export function GuestApp({ token, section }: { token: string; section: 'files' | 'album' | 'clipboard' }) {
  const { t, lang, setLang, theme, setTheme } = useI18n();
  const params = new URLSearchParams(location.search);
  const dir = params.get('dir') ?? '';
  const tv = params.get('tv') === '1';
  const [state, setState] = useState<GuestState | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [images, setImages] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [preview, setPreview] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [hot, setHot] = useState(false);
  const [jobs, setJobs] = useState<{ id: string; name: string; progress: number; status: string }[]>([]);

  useEffect(() => {
    document.body.classList.toggle('tv', tv);
    return () => document.body.classList.remove('tv');
  }, [tv]);

  async function loadList() {
    const body = await getJson<{ entries: Entry[] }>(guestApi(token, 'list', dir));
    setEntries(body.entries);
  }

  useEffect(() => {
    let closed = false;
    getJson<GuestState>(guestApi(token, 'state'))
      .then((next) => {
        if (closed) return;
        setState(next);
        setCount(next.deviceCount);
        setError(null);
      })
      .catch((err: Error) => {
        if (!closed) setError(err.message);
      });
    return () => {
      closed = true;
    };
  }, [token]);

  useEffect(() => {
    if (error || section === 'clipboard') return;
    const run = section === 'album'
      ? getJson<{ images: Entry[] }>(guestApi(token, 'album', dir)).then((body) => setImages(body.images))
      : loadList();
    run.catch((err: Error) => setError(err.message));
  }, [token, dir, section, error]);

  useEffect(() => {
    if (error) return;
    const socket = new WebSocket(wsUrl(`/api/r/${encodeURIComponent(token)}/ws?d=${deviceId()}`));
    const ping = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, 3000);
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type?: string; count?: number };
      if (message.type === 'presence' && typeof message.count === 'number') setCount(message.count);
      if (message.type === 'files-changed') {
        loadList().catch(() => undefined);
        getJson<{ images: Entry[] }>(guestApi(token, 'album', dir)).then((body) => setImages(body.images)).catch(() => undefined);
      }
      if (message.type === 'clipboard') window.dispatchEvent(new Event('localcast-clipboard'));
      if (message.type === 'room' && message.type) {
        const status = (message as { status?: string }).status;
        if (status === 'closed' || status === 'expired') setError(status);
      }
    };
    return () => {
      window.clearInterval(ping);
      socket.close();
    };
  }, [token, dir, error]);

  useEffect(() => {
    if (!tv) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (document.body.dataset.lightbox) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); moveTvFocus('right'); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); moveTvFocus('left'); }
      if (event.key === 'ArrowDown') { event.preventDefault(); moveTvFocus('down'); }
      if (event.key === 'ArrowUp') { event.preventDefault(); moveTvFocus('up'); }
      if (event.key === 'Backspace') {
        event.preventDefault();
        goDir(parentDir(dir));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tv, dir]);

  function goDir(next: string) {
    navigate(withSearch(location.pathname, (search) => {
      if (next) search.set('dir', next);
      else search.delete('dir');
    }));
  }

  function goSection(next: 'files' | 'album' | 'clipboard') {
    const path = next === 'files' ? `/r/${encodeURIComponent(token)}` : `/r/${encodeURIComponent(token)}/${next}`;
    navigate(withSearch(path, () => undefined));
  }

  async function sendFiles(files: File[]) {
    if (!state?.uploadEnabled) return;
    const queue = files.map((file) => ({ id: crypto.randomUUID(), file, name: file.name, progress: 0, status: 'queued' }));
    setJobs((current) => [...queue.map(({ id, name, progress, status }) => ({ id, name, progress, status })), ...current]);
    for (const job of queue) {
      setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: 'up' } : item));
      try {
        await uploadFile(token, job.file, (ratio) => {
          setJobs((current) => current.map((item) => item.id === job.id ? { ...item, progress: ratio, status: 'up' } : item));
        });
        setJobs((current) => current.map((item) => item.id === job.id ? { ...item, progress: 1, status: 'done' } : item));
      } catch (err) {
        const code = err instanceof Error ? err.message : 'upload_failed';
        setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: code } : item));
      }
    }
    loadList().catch(() => undefined);
  }

  const shown = useMemo(() => sortEntries(entries, query, filter, sort), [entries, query, filter, sort]);
  const previewItems = (section === 'album' ? images : shown.filter((entry) => entry.kind !== 'dir' && entry.kind !== 'file'));

  if (error === 'closed' || error === 'expired' || error === 'invalid_token' || error === 'not_sharing') {
    const title = error === 'closed' ? t.closedTitle : error === 'expired' ? t.expiredTitle : t.invalidTitle;
    const body = error === 'closed' ? t.closedBody : error === 'expired' ? t.expiredBody : t.invalidBody;
    return <main className="shell"><h1>{title}</h1><p className="lead">{body}</p></main>;
  }

  const crumbs = dir ? dir.split('/').filter(Boolean) : [];

  return (
    <div className="guest">
      <header className="topbar">
        <a className="wordmark" href={`/r/${encodeURIComponent(token)}`} onClick={(event) => { event.preventDefault(); goSection('files'); }}>
          <Mark />
          <span className="word">Local<em>Cast</em></span>
        </a>
        <div className="cluster">
          <span className="pill"><i className="lamp on" /> {count}</span>
          <button className="btn small" type="button" aria-pressed={tv} onClick={() => navigate(withSearch(location.pathname, (search) => tv ? search.delete('tv') : search.set('tv', '1')))}>{t.tv}</button>
          <button className="icon-btn" type="button" aria-label={t.theme} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☾' : '☀'}</button>
          <button className="btn small" type="button" onClick={() => setLang(lang === 'en' ? 'zh-CN' : 'en')}>{lang === 'en' ? '中文' : 'EN'}</button>
        </div>
      </header>
      {tv && <p className="footer-note">{t.tvHelp}</p>}
      <div className="guest-grid">
        <nav className="side" aria-label={t.files}>
          <SectionLink current={section} id="files" onClick={() => goSection('files')}>{t.files}</SectionLink>
          <SectionLink current={section} id="album" onClick={() => goSection('album')}>{t.album}</SectionLink>
          <SectionLink current={section} id="clipboard" onClick={() => goSection('clipboard')}>{t.clipboard}</SectionLink>
        </nav>
        <main>
          {section !== 'clipboard' && (
            <div className="crumbs" aria-label={t.home}>
              <button type="button" onClick={() => goDir('')} aria-current={dir ? undefined : 'page'}>{t.home}</button>
              {crumbs.map((part, index) => {
                const rel = crumbs.slice(0, index + 1).join('/');
                return <span key={rel}>/ <button type="button" onClick={() => goDir(rel)} aria-current={rel === dir ? 'page' : undefined}>{part}</button></span>;
              })}
            </div>
          )}
          {section === 'files' && (
            <div
              onDragOver={(event) => { if (!state?.uploadEnabled) return; event.preventDefault(); setHot(true); }}
              onDragLeave={() => setHot(false)}
              onDrop={(event) => {
                if (!state?.uploadEnabled) return;
                event.preventDefault();
                setHot(false);
                void sendFiles([...event.dataTransfer.files]);
              }}
            >
              <div className="toolbar">
                <label className="search">
                  <IconSearch />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} />
                </label>
                <select aria-label={t.sort} value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                  <option value="name">{t.sortName}</option>
                  <option value="size">{t.sortSize}</option>
                  <option value="modified">{t.sortModified}</option>
                  <option value="kind">{t.sortKind}</option>
                </select>
                <div className="seg" aria-label={t.view}>
                  <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>{t.grid}</button>
                  <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>{t.list}</button>
                </div>
              </div>
              <div className="chips" role="toolbar">
                {(['all', 'folders', 'images', 'videos', 'audio', 'docs'] as Filter[]).map((item) => (
                  <button key={item} className="chip" type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{labelFilter(item, t)}</button>
                ))}
              </div>
              {state?.uploadEnabled && <div className={`drop ${hot ? 'hot' : ''}`}><strong>{t.dropTitle}</strong><p className="muted">{t.dropHint}</p><p className="muted">{t.uploadNoOverwrite}</p></div>}
              {shown.length === 0 && <p className="muted">{query || filter !== 'all' ? t.emptySearch : t.emptyFolder}</p>}
              {view === 'grid' ? (
                <div className="file-grid">
                  {shown.map((entry) => (
                    <button className="tile" data-tv="1" type="button" key={entry.relPath} onClick={() => openEntry(entry)}>
                      {entry.kind === 'image' ? <Thumb token={token} entry={entry} /> : <span className="thumb-fallback">{kindIcon(entry.kind)}</span>}
                      <b>{entry.name}</b>
                      <small>{entry.kind === 'dir' ? t.directory : formatBytes(entry.size)}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="list">
                  {shown.map((entry) => (
                    <div className="list-row" key={entry.relPath}>
                      <span className="row-icon">{kindIcon(entry.kind)}</span>
                      <button data-tv="1" type="button" onClick={() => openEntry(entry)} style={{ border: 0, background: 'transparent', textAlign: 'left' }}>
                        <b>{entry.name}</b>
                      </button>
                      <small className="when">{entry.kind === 'dir' ? t.directory : formatBytes(entry.size)}</small>
                      {entry.kind !== 'dir' && <a className="download" href={guestApi(token, 'raw', entry.relPath, 'download=1')} aria-label={t.download}><IconDownload /></a>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {section === 'album' && (
            images.length === 0 ? <p>{t.albumEmpty}</p> : (
              <div className="album-grid">
                {images.map((entry, index) => (
                  <button data-tv="1" type="button" key={entry.relPath} onClick={() => setPreview(index)}>
                    <Thumb token={token} entry={entry} />
                  </button>
                ))}
              </div>
            )
          )}
          {section === 'clipboard' && (
            <ClipboardPanel loadUrl={guestApi(token, 'clipboard')} postUrl={guestApi(token, 'clipboard')} heading={t.clipboardTitle} />
          )}
          <section className="stack" style={{ marginTop: 18 }}>
            <h2>{t.upload}</h2>
            {state?.uploadEnabled ? (
              <>
                <p className="muted">{t.uploadAdminHint} {t.uploadLimitHint}: {formatBytes(state.uploadMaxBytes)}.</p>
                <input data-tv="1" type="file" multiple onChange={(event) => { void sendFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
                {jobs.map((job) => (
                  <div className="job" key={job.id}>
                    <div className="spread"><span>{job.name}</span><span>{job.status === 'done' ? t.uploadDone : job.status === 'too_large' ? t.tooLarge : job.status === 'up' ? `${Math.round(job.progress * 100)}%` : job.status === 'queued' ? t.queued : t.uploadFailed}</span></div>
                    <div className="progress" aria-valuenow={Math.round(job.progress * 100)}><span style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
                  </div>
                ))}
              </>
            ) : <p>{t.uploadOffHint}</p>}
          </section>
          <p className="footer-note">{t.guestFooter}</p>
        </main>
      </div>
      <nav className="bottom-nav">
        <a href={`/r/${encodeURIComponent(token)}`} aria-current={section === 'files' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); goSection('files'); }}>{t.files}</a>
        <a href={`/r/${encodeURIComponent(token)}/album`} aria-current={section === 'album' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); goSection('album'); }}>{t.album}</a>
        <a href={`/r/${encodeURIComponent(token)}/clipboard`} aria-current={section === 'clipboard' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); goSection('clipboard'); }}>{t.clipboard}</a>
        <a href="#upload" onClick={(event) => { event.preventDefault(); document.querySelector('input[type=file]')?.scrollIntoView({ behavior: 'smooth' }); }}>{t.upload}</a>
      </nav>
      {preview != null && (
        <Lightbox token={token} items={previewItems} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />
      )}
    </div>
  );

  function openEntry(entry: Entry) {
    if (entry.kind === 'dir') {
      goDir(entry.relPath);
      return;
    }
    if (entry.kind === 'file') {
      location.assign(guestApi(token, 'raw', entry.relPath, 'download=1'));
      return;
    }
    const index = previewItems.findIndex((item) => item.relPath === entry.relPath);
    setPreview(index >= 0 ? index : 0);
  }
}

function SectionLink({ current, id, onClick, children }: { current: string; id: string; onClick: () => void; children: string }) {
  return <button className="nav" type="button" aria-current={current === id ? 'page' : undefined} onClick={onClick}>{children}</button>;
}

function Thumb({ token, entry }: { token: string; entry: Entry }) {
  const [src, setSrc] = useState(guestApi(token, 'thumb', entry.relPath, `v=${entry.mtimeMs}`));
  return <img className="thumb" src={src} alt="" onError={() => setSrc(guestApi(token, 'raw', entry.relPath))} />;
}

function parentDir(dir: string): string {
  const parts = dir.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function kindIcon(kind: Entry['kind']) {
  if (kind === 'dir') return <IconFolder />;
  if (kind === 'image') return <IconImage />;
  if (kind === 'video') return <IconVideo />;
  if (kind === 'audio') return <IconAudio />;
  return <IconFile />;
}

function labelFilter(filter: Filter, t: { all: string; folders: string; images: string; videos: string; audio: string; documents: string }): string {
  if (filter === 'folders') return t.folders;
  if (filter === 'images') return t.images;
  if (filter === 'videos') return t.videos;
  if (filter === 'audio') return t.audio;
  if (filter === 'docs') return t.documents;
  return t.all;
}

function sortEntries(entries: Entry[], query: string, filter: Filter, sort: SortKey): Entry[] {
  const needle = query.trim().toLowerCase();
  let list = entries.filter((entry) => !needle || entry.name.toLowerCase().includes(needle));
  if (filter === 'folders') list = list.filter((entry) => entry.kind === 'dir');
  if (filter === 'images') list = list.filter((entry) => entry.kind === 'image');
  if (filter === 'videos') list = list.filter((entry) => entry.kind === 'video');
  if (filter === 'audio') list = list.filter((entry) => entry.kind === 'audio');
  if (filter === 'docs') list = list.filter((entry) => entry.kind === 'pdf' || entry.kind === 'text');
  const foldersFirst = sort === 'name' || sort === 'kind';
  return [...list].sort((a, b) => {
    if (foldersFirst && (a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1;
    if (sort === 'size') return (a.size ?? -1) - (b.size ?? -1);
    if (sort === 'modified') return b.mtimeMs - a.mtimeMs;
    if (sort === 'kind') return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}
