import { useEffect, useState } from 'preact/hooks';

export type Theme = 'dark' | 'light';

// Keep in sync with the pre-paint script in index.html.
const KEY = 'meridian.theme';
const CHROME: Record<Theme, string> = { dark: '#0b0c0e', light: '#eee8d5' };

const listeners = new Set<(t: Theme) => void>();
const systemLight = matchMedia('(prefers-color-scheme: light)');

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[t]);
  listeners.forEach((fn) => fn(t));
}

systemLight.addEventListener('change', (e) => {
  if (!stored()) apply(e.matches ? 'light' : 'dark');
});

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

/** Switches theme, revealing the new one as a circle growing from `origin`. */
export function setTheme(t: Theme, origin?: { x: number; y: number }) {
  if (t === currentTheme()) return;
  try {
    localStorage.setItem(KEY, t);
  } catch {}
  const doc = document as ViewTransitionDoc;
  if (!origin || !doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply(t);
    return;
  }
  const { x, y } = origin;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  doc.startViewTransition(() => apply(t)).ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 560, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
}

export function useTheme(): Theme {
  const [t, set] = useState(currentTheme);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return t;
}
