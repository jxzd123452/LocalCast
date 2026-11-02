import { useEffect, useState } from 'react';
import { getJson, postJson, wsUrl, type AdminState } from './api';
import { ClipboardPanel } from './clipboard';
import { formatBytes, formatRemaining } from './format';
import { fill } from './i18n';
import { Mark } from './icons';
import { useI18n } from './i18n-context';

interface BrowseResult {
  path: string;
  parent: string | null;
  directories: { name: string; path: string }[];
  canShare: boolean;
}

export function AdminApp() {
  const { t, lang, setLang, theme, setTheme } = useI18n();
  const [role, setRole] = useState<'admin' | 'visitor' | 'loading'>('loading');
  const [state, setState] = useState<AdminState | null>(null);
  const [root, setRoot] = useState('');
  const [ttl, setTtl] = useState<'15m' | '1h' | 'unlimited'>('unlimited');
  const [upload, setUpload] = useState(false);
  const [limitMb, setLimitMb] = useState(200);
  const [port, setPort] = useState(8787);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [browsing, setBrowsing] = useState<BrowseResult | null>(null);
  const [now, setNow] = useState(Date.now());

  async function refresh() {
    const next = await getJson<AdminState>('/api/admin/state');
    setState(next);
    setRole('admin');
    if (next.root) setRoot(next.root);
    setTtl(next.ttl);
    setUpload(next.uploadEnabled);
    setLimitMb(Math.round(next.uploadMaxBytes / (1024 * 1024)));
    setPort(next.port);
  }

  useEffect(() => {
    getJson<{ role: 'admin' | 'visitor' }>('/api/session')
      .then((body) => {
        setRole(body.role);
        if (body.role === 'admin') return refresh();
        return undefined;
      })
      .catch(() => setRole('visitor'));
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (role !== 'admin') return;
    const socket = new WebSocket(wsUrl('/api/admin/ws'));
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type?: string; devices?: AdminState['devices']; count?: number };
      if (message.type === 'presence' && message.devices) {
        setState((current) => current ? { ...current, devices: message.devices ?? [] } : current);
      }
      if (message.type === 'clipboard') window.dispatchEvent(new Event('localcast-clipboard'));
    };
    const poll = window.setInterval(() => { refresh().catch(() => undefined); }, 4000);
    return () => {
      window.clearInterval(poll);
      socket.close();
    };
  }, [role]);

  async function share(path = root) {
    setError(null);
    try {
      const next = await postJson<AdminState>('/api/admin/share', {
        root: path,
        ttl,
        uploadEnabled: upload,
        uploadMaxBytes: Math.round(limitMb * 1024 * 1024),
        advertiseHost: state?.advertiseHost,
      });
      setState(next);
      setRoot(next.root ?? path);
    } catch (err) {
      setError(explain(err instanceof Error ? err.message : '', t));
    }
  }

  async function applySettings(patch: Record<string, unknown>) {
    setError(null);
    try {
      await postJson('/api/admin/settings', patch);
      await refresh();
    } catch (err) {
      setError(explain(err instanceof Error ? err.message : '', t));
    }
  }

  if (role === 'loading') return <main className="shell"><p>{t.loading}</p></main>;
  if (role === 'visitor') {
    return <main className="shell"><p className="kicker">LocalCast</p><h1>{t.visitorTitle}</h1><p className="lead">{t.visitorBody}</p><div className="callout warn"><strong>{t.securityCallout}</strong>{t.warning}</div></main>;
  }

  const sharing = state?.sharing === true;
  const remaining = formatRemaining(state?.expiresAt ?? null, now);
  const lanMissing = state?.advertiseHost === '127.0.0.1';

  return (
    <main className="shell">
      <header className="topbar">
        <a className="wordmark" href="/"><Mark /><span className="word">Local<em>Cast</em></span></a>
        <div className="cluster">
          <span className="pill"><i className={sharing ? 'lamp on' : 'lamp'} /> {sharing ? t.statusOn : t.statusOff}</span>
          <button className="icon-btn" type="button" aria-label={t.theme} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☾' : '☀'}</button>
          <div className="seg" aria-label={t.language}>
            <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
            <button type="button" aria-pressed={lang === 'zh-CN'} onClick={() => setLang('zh-CN')}>中文</button>
          </div>
        </div>
      </header>
      <p className="kicker">{t.adminKicker}</p>
      <h1>{t.adminTitle}</h1>
      <p className="lead">{t.adminLead}</p>
      <div className="callout warn"><strong>{t.securityCallout}</strong>{t.warning}</div>
      {lanMissing && <p className="error">{t.lanWarning}</p>}
      <div className="layout">
        <section className="card stack">
          <div>
            <label htmlFor="folder">{t.folderLabel}</label>
            <div className="inline">
              <input id="folder" value={root} placeholder={t.folderPlaceholder} onChange={(event) => setRoot(event.target.value)} />
              <button className="btn" type="button" onClick={() => void getJson<BrowseResult>('/api/admin/browse').then(setBrowsing)}>{t.browse}</button>
            </div>
          </div>
          <label>
            <span>{t.nic}</span>
            <select value={state?.advertiseHost ?? ''} onChange={(event) => void applySettings({ advertiseHost: event.target.value })}>
              {(state?.interfaces ?? []).map((nic) => (
                <option key={`${nic.name}-${nic.address}`} value={nic.address}>{nic.name} · {nic.address}</option>
              ))}
            </select>
          </label>
          <div className="inline">
            <label>
              <span>{t.port}</span>
              <input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} />
            </label>
            <button className="btn" type="button" onClick={() => void changePort(port)}>{t.applyPort}</button>
          </div>
          <p className="muted">{t.changePortHint}</p>
          <label>
            <span>{t.ttl}</span>
            <select value={ttl} onChange={(event) => {
              const next = event.target.value as '15m' | '1h' | 'unlimited';
              setTtl(next);
              if (sharing) void applySettings({ ttl: next });
            }}>
              <option value="15m">{t.ttl15}</option>
              <option value="1h">{t.ttlHour}</option>
              <option value="unlimited">{t.ttlForever}</option>
            </select>
          </label>
          <p className="muted">{sharing ? (remaining ? `${t.remaining}: ${remaining}` : t.unlimitedStay) : t.offAirHint}</p>
          <div className="switch">
            <div>
              <strong>{t.uploadToggle}</strong>
              <div className="muted">{upload ? t.uploadOn : t.uploadOff}</div>
            </div>
            <button className="toggle" type="button" aria-pressed={upload} onClick={() => {
              const next = !upload;
              setUpload(next);
              if (sharing) void applySettings({ uploadEnabled: next });
            }}><i /></button>
          </div>
          <label>
            <span>{t.maxUpload} (MB)</span>
            <input type="number" min={1} max={2048} value={limitMb} onChange={(event) => setLimitMb(Number(event.target.value))} onBlur={() => { if (sharing) void applySettings({ uploadMaxBytes: Math.round(limitMb * 1024 * 1024) }); }} />
          </label>
          <p className="muted">{t.uploadAdminHint}</p>
          {error && <p className="error">{error}</p>}
          <div className="cluster">
            <button className="btn primary" type="button" onClick={() => void share()}>{t.shareFolder}</button>
            <button className="btn danger" type="button" disabled={!sharing} onClick={() => void postJson('/api/admin/stop', {}).then(() => refresh())}>{t.stopSharing}</button>
            <button className="btn" type="button" disabled={!sharing} onClick={() => void postJson('/api/admin/regenerate', {}).then(() => refresh())}>{t.newLink}</button>
          </div>
          <p className="muted">{t.newLinkHint}</p>
        </section>
        <section className="card stack">
          <div className="spread"><h2>{sharing ? t.statusOn : t.qrEmpty}</h2><span className="pill"><i className={sharing ? 'lamp on' : 'lamp'} /> {fill(state && state.devices.length === 1 ? t.devicesOne : t.devicesMany, { n: state?.devices.length ?? 0 })}</span></div>
          <div className="qr-plate">
            {state?.qrSvg ? <div dangerouslySetInnerHTML={{ __html: state.qrSvg }} /> : <div className="qr-empty">{t.qrEmpty}</div>}
          </div>
          <p className="muted">{t.qrCaption}</p>
          {state?.guestUrl && (
            <>
              <div className="url">{state.guestUrl}</div>
              <button className="btn" type="button" onClick={() => void navigator.clipboard.writeText(state.guestUrl ?? '').then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? t.copied : t.copyLink}</button>
            </>
          )}
          <p>{sharing ? t.onAirHint : t.offAirHint}</p>
          <h2>{t.deviceList}</h2>
          {(state?.devices.length ?? 0) === 0 && <p className="muted">{t.noDevices}</p>}
          {state?.devices.map((device) => (
            <div className="device" key={device.id}><span>{device.label}</span><span className="muted">{t.connected}</span></div>
          ))}
        </section>
      </div>
      {sharing && (
        <section className="card stack" style={{ marginTop: 18 }}>
          <ClipboardPanel loadUrl="/api/admin/clipboard" postUrl="/api/admin/clipboard" heading={t.adminClipboard} />
        </section>
      )}
      {browsing && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="card stack">
            <div className="spread"><h2>{browsing.path || t.places}</h2><button className="btn small" type="button" onClick={() => setBrowsing(null)}>{t.close}</button></div>
            {browsing.parent && <button className="btn" type="button" onClick={() => void getJson<BrowseResult>(`/api/admin/browse?path=${encodeURIComponent(browsing.parent ?? '')}`).then(setBrowsing)}>{t.parentFolder}</button>}
            {browsing.directories.map((dir) => (
              <button className="place" type="button" key={dir.path} onClick={() => void getJson<BrowseResult>(`/api/admin/browse?path=${encodeURIComponent(dir.path)}`).then(setBrowsing)}>{dir.name}</button>
            ))}
            <button className="btn primary" type="button" disabled={!browsing.canShare} onClick={() => { setRoot(browsing.path); setBrowsing(null); void share(browsing.path); }}>{t.shareThis}</button>
            {!browsing.canShare && browsing.path && <p className="muted">{t.cannotShareRoot}</p>}
          </div>
        </div>
      )}
    </main>
  );

  async function changePort(nextPort: number) {
    setError(null);
    try {
      const result = await postJson<{ adminUrl: string }>('/api/admin/listen', { port: nextPort });
      if (result.adminUrl && result.adminUrl !== location.origin + '/') location.assign(result.adminUrl);
      else await refresh();
    } catch (err) {
      setError(explain(err instanceof Error ? err.message : '', t));
    }
  }
}

function explain(code: string, t: { pathMissing: string; notAFolder: string; rootTooBroad: string; genericError: string }): string {
  if (code === 'not_found') return t.pathMissing;
  if (code === 'not_a_directory') return t.notAFolder;
  if (code === 'root_too_broad') return t.rootTooBroad;
  return t.genericError;
}
