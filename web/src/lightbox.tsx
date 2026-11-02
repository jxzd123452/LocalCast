import { useEffect, useState, type TouchEvent } from 'react';
import { getJson, guestApi, type Meta } from './api';
import { formatBytes, formatDuration, formatWhen } from './format';
import { useI18n } from './i18n-context';
import type { Entry } from './types';

export function Lightbox({
  token,
  items,
  index,
  onIndex,
  onClose,
}: {
  token: string;
  items: Entry[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const item = items[index];
  const [meta, setMeta] = useState<Meta | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    document.body.dataset.lightbox = 'open';
    return () => {
      delete document.body.dataset.lightbox;
    };
  }, []);

  useEffect(() => {
    if (!item) return;
    let cancel = false;
    setMeta(null);
    setFailed(false);
    setText(null);
    getJson<Meta>(guestApi(token, 'meta', item.relPath))
      .then((next) => {
        if (!cancel) setMeta(next);
      })
      .catch(() => {
        if (!cancel) setMeta(null);
      });
    if (item.kind === 'text' && (item.size ?? 0) <= 200_000) {
      fetch(guestApi(token, 'raw', item.relPath))
        .then((response) => response.text())
        .then((value) => {
          if (!cancel) setText(value);
        })
        .catch(() => {
          if (!cancel) setText(null);
        });
    }
    return () => {
      cancel = true;
    };
  }, [item, token]);

  useEffect(() => {
    if (!playing || item?.kind !== 'image') return;
    const timer = window.setTimeout(() => onIndex((index + 1) % items.length), 4000);
    return () => window.clearTimeout(timer);
  }, [playing, index, item, items.length, onIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') onIndex(Math.min(items.length - 1, index + 1));
      if (event.key === 'ArrowLeft') onIndex(Math.max(0, index - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onIndex]);

  if (!item) return null;
  const duration = formatDuration(meta?.durationSec);
  const raw = guestApi(token, 'raw', item.relPath);
  const download = guestApi(token, 'raw', item.relPath, 'download=1');
  const imageSrc = item.playable === true ? raw : guestApi(token, 'thumb', item.relPath, `v=${item.mtimeMs}`);

  const onTouch = (() => {
    let startX = 0;
    return {
      onTouchStart: (event: TouchEvent) => {
        startX = event.changedTouches[0]?.clientX ?? 0;
      },
      onTouchEnd: (event: TouchEvent) => {
        const delta = (event.changedTouches[0]?.clientX ?? 0) - startX;
        if (delta > 50) onIndex(Math.max(0, index - 1));
        if (delta < -50) onIndex(Math.min(items.length - 1, index + 1));
      },
    };
  })();

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={item.name} {...onTouch}>
      <header>
        <div>
          <strong>{item.name}</strong>
          <div className="muted">
            {index + 1} {t.of} {items.length}
          </div>
        </div>
        <div className="cluster">
          {item.kind === 'image' && (
            <button className="btn small" type="button" onClick={() => setPlaying((value) => !value)}>
              {playing ? t.slideshowPause : t.slideshowPlay}
            </button>
          )}
          <a className="btn small" href={download}>{t.download}</a>
          <button className="btn small" type="button" onClick={onClose}>{t.close}</button>
        </div>
      </header>
      <div className="stage">
        {index > 0 && <button className="nav-arrow prev" type="button" onClick={() => onIndex(index - 1)} aria-label={t.back}>‹</button>}
        {item.kind === 'image' && <img src={imageSrc} alt={item.name} />}
        {item.kind === 'video' && item.playable === false && (
          <div className="unsupported">
            <h2>{t.unsupportedTitle}</h2>
            <p>{t.unsupportedBody}</p>
          </div>
        )}
        {item.kind === 'video' && item.playable !== false && !failed && (
          <video key={item.relPath} src={raw} controls autoPlay playsInline onError={() => setFailed(true)} />
        )}
        {item.kind === 'audio' && item.playable === false && (
          <div className="unsupported">
            <h2>{t.unsupportedTitle}</h2>
            <p>{t.unsupportedBody}</p>
          </div>
        )}
        {item.kind === 'audio' && item.playable !== false && !failed && (
          <audio key={item.relPath} src={raw} controls autoPlay onError={() => setFailed(true)} />
        )}
        {(item.kind === 'video' || item.kind === 'audio') && failed && (
          <div className="unsupported">
            <h2>{t.playbackFailed}</h2>
            <p>{t.unsupportedBody}</p>
          </div>
        )}
        {item.kind === 'video' && item.playable === 'try' && !failed && <p className="muted">{t.tryTitle}</p>}
        {item.kind === 'pdf' && (
          <div>
            <iframe title={item.name} src={raw} />
            <p className="muted">{t.pdfHint}</p>
          </div>
        )}
        {item.kind === 'text' && (item.size ?? 0) > 200_000 && <p>{t.textTooBig}</p>}
        {item.kind === 'text' && (item.size ?? 0) <= 200_000 && <pre>{text ?? t.loading}</pre>}
        {index < items.length - 1 && <button className="nav-arrow next" type="button" onClick={() => onIndex(index + 1)} aria-label={t.open}>›</button>}
      </div>
      <footer>
        <span>{t.size}: {formatBytes(meta?.size ?? item.size)}</span>
        <span>{duration ? `${t.duration}: ${duration}` : item.kind === 'video' || item.kind === 'audio' ? t.noDuration : ''}</span>
        <span>{meta?.width && meta.height ? `${meta.width}×${meta.height}` : ''}</span>
        <span>{t.modified}: {formatWhen(item.mtimeMs, lang)}</span>
      </footer>
    </div>
  );
}
