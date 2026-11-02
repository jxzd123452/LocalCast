import { useEffect, useState } from 'react';

export function useHref(): string {
  const [href, setHref] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const sync = () => setHref(location.pathname + location.search);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return href;
}

export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export interface Route {
  name: 'admin' | 'guest' | 'missing';
  token?: string;
  section?: 'files' | 'album' | 'clipboard';
}

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'admin' };
  const match = pathname.match(/^\/r\/([^/]+)(?:\/(album|clipboard|files))?\/?$/);
  if (!match) return { name: 'missing' };
  const section = match[2] === 'album' || match[2] === 'clipboard' ? match[2] : 'files';
  return { name: 'guest', token: decodeURIComponent(match[1]), section };
}

export function withSearch(pathname: string, mutate: (params: URLSearchParams) => void): string {
  const params = new URLSearchParams(location.search);
  mutate(params);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
