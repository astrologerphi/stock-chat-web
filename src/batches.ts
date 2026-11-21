import { useEffect, useState } from 'preact/hooks';
import { api } from './api.ts';
import { toast } from './toast.ts';
import type { BatchDraft, BatchRecord } from './types.ts';

/**
 * Gemini batch jobs, kept in SQLite. Unfinished jobs are checked when the app opens, every half minute while
 * one is running, and whenever the tab becomes visible again; finished results are applied to the stocks.
 */

const POLL_MS = 30_000;

let batches: BatchRecord[] = [];
let checking = false;
const listeners = new Set<(b: BatchRecord[]) => void>();
const checkingListeners = new Set<(c: boolean) => void>();
const finishedListeners = new Set<(symbols: string[]) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

export const isOpenBatch = (b: BatchRecord) => !b.applied;

function publish(next: BatchRecord[]) {
  batches = next;
  for (const l of listeners) l(batches);
}

function setChecking(c: boolean) {
  checking = c;
  for (const l of checkingListeners) l(c);
}

async function reload() {
  publish(await api.batches());
}

function schedule() {
  clearTimeout(timer);
  if (batches.some(isOpenBatch) && document.visibilityState === 'visible') timer = setTimeout(() => void check(), POLL_MS);
}

/** Polls Gemini for every unfinished batch and applies whatever has completed. */
export async function check(opts: { manual?: boolean } = {}) {
  clearTimeout(timer);
  setChecking(true);
  try {
    const { finished } = await api.checkBatches();
    await reload();
    const symbols = finished.flatMap((b) => b.symbols);
    if (symbols.length) for (const l of finishedListeners) l(symbols);
    for (const b of finished) {
      if (b.state === 'succeeded') {
        const n = b.appliedCount;
        toast(
          n ? `Batch analysis applied to ${n === 1 ? b.symbols[0] : `${n} stocks`}${b.failedSymbols.length ? ` · ${b.failedSymbols.length} failed` : ''}` : 'Batch finished without usable answers',
          n ? 'success' : 'error',
        );
      } else if (b.state !== 'cancelled') {
        toast(`Batch of ${b.symbols.length} ${b.state}${b.error ? `: ${b.error}` : ''}`, 'error');
      }
    }
    if (opts.manual && !finished.length && batches.some(isOpenBatch)) toast('Batch still running on Gemini', 'info');
  } catch (e) {
    if (opts.manual) toast(e instanceof Error ? e.message : String(e), 'error');
  } finally {
    setChecking(false);
    schedule();
  }
}

export async function submit(draft: BatchDraft, symbols: string[]) {
  const record = await api.submitBatch(draft, symbols);
  toast(`Batch of ${record.symbols.length} submitted · results arrive automatically, even after closing the app`, 'success');
  await reload();
  schedule();
  return record;
}

export async function cancel(id: string) {
  try {
    await api.cancelBatch(id);
    toast('Batch cancelled', 'info');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
  await reload().catch(() => {});
  schedule();
}

export function useBatches(): { batches: BatchRecord[]; checking: boolean } {
  const [state, set] = useState(batches);
  const [busy, setBusy] = useState(checking);
  useEffect(() => {
    listeners.add(set);
    checkingListeners.add(setBusy);
    return () => {
      listeners.delete(set);
      checkingListeners.delete(setBusy);
    };
  }, []);
  return { batches: state, checking: busy };
}

export function useOnBatchesFinished(fn: (symbols: string[]) => void) {
  useEffect(() => {
    finishedListeners.add(fn);
    return () => void finishedListeners.delete(fn);
  }, [fn]);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return clearTimeout(timer);
  if (batches.some(isOpenBatch)) void check();
});

void check();
