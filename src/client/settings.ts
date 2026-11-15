import { useEffect, useState } from 'preact/hooks';

export interface Settings {
  geminiKey: string;
  geminiModel: string;
  fmpKey: string;
  pageSize: number;
}

const STORAGE_KEY = 'meridian.settings';
const DEFAULTS: Settings = { geminiKey: '', geminiModel: 'gemini-3.8-flash', fmpKey: '', pageSize: 25 };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();
const listeners = new Set<(s: Settings) => void>();

export const getSettings = () => current;

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  for (const l of listeners) l(current);
}

window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  current = load();
  for (const l of listeners) l(current);
});

export function useSettings(): Settings {
  const [s, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return s;
}
