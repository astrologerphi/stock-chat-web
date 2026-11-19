import { all, get, transaction } from './db.ts';
import { Fmp } from './fmp.ts';
import { HttpError, mapLimit } from './util.ts';
import type { HeatJobStatus } from '../types.ts';

/** Companies refreshed this recently are skipped, so restarting an interrupted run picks up where it stopped. */
const FRESH_MS = 3600_000;
const CONCURRENCY = 6;
const FLUSH_EVERY = 50;
/** A long run of failures means FMP is unreachable or the plan is exhausted; stop instead of burning through every symbol. */
const MAX_CONSECUTIVE_FAILURES = 25;

const status: HeatJobStatus = { running: false, done: 0, total: 0, updated: 0, failed: 0, skipped: 0, cancelled: false, error: null, finishedAt: null };
let stopRequested = false;

export const getHeatJob = (): HeatJobStatus => ({ ...status });

/** Starts refreshing the heat of every active company in the background. Returns false if a run is already going. */
export function startHeatJob(fmpKey: string): boolean {
  if (status.running) return false;
  const fmp = new Fmp(fmpKey);
  stopRequested = false;
  Object.assign(status, { running: true, done: 0, total: 0, updated: 0, failed: 0, skipped: 0, cancelled: false, error: null, finishedAt: null });
  runJob(fmp)
    .catch((err: unknown) => {
      status.error = err instanceof Error ? err.message : String(err);
      console.error('[heat]', err);
    })
    .finally(() => Object.assign(status, { running: false, cancelled: stopRequested && !status.error, finishedAt: new Date().toISOString() }));
  return true;
}

export function stopHeatJob() {
  if (status.running) stopRequested = true;
}

async function runJob(fmp: Fmp) {
  const cutoff = new Date(Date.now() - FRESH_MS).toISOString();
  const [rows, active] = await Promise.all([
    all<{ symbol: string }>(
      `SELECT symbol FROM stocks WHERE active = 1 AND (heat_updated_at IS NULL OR heat_updated_at < ?)
       ORDER BY heat_updated_at IS NOT NULL, heat_updated_at, market_cap DESC`,
      cutoff,
    ),
    get<{ n: number }>('SELECT COUNT(*) AS n FROM stocks WHERE active = 1'),
  ]);
  Object.assign(status, { total: rows.length, skipped: Math.max(0, Number(active?.n ?? 0) - rows.length) });

  let pending: [number, string, string][] = [];
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    await transaction(async (db) => {
      for (const args of batch) await db.run('UPDATE stocks SET heat = ?, heat_updated_at = ? WHERE symbol = ?', ...args);
    });
  };

  let fatal: unknown = null;
  let streak = 0;
  try {
    await mapLimit(rows, CONCURRENCY, async ({ symbol }) => {
      if (stopRequested || fatal) return;
      try {
        const heat = await fmp.countRecentNews(symbol);
        pending.push([heat, new Date().toISOString(), symbol]);
        status.updated++;
        streak = 0;
      } catch (err) {
        status.failed++;
        if (err instanceof HttpError && err.status === 401) fatal = err;
        else if (++streak >= MAX_CONSECUTIVE_FAILURES) fatal = new Error(`Stopped after ${streak} failed requests in a row: ${err instanceof Error ? err.message : err}`);
      }
      status.done++;
      if (pending.length >= FLUSH_EVERY) await flush();
    });
  } finally {
    await flush();
  }
  if (fatal) throw fatal;
}
