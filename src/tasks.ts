import { useEffect, useState } from 'preact/hooks';
import { api } from './api.ts';
import { toast } from './toast.ts';
import type { TaskKind, TaskStatus } from './types.ts';

type Listener = (tasks: Map<string, TaskStatus>) => void;

let tasks = new Map<string, TaskStatus>();
const listeners = new Set<Listener>();
const completionListeners = new Set<(symbols: string[]) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

const active = (t: TaskStatus) => t.state === 'queued' || t.state === 'running';

export const taskKey = (kind: TaskKind, symbol: string) => `${kind}:${symbol}`;

const LABEL: Record<TaskKind, { done: string; failed: string; one: string; many: string }> = {
  analysis: { done: 'Analysis complete for', failed: 'analysis failed', one: 'analysis', many: 'analyses' },
  diagrams: { done: 'Diagrams ready for', failed: 'diagrams failed', one: 'diagram run', many: 'diagram runs' },
};

function publish(next: TaskStatus[]) {
  const prev = tasks;
  tasks = new Map(next.map((t) => [taskKey(t.kind, t.symbol), t]));
  const finished: TaskStatus[] = [];
  for (const [key, t] of tasks) {
    const before = prev.get(key);
    if (before && active(before) && !active(t)) finished.push(t);
  }
  for (const l of listeners) l(tasks);
  if (finished.length) for (const l of completionListeners) l([...new Set(finished.map((t) => t.symbol))]);
  for (const kind of Object.keys(LABEL) as TaskKind[]) {
    const mine = finished.filter((t) => t.kind === kind);
    const ok = mine.filter((t) => t.state !== 'error');
    for (const f of mine) if (f.state === 'error') toast(`${f.symbol}: ${f.error ?? LABEL[kind].failed}`, 'error');
    if (ok.length) toast(`${LABEL[kind].done} ${ok.length === 1 ? ok[0]!.symbol : `${ok.length} stocks`}`, 'success');
  }
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

/** `analysis` writes scores, tags and introduction; `diagrams` only (re)generates SVG diagrams. */
export async function runAnalysis(symbols: string[], kind: TaskKind = 'analysis') {
  try {
    const res = await api.runLlm(symbols, kind);
    publish(res.tasks);
    const l = LABEL[kind];
    toast(res.queued ? `Queued ${res.queued} ${res.queued === 1 ? l.one : l.many}` : 'Already in progress', 'info');
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
