import { useEffect, useState } from 'preact/hooks';
import { api } from './api.ts';
import { getSettings, subscribeSettings } from './settings.ts';
import { toast } from './toast.ts';

/**
 * Cloud sync state for the UI. A full sync (push, then pull) runs when the app opens and on demand; local writes
 * are pushed on their own a few seconds after they settle. Pulls only happen on open or on demand because they
 * reload the current screen.
 */

export interface CloudState {
  /** off: not configured · blocked: configured but linked to another database. */
  state: 'off' | 'blocked' | 'idle' | 'syncing' | 'error';
  message: string | null;
  pending: number;
  lastPullAt: string | null;
  lastPushAt: string | null;
}

const PUSH_DELAY_MS = 8_000;
const PUSH_MAX_WAIT_MS = 60_000;

let current: CloudState = { state: 'off', message: null, pending: 0, lastPullAt: null, lastPushAt: null };
let dataVersion = 0;
const listeners = new Set<(s: CloudState) => void>();
const versionListeners = new Set<(v: number) => void>();
let running: Promise<unknown> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let firstDirtyAt = 0;

function publish(patch: Partial<CloudState>) {
  current = { ...current, ...patch };
  for (const l of listeners) l(current);
}

/** Re-reads the configuration and local change counters without touching the network. */
export async function refreshCloud() {
  const blocker = api.cloudBlocker();
  if (blocker) {
    clearTimeout(pushTimer);
    publish({ state: blocker.reason === 'mismatch' ? 'blocked' : 'off', message: blocker.message });
  } else if (current.state === 'off' || current.state === 'blocked') {
    publish({ state: 'idle', message: null });
  }
  try {
    publish(await api.cloudStats());
  } catch {
    // The database failed to open; the page that needs it reports the error.
  }
}

/** Runs one sync; concurrent calls wait for the running one and then start their own. */
export async function syncCloud(opts: { manual?: boolean; pushOnly?: boolean } = {}): Promise<boolean> {
  while (running) await running.catch(() => {});
  const blocker = api.cloudBlocker();
  if (blocker) {
    await refreshCloud();
    if (opts.manual) toast(blocker.message, 'error');
    return false;
  }
  clearTimeout(pushTimer);
  firstDirtyAt = 0;
  publish({ state: 'syncing', message: null });
  const job = api.cloudSync({ pushOnly: opts.pushOnly });
  running = job;
  try {
    const result = await job;
    running = null;
    await refreshCloud();
    publish({ state: 'idle', message: null });
    if (result.pulled) {
      dataVersion++;
      for (const l of versionListeners) l(dataVersion);
    }
    if (opts.manual) {
      const parts = [result.pushedChanges ? `sent ${result.pushedChanges.toLocaleString('en-US')} change${result.pushedChanges === 1 ? '' : 's'}` : 'nothing to send', result.pulled ? 'received updates' : 'no remote changes'];
      toast(`Synced with Turso · ${parts.join(' · ')}`, 'success');
    }
    return true;
  } catch (e) {
    running = null;
    const message = e instanceof Error ? e.message : String(e);
    const wasFailing = current.message === message;
    await refreshCloud();
    publish({ state: 'error', message });
    if (opts.manual || !wasFailing) toast(message, 'error');
    return false;
  }
}

function schedulePush() {
  if (api.cloudBlocker()) return;
  if (current.state !== 'syncing') void refreshCloud();
  const now = Date.now();
  firstDirtyAt ||= now;
  clearTimeout(pushTimer);
  const wait = Math.max(0, Math.min(PUSH_DELAY_MS, firstDirtyAt + PUSH_MAX_WAIT_MS - now));
  pushTimer = setTimeout(() => void syncCloud({ pushOnly: true }), wait);
}

api.onLocalWrite(schedulePush);

// Sync settings changed: show the new state, and push anything written while sync was off once it's complete.
let lastConfig = `${getSettings().tursoUrl}\n${getSettings().tursoToken}`;
subscribeSettings((s) => {
  const config = `${s.tursoUrl}\n${s.tursoToken}`;
  if (config === lastConfig) return;
  lastConfig = config;
  void refreshCloud();
});

export function useCloud(): CloudState {
  const [state, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return state;
}

/** Increments whenever a pull changed local data; use it as a key to reload screens. */
export function useDataVersion(): number {
  const [v, set] = useState(dataVersion);
  useEffect(() => {
    versionListeners.add(set);
    return () => void versionListeners.delete(set);
  }, []);
  return v;
}

void (async () => {
  await refreshCloud();
  if (!api.cloudBlocker()) await syncCloud();
})();
