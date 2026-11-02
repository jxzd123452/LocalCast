import { useEffect, useState } from 'react';
import { getJson, postJson, type Note } from './api';
import { useI18n } from './i18n-context';

export function ClipboardPanel({
  loadUrl,
  postUrl,
  heading,
}: {
  loadUrl: string;
  postUrl: string;
  heading: string;
}) {
  const { t } = useI18n();
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const body = await getJson<{ notes: Note[] }>(loadUrl);
    setNotes(body.notes);
  }

  useEffect(() => {
    reload().catch(() => setError(t.error));
    const onNotes = () => {
      reload().catch(() => undefined);
    };
    window.addEventListener('localcast-clipboard', onNotes);
    return () => window.removeEventListener('localcast-clipboard', onNotes);
  }, [loadUrl]);

  async function send() {
    const value = text;
    if (!value.trim()) return;
    setError(null);
    try {
      await postJson(postUrl, { text: value, author: 'Guest' });
      setText('');
      await reload();
    } catch (err) {
      setError(err instanceof Error && err.message === 'too_large' ? t.tooLarge : t.error);
    }
  }

  async function copy(note: Note) {
    try {
      await navigator.clipboard.writeText(note.text);
      setCopied(note.id);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section className="stack">
      <div>
        <h2>{heading}</h2>
        <p className="muted">{t.clipboardLead}</p>
        <p className="muted">{t.clipboardNever}</p>
      </div>
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={t.clipboardPlaceholder} maxLength={20000} />
      <div className="spread">
        <span className="error">{error}</span>
        <button className="btn primary" type="button" onClick={() => void send()}>{t.send}</button>
      </div>
      <div className="notes">
        {notes.length === 0 && <p className="muted">{t.clipboardEmpty}</p>}
        {notes.map((note) => (
          <article className="note" key={note.id}>
            <div className="spread">
              <strong>{note.author}</strong>
              <button className="btn small" type="button" onClick={() => void copy(note)}>
                {copied === note.id ? t.copiedText : t.copy}
              </button>
            </div>
            <pre>{note.text}</pre>
          </article>
        ))}
      </div>
    </section>
  );
}
