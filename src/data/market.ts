import type { EtfHoldings, EtfInfo, HoldingLink, PricePoint } from '../types.ts';
import { all, placeholders } from './db.ts';
import type { Fmp } from './fmp.ts';
import { isoDate } from './util.ts';

/**
 * Market data shown on detail pages: price history, ETF info and holdings. It is fetched live from FMP
 * rather than stored, and kept in memory for a while so switching pages and chart ranges stays instant.
 */

const TTL_MS = 15 * 60_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.get(key)?.value === value && cache.delete(key));
  return value;
}

const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Five years of daily closes, oldest first. Chart ranges are cut from this one series. */
export function priceHistory(fmp: Fmp, symbol: string): Promise<PricePoint[]> {
  return cached(`prices:${symbol}`, async () => {
    const from = new Date();
    from.setFullYear(from.getFullYear() - 5);
    const rows = await fmp.prices(symbol, isoDate(from));
    return rows
      .map((r) => ({ date: String(r.date ?? '').slice(0, 10), price: num(r.price) }))
      .filter((r): r is PricePoint => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.price != null && r.price > 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  });
}

export function etfInfo(fmp: Fmp, symbol: string): Promise<EtfInfo | null> {
  return cached(`etf-info:${symbol}`, async () => {
    const i = await fmp.etfInfo(symbol);
    if (!i) return null;
    return {
      description: i.description?.trim() ?? '',
      issuer: i.etfCompany?.trim() ?? '',
      assetClass: i.assetClass?.trim() ?? '',
      expenseRatio: num(i.expenseRatio),
      aum: num(i.assetsUnderManagement),
      nav: num(i.nav),
      avgVolume: num(i.avgVolume),
      holdingsCount: num(i.holdingsCount),
      inceptionDate: i.inceptionDate ?? '',
      website: i.website?.trim() ?? '',
      sectors: (i.sectorsList ?? [])
        .map((s) => ({ name: String(s.industry ?? '').trim(), weight: num(s.exposure) ?? 0 }))
        .filter((s) => s.name && s.weight > 0)
        .sort((a, b) => b.weight - a.weight),
    };
  });
}

/** Holdings by weight, each marked with whether it can be opened as a local stock or ETF. */
export function etfHoldings(fmp: Fmp, symbol: string): Promise<EtfHoldings> {
  return cached(`etf-holdings:${symbol}`, async () => {
    const rows = await fmp.etfHoldings(symbol);
    const symbols = [...new Set(rows.map((r) => (r.asset ?? '').trim().toUpperCase()).filter(Boolean))];
    const known = new Map<string, { image: string; link: HoldingLink }>();
    for (let i = 0; i < symbols.length; i += 400) {
      const chunk = symbols.slice(i, i + 400);
      const found = await all<{ symbol: string; image: string | null; is_etf: number }>(
        `SELECT symbol, image, is_etf FROM stocks WHERE symbol IN (${placeholders(chunk.length)})`,
        ...chunk,
      );
      for (const f of found) known.set(f.symbol, { image: f.image ?? '', link: Number(f.is_etf) === 1 ? 'etf' : 'stock' });
    }
    const updatedAt = rows.map((r) => r.updatedAt).filter((d): d is string => !!d).sort().at(-1) ?? null;
    const holdings = rows
      .map((r) => {
        const asset = (r.asset ?? '').trim().toUpperCase();
        const k = known.get(asset);
        return {
          asset,
          name: (r.name ?? '').trim() || asset,
          weight: num(r.weightPercentage),
          shares: num(r.sharesNumber),
          marketValue: num(r.marketValue),
          image: k?.image ?? '',
          link: k?.link ?? null,
        };
      })
      .filter((h) => h.asset || h.name)
      .sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
    return { holdings, updatedAt };
  });
}
