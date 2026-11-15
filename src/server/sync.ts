import { Config, Stock } from './db.ts';
import { Fmp, type FmpFloat } from './fmp.ts';
import type { SyncStatus } from '../shared/types.ts';

const status: SyncStatus = { running: false, phase: 'idle', progress: 0, lastSyncedAt: null, error: null, total: 0 };

export async function getSyncStatus(): Promise<SyncStatus> {
  const [meta, total] = await Promise.all([
    Config.findOne({ key: 'meta' }).lean<{ lastSyncedAt?: Date }>(),
    Stock.countDocuments({ active: true }),
  ]);
  return { ...status, total, lastSyncedAt: meta?.lastSyncedAt?.toISOString() ?? null };
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

async function runSync(fmp: Fmp) {
  const rows = (await fmp.screener()).filter((r) => r.symbol && r.companyName);
  const seen = new Set(rows.map((r) => r.symbol));
  Object.assign(status, { phase: `Saving ${rows.length.toLocaleString()} companies`, progress: 0.2 });

  const ops = rows.map((r) => ({
    updateOne: {
      filter: { symbol: r.symbol },
      update: {
        $set: {
          name: r.companyName,
          image: `https://images.financialmodelingprep.com/symbol/${encodeURIComponent(r.symbol)}.png`,
          exchange: r.exchangeShortName ?? r.exchange ?? '',
          exchangeFullName: r.exchange ?? '',
          country: (r.country ?? '').toUpperCase() || 'N/A',
          sector: r.sector ?? '',
          industry: r.industry ?? '',
          marketCap: r.marketCap ?? null,
          price: r.price ?? null,
          active: true,
        },
        $setOnInsert: { symbol: r.symbol },
      },
      upsert: true,
    },
  }));
  for (let i = 0; i < ops.length; i += 1000) await Stock.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  await Stock.updateMany({ symbol: { $nin: [...seen] } }, { $set: { active: false } });

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
  const floatOps = [...floats.values()].map((f) => ({
    updateOne: {
      filter: { symbol: f.symbol },
      update: {
        $set: {
          floatShares: f.floatShares ?? null,
          outstandingShares: f.outstandingShares ?? null,
          floatRatio: f.floatShares && f.outstandingShares ? Math.min(1, f.floatShares / f.outstandingShares) : null,
        },
      },
    },
  }));
  for (let i = 0; i < floatOps.length; i += 1000) await Stock.bulkWrite(floatOps.slice(i, i + 1000), { ordered: false });

  await Config.updateOne({ key: 'meta' }, { $set: { lastSyncedAt: new Date() } }, { upsert: true });
  console.log(`[sync] ${rows.length} companies, ${floats.size} float records`);
}
