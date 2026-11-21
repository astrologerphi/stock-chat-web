import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import { api } from '../api.ts';
import { useSettings } from '../settings.ts';
import { toast } from '../toast.ts';
import * as I from '../components/icons.tsx';
import { Spinner } from '../components/ui.tsx';
import type { HeatJobStatus, ListKind, ListResponse, StockRow, SyncStatus } from '../types.ts';

/** Shared pieces of the Stocks and ETFs lists. */

const HEAT_TTL_MS = 12 * 3600_000;

export const csv = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

const fmt = (n: number) => n.toLocaleString('en-US');

export const noun = (kind: ListKind, n: number) => (kind === 'etfs' ? (n === 1 ? 'ETF' : 'ETFs') : n === 1 ? 'company' : 'companies');

export function SortHeader(props: {
  label: string;
  sortKey: string;
  sort: string;
  order: 'asc' | 'desc';
  onSort: (sort: string, order: 'asc' | 'desc') => void;
  title?: string;
  align?: 'right';
}) {
  const active = props.sort === props.sortKey;
  const onClick = () => props.onSort(props.sortKey, active && props.order === 'desc' ? 'asc' : 'desc');
  return (
    <th class={`sortable${active ? ' is-sorted' : ''}${props.align === 'right' ? ' right' : ''}`} title={props.title} aria-sort={active ? (props.order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={onClick}>
        <span>{props.label}</span>
        <span class="sort-ind">{active && props.order === 'asc' ? <I.ArrowUp size={12} /> : <I.ArrowDown size={12} />}</span>
      </button>
    </th>
  );
}

/** Fetches news counts for visible rows whose heat is missing or older than 12 hours. */
export function useRowHeat(setData: Dispatch<StateUpdater<ListResponse | null>>) {
  const { fmpKey } = useSettings();
  const [heatLoading, setHeatLoading] = useState<Set<string>>(new Set());
  const loadHeat = useCallback(
    async (rows: StockRow[]) => {
      // A full refresh is already fetching these; let it fill them in.
      if (!fmpKey || api.heatJob().running) return;
      const stale = rows.filter((r) => r.heat == null || !r.heatUpdatedAt || Date.now() - Date.parse(r.heatUpdatedAt) > HEAT_TTL_MS).map((r) => r.symbol);
      if (!stale.length) return;
      setHeatLoading(new Set(stale));
      try {
        const result = await api.heat(stale);
        const map = new Map(result.map((r) => [r.symbol, r.heat]));
        const now = new Date().toISOString();
        setData((d) => d && { ...d, items: d.items.map((r) => (map.has(r.symbol) ? { ...r, heat: map.get(r.symbol) ?? null, heatUpdatedAt: now } : r)) });
      } catch (e) {
        toast(`Heat: ${e instanceof Error ? e.message : e}`, 'error');
      } finally {
        setHeatLoading(new Set());
      }
    },
    [fmpKey],
  );
  return { heatLoading, loadHeat };
}

/** Loads the sync status and polls it while a sync runs; `onFinished` fires once the run ends. */
export function useSyncStatus(onFinished: () => void) {
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => void api.syncStatus().then(setSync).catch(() => {}), []);
  useEffect(() => {
    if (!sync?.running) return;
    const t = setTimeout(async () => {
      const next = await api.syncStatus().catch(() => sync);
      setSync(next);
      if (next.running) return;
      if (next.error) toast(`Sync failed: ${next.error}`, 'error');
      else toast(`Synced ${fmt(next.total)} ${noun('stocks', next.total)} and ${fmt(next.etfs)} ${noun('etfs', next.etfs)}`, 'success');
      finished.current();
    }, 1500);
    return () => clearTimeout(t);
  }, [sync]);

  const start = useCallback(() => {
    api.startSync().then(setSync).catch((e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error'));
  }, []);
  return { sync, startSync: start };
}

/**
 * Tracks the background "Refresh heat" job. Only one job runs at a time, for either list; `reload`
 * is called every few seconds while it runs and once when it ends.
 */
export function useHeatJob(kind: ListKind, reload: (silent: boolean) => void) {
  const [job, setJob] = useState<HeatJobStatus>(() => api.heatJob());
  const lastReload = useRef(0);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!job.running) return;
    const t = setTimeout(() => {
      const next = api.heatJob();
      setJob(next);
      if (next.running) {
        // Show new values as they land without reloading the table every tick.
        if (Date.now() - lastReload.current > 6000) {
          lastReload.current = Date.now();
          reloadRef.current(true);
        }
        return;
      }
      reloadRef.current(true);
      const what = (n: number) => noun(next.kind, n);
      if (next.error) toast(`Heat refresh failed: ${next.error}`, 'error');
      else if (next.cancelled) toast(`Heat refresh stopped · ${fmt(next.updated)} updated`);
      else if (!next.total) toast(`Heat is already fresh for every ${what(1)}`, 'success');
      else toast(`Heat refreshed for ${fmt(next.updated)} ${what(next.updated)}${next.failed ? ` · ${fmt(next.failed)} failed` : ''}`, next.failed ? 'info' : 'success');
    }, 1000);
    return () => clearTimeout(t);
  }, [job]);

  const start = () => {
    try {
      lastReload.current = Date.now();
      setJob(api.startHeatJob(kind));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };
  const stop = () => setJob(api.stopHeatJob());
  return { job, start, stop };
}

export function SyncBar({ sync }: { sync: SyncStatus | null }) {
  if (!sync?.running) return null;
  return (
    <section class="syncbar card">
      <div class="syncbar__head">
        <Spinner />
        <span>{sync.phase}…</span>
        <span class="num muted">{Math.round(sync.progress * 100)}%</span>
      </div>
      <div class="progress">
        <i style={{ width: `${Math.max(4, sync.progress * 100)}%` }} />
      </div>
    </section>
  );
}

export function HeatJobBar({ job, onStop }: { job: HeatJobStatus; onStop: () => void }) {
  if (!job.running) return null;
  const pct = job.total ? (job.done / job.total) * 100 : 0;
  return (
    <section class="syncbar card" aria-live="polite">
      <div class="syncbar__head">
        <Spinner />
        <span>
          {job.total ? `Refreshing heat · ${fmt(job.done)} of ${fmt(job.total)} ${noun(job.kind, job.total)}` : `Finding ${noun(job.kind, 2)} to refresh`}
          {job.failed > 0 && <span class="muted"> · {fmt(job.failed)} failed</span>}
        </span>
        <span class="num muted">{Math.floor(pct)}%</span>
        <button class="link-btn" onClick={onStop}>
          Stop
        </button>
      </div>
      <div class="progress">
        <i style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </section>
  );
}

export function HeatButton(props: { kind: ListKind; job: HeatJobStatus; disabled: boolean; onStart: () => void }) {
  const { fmpKey } = useSettings();
  const what = noun(props.kind, 2);
  return (
    <button
      class="btn"
      disabled={!fmpKey || props.job.running || props.disabled}
      onClick={props.onStart}
      title={fmpKey ? `Count the last 30 days of news for every ${noun(props.kind, 1)}. ${what[0]!.toUpperCase()}${what.slice(1)} refreshed in the last hour are skipped.` : 'Add an FMP key in Settings first'}
    >
      {props.job.running ? <Spinner /> : <I.Flame size={16} />}
      {props.job.running ? 'Refreshing heat…' : 'Refresh heat'}
    </button>
  );
}
