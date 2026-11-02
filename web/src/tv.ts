type Direction = 'left' | 'right' | 'up' | 'down';

export function moveTvFocus(direction: Direction): void {
  const items = [...document.querySelectorAll<HTMLElement>('[data-tv="1"]')].filter((item) => item.getClientRects().length > 0);
  if (!items.length) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const current = active && items.includes(active) ? active : null;
  if (!current) {
    items[0].focus();
    return;
  }
  const next = nearest(items, current, direction);
  (next ?? current).focus();
}

function nearest(items: HTMLElement[], current: HTMLElement, direction: Direction): HTMLElement | null {
  const origin = current.getBoundingClientRect();
  const cx = origin.left + origin.width / 2;
  const cy = origin.top + origin.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item === current) continue;
    const box = item.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    if (direction === 'left' && dx >= -4) continue;
    if (direction === 'right' && dx <= 4) continue;
    if (direction === 'up' && dy >= -4) continue;
    if (direction === 'down' && dy <= 4) continue;
    const primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2.4;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}
