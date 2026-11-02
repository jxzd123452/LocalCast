import { AdminApp } from './admin';
import { GuestApp } from './guest';
import { useI18n } from './i18n-context';
import { parseRoute, useHref } from './location';

export function App() {
  const href = useHref();
  const { t } = useI18n();
  const route = parseRoute(href.split('?')[0] || '/');
  if (route.name === 'guest' && route.token && route.section) {
    return <GuestApp token={route.token} section={route.section} />;
  }
  if (route.name === 'missing') {
    return <main className="shell"><h1>{t.invalidTitle}</h1><p><a href="/">{t.home}</a></p></main>;
  }
  return <AdminApp />;
}
