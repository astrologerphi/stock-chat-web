import { useEffect, useState } from 'preact/hooks';
import type { ThinkingLevel } from './data/gemini.ts';

export interface Settings {
  geminiKey: string;
  geminiModel: string;
  geminiThinking: ThinkingLevel;
  /** Model and thinking level for Gemini Batch API jobs (Batch analyse page). */
  batchModel: string;
  batchThinking: ThinkingLevel;
  fmpKey: string;
  pageSize: number;
  /** Turso Cloud database (libsql://… URL) and its database token, for Cloud sync. Both empty = local only. */
  tursoUrl: string;
  tursoToken: string;
}

const STORAGE_KEY = 'meridian.settings';
const DEFAULTS: Settings = { geminiKey: '', geminiModel: 'gemini-3.8-flash', geminiThinking: 'default', batchModel: 'gemini-3.8-flash', batchThinking: 'default', fmpKey: '', pageSize: 25, tursoUrl: '', tursoToken: '' };

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

export function subscribeSettings(listener: (s: Settings) => void) {
  listeners.add(listener);
}

export function useSettings(): Settings {
  const [s, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return s;
}
