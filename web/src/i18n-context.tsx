import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dictionary, type Dict, type Lang } from './i18n';

interface I18nValue {
  lang: Lang;
  t: Dict;
  setLang: (lang: Lang) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLang(): Lang {
  const stored = localStorage.getItem('localcast.lang');
  if (stored === 'zh-CN' || stored === 'en') return stored;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function initialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('localcast.theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [theme, setThemeState] = useState<'light' | 'dark'>(initialTheme);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : 'en';
    document.documentElement.dataset.theme = theme;
  }, [lang, theme]);
  const value = useMemo<I18nValue>(() => ({
    lang,
    t: dictionary(lang),
    setLang: (next) => {
      localStorage.setItem('localcast.lang', next);
      setLangState(next);
    },
    theme,
    setTheme: (next) => {
      localStorage.setItem('localcast.theme', next);
      setThemeState(next);
    },
  }), [lang, theme]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('missing i18n');
  return value;
}
