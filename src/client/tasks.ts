import { useEffect, useState } from 'preact/hooks';
import { api } from './api.ts';
import { toast } from './toast.ts';
import type { TaskStatus } from '../shared/types.ts';

type Listener = (tasks: Map<string, TaskStatus>) => void;

let tasks = new Map<string, TaskStatus>();
const listeners = new Set<Listener>();
const completionListeners = new Set<(symbols: string[]) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

const active = (t: TaskStatus) => t.state === 'queued' || t.state === 'running';

function publish(next: TaskStatus[]) {
  const prev = tasks;
  tasks = new Map(next.map((t) => [t.symbol, t]));
  const finished: string[] = [];
  const failed: TaskStatus[] = [];
  for (const [symbol, t] of tasks) {
    const before = prev.get(symbol);
    if (before && active(before) && !active(t)) {
      finished.push(symbol);
      if (t.state === 'error') failed.push(t);
    }
  }
  for (const l of listeners) l(tasks);
  if (finished.length) for (const l of completionListeners) l(finished);
  for (const f of failed) toast(`${f.symbol}: ${f.error ?? 'analysis failed'}`, 'error');
  const ok = finished.length - failed.length;
  if (ok > 0) toast(`Analysis complete for ${ok === 1 ? finished.find((s) => !failed.some((f) => f.symbol === s)) : `${ok} stocks`}`, 'success');
}

async function poll() {
  clearTimeout(timer);
  try {
    publish(await api.llmStatus());
  } catch {
    /* transient — try again on next tick */
  }
  if ([...tasks.values()].some(active)) timer = setTimeout(poll, 2000);
}

export async function runAnalysis(symbols: string[]) {
  try {
    const res = await api.runLlm(symbols);
    publish(res.tasks);
    toast(res.queued ? `Queued ${res.queued} ${res.queued === 1 ? 'analysis' : 'analyses'}` : 'Already in progress', 'info');
    poll();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

export function useTasks(): Map<string, TaskStatus> {
  const [state, set] = useState(tasks);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return state;
}

export function useOnTasksFinished(fn: (symbols: string[]) => void) {
  useEffect(() => {
    completionListeners.add(fn);
    return () => void completionListeners.delete(fn);
  }, [fn]);
}

export const isActive = active;

poll();
