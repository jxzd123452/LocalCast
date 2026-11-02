export function formatBytes(size: number | null | undefined): string {
  if (size == null || !Number.isFinite(size)) return '—';
  if (size < 1024) return `${Math.round(size)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function formatWhen(ms: number, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export function formatRemaining(expiresAt: number | null, now: number): string | null {
  if (expiresAt == null) return null;
  const sec = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
