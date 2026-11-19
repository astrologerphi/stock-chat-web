import { get, getConfig, setConfig, transaction } from './db.ts';
import { Fmp, type FmpFloat } from './fmp.ts';
import type { SyncStatus } from '../types.ts';

/** Rows per multi-row INSERT; keeps bound parameters well below SQLite's limit. */
const BATCH = 200;

const status: SyncStatus = { running: false, phase: 'idle', progress: 0, lastSyncedAt: null, error: null, total: 0 };

export async function getSyncStatus(): Promise<SyncStatus> {
  const [meta, total] = await Promise.all([
    getConfig<{ lastSyncedAt?: string }>('meta'),
    get<{ n: number }>('SELECT COUNT(*) AS n FROM stocks WHERE active = 1'),
  ]);
  return { ...status, total: Number(total?.n ?? 0), lastSyncedAt: meta?.lastSyncedAt ?? null };
}

/** Starts a full universe sync in the background. Returns false if one is already running. */
export function startSync(fmpKey: string): boolean {
  if (status.running) return false;
  const fmp = new Fmp(fmpKey);
  Object.assign(status, { running: true, phase: 'Fetching listed companies', progress: 0.05, error: null });
  runSync(fmp)
    .catch((err: unknown) => {
      status.error = err instanceof Error ? err.message : String(err);
      console.error('[sync]', err);
    })
    .finally(() => Object.assign(status, { running: false, phase: 'idle', progress: 0 }));
  return true;
}

const COMPANY_COLUMNS = ['symbol', 'name', 'image', 'exchange', 'exchange_full_name', 'country', 'sector', 'industry', 'market_cap', 'price'];
const FLOAT_COLUMNS = ['symbol', 'float_shares', 'outstanding_shares', 'float_ratio'];

/** Builds a multi-row upsert that overwrites every column except the primary key. */
function upsertSql(columns: string[], rows: number, extraSet = '') {
  const row = `(${columns.map(() => '?').join(', ')})`;
  const set = columns.slice(1).map((c) => `${c} = excluded.${c}`);
  if (extraSet) set.push(extraSet);
  return `INSERT INTO stocks (${columns.join(', ')}) VALUES ${Array.from({ length: rows }, () => row).join(', ')}
    ON CONFLICT(symbol) DO UPDATE SET ${set.join(', ')}`;
}

async function runSync(fmp: Fmp) {
  const rows = (await fmp.screener()).filter((r) => r.symbol && r.companyName);
  if (!rows.length) throw new Error('FMP returned no listed companies');
  const seen = new Set(rows.map((r) => r.symbol));
  Object.assign(status, { phase: `Saving ${rows.length.toLocaleString()} companies`, progress: 0.2 });

  const companies = rows.map((r) => [
    r.symbol,
    r.companyName,
    `https://images.financialmodelingprep.com/symbol/${encodeURIComponent(r.symbol)}.png`,
    r.exchangeShortName ?? r.exchange ?? '',
    r.exchange ?? '',
    (r.country ?? '').toUpperCase() || 'N/A',
    r.sector ?? '',
    r.industry ?? '',
    r.marketCap ?? null,
    r.price ?? null,
  ]);
  await transaction(async (db) => {
    for (let i = 0; i < companies.length; i += BATCH) {
      const chunk = companies.slice(i, i + BATCH);
      await db.run(upsertSql(COMPANY_COLUMNS, chunk.length, 'active = 1'), ...chunk.flat());
      status.progress = 0.2 + (i / companies.length) * 0.2;
    }
    await db.run('UPDATE stocks SET active = 0 WHERE symbol NOT IN (SELECT value FROM json_each(?))', JSON.stringify([...seen]));
  });

  Object.assign(status, { phase: 'Fetching float shares', progress: 0.4 });
  const floats = new Map<string, FmpFloat>();
  const limit = 5000;
  const parallel = 4;
  for (let start = 0; start < 200; start += parallel) {
    const pages = await Promise.all(Array.from({ length: parallel }, (_, i) => fmp.floatPage(start + i, limit)));
    for (const page of pages) for (const f of page) if (seen.has(f.symbol)) floats.set(f.symbol, f);
    status.progress = Math.min(0.85, 0.4 + (start / 40) * 0.45);
    if (pages.some((p) => p.length < limit)) break;
  }

  Object.assign(status, { phase: 'Saving float shares', progress: 0.9 });
  const floatRows = [...floats.values()].map((f) => [
    f.symbol,
    f.floatShares ?? null,
    f.outstandingShares ?? null,
    f.floatShares && f.outstandingShares ? Math.min(1, f.floatShares / f.outstandingShares) : null,
  ]);
  // Every symbol here was inserted above, so the upsert only ever updates.
  await transaction(async (db) => {
    for (let i = 0; i < floatRows.length; i += BATCH) {
      const chunk = floatRows.slice(i, i + BATCH);
      await db.run(upsertSql(FLOAT_COLUMNS, chunk.length), ...chunk.flat());
    }
  });

  await setConfig('meta', { lastSyncedAt: new Date().toISOString() });
  console.log(`[sync] ${rows.length} companies, ${floats.size} float records`);
}
