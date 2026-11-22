import { all, get, parseJson, placeholders, readStock, run, transaction, type StockDoc, type Database } from './db.ts';
import type { Fmp } from './fmp.ts';
import { cleanTag, resolveTags } from './tags.ts';
import { HttpError, mapLimit } from './util.ts';
import type { Facet, ListKind, ListResponse, ScoreEntry, StockDetail, StockRow } from '../types.ts';

const HEAT_TTL_MS = 12 * 3600_000;
const PROFILE_TTL_MS = 24 * 3600_000;

export interface ListQuery {
  kind: ListKind;
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q?: string;
  exchanges: string[];
  countries: string[];
  tags: string[];
  starred?: boolean;
}

const SCORE_SORT = /^score:([a-z0-9_]{1,40})$/;
const SORT_COLUMNS: Record<string, string> = {
  marketCap: 's.market_cap',
  heat: 's.heat',
  floatRatio: 's.float_ratio',
  lastLlmRunAt: 's.last_llm_run_at',
  symbol: 's.symbol',
};
const ROW_COLUMNS =
  's.symbol, s.name, s.image, s.exchange, s.exchange_full_name, s.country, s.sector, s.industry, s.market_cap, s.price, ' +
  's.float_shares, s.outstanding_shares, s.float_ratio, s.heat, s.heat_updated_at, s.last_llm_run_at, s.starred';

async function tagsFor(symbols: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!symbols.length) return map;
  const rows = await all<{ symbol: string; tag: string }>(
    `SELECT symbol, tag FROM stock_tags WHERE symbol IN (${placeholders(symbols.length)}) ORDER BY symbol, position`,
    ...symbols,
  );
  for (const r of rows) map.set(r.symbol, [...(map.get(r.symbol) ?? []), r.tag]);
  return map;
}

async function scoresFor(symbols: string[]): Promise<Map<string, Record<string, ScoreEntry>>> {
  const map = new Map<string, Record<string, ScoreEntry>>();
  if (!symbols.length) return map;
  const rows = await all<{ symbol: string; prompt_id: string; score: number; reason: string }>(
    `SELECT symbol, prompt_id, score, reason FROM stock_scores WHERE symbol IN (${placeholders(symbols.length)})`,
    ...symbols,
  );
  for (const r of rows) {
    const scores = map.get(r.symbol) ?? {};
    scores[r.prompt_id] = { score: Number(r.score), reason: r.reason ?? '' };
    map.set(r.symbol, scores);
  }
  return map;
}

function toRow(d: StockDoc, scores: Record<string, ScoreEntry>, tags: string[]): StockRow {
  const scoreValues: Record<string, number> = {};
  for (const [id, s] of Object.entries(scores)) scoreValues[id] = s.score;
  return {
    symbol: d.symbol,
    name: d.name,
    image: d.image,
    exchange: d.exchange,
    exchangeFullName: d.exchangeFullName,
    country: d.country,
    sector: d.sector,
    industry: d.industry,
    marketCap: d.marketCap,
    price: d.price,
    floatShares: d.floatShares,
    outstandingShares: d.outstandingShares,
    floatRatio: d.floatRatio,
    heat: d.heat,
    heatUpdatedAt: d.heatUpdatedAt,
    scores: scoreValues,
    tags,
    lastLlmRunAt: d.lastLlmRunAt,
    starred: d.starred,
  };
}

function toDetail(d: StockDoc, scores: Record<string, ScoreEntry>, tags: string[]): StockDetail {
  return {
    ...toRow(d, scores, tags),
    isEtf: d.isEtf,
    scores,
    description: d.profile.description ?? '',
    website: d.profile.website ?? '',
    ceo: d.profile.ceo ?? '',
    employees: d.profile.employees ?? null,
    ipoDate: d.profile.ipoDate ?? '',
    changePercentage: d.changePercentage,
    range: d.profile.range ?? '',
    leaders: d.leaders,
    profileUpdatedAt: d.profileUpdatedAt,
    introduction: d.introduction,
    diagrams: d.diagrams,
    llmModel: d.llmModel,
    llmError: d.llmError,
  };
}

export async function listStocks(q: ListQuery): Promise<ListResponse> {
  const where = ['s.active = 1', 's.is_etf = ?'];
  const args: unknown[] = [q.kind === 'etfs' ? 1 : 0];
  if (q.exchanges.length) {
    where.push(`s.exchange IN (${placeholders(q.exchanges.length)})`);
    args.push(...q.exchanges);
  }
  if (q.countries.length) {
    where.push(`s.country IN (${placeholders(q.countries.length)})`);
    args.push(...q.countries);
  }
  if (q.starred) where.push('s.starred = 1');
  const tags = [...new Set(q.tags)];
  if (tags.length) {
    where.push(`s.symbol IN (SELECT symbol FROM stock_tags WHERE tag IN (${placeholders(tags.length)}) GROUP BY symbol HAVING COUNT(*) = ?)`);
    args.push(...tags, tags.length);
  }
  const text = q.q?.trim().slice(0, 50);
  if (text) {
    where.push('(substr(s.symbol, 1, ?) = ? OR instr(lower(s.name), ?) > 0)');
    args.push(text.length, text.toUpperCase(), text.toLowerCase());
  }

  const scoreSort = SCORE_SORT.exec(q.sort);
  const join = scoreSort ? 'LEFT JOIN stock_scores sc ON sc.symbol = s.symbol AND sc.prompt_id = ?' : '';
  const sortExpr = scoreSort ? 'sc.score' : (SORT_COLUMNS[q.sort] ?? 's.market_cap');
  const dir = q.order === 'asc' ? 'ASC' : 'DESC';
  const whereSql = where.join(' AND ');

  // Missing values always sink to the bottom regardless of direction.
  const [count, rows] = await Promise.all([
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM stocks s WHERE ${whereSql}`, ...args),
    all(
      `SELECT ${ROW_COLUMNS} FROM stocks s ${join} WHERE ${whereSql}
       ORDER BY (${sortExpr} IS NULL), ${sortExpr} ${dir}, (s.market_cap IS NULL), s.market_cap DESC, s.symbol ASC
       LIMIT ? OFFSET ?`,
      ...(scoreSort ? [scoreSort[1]] : []),
      ...args,
      q.pageSize,
      (q.page - 1) * q.pageSize,
    ),
  ]);

  const docs = rows.map(readStock);
  const symbols = docs.map((d) => d.symbol);
  const [tagMap, scoreMap] = await Promise.all([tagsFor(symbols), scoresFor(symbols)]);
  return {
    items: docs.map((d) => toRow(d, scoreMap.get(d.symbol) ?? {}, tagMap.get(d.symbol) ?? [])),
    total: Number(count?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** Stars or unstars a company; resolves to false if the symbol is unknown. */
export async function setStarred(symbol: string, starred: boolean): Promise<boolean> {
  const res = await run('UPDATE stocks SET starred = ? WHERE symbol = ?', starred ? 1 : 0, symbol);
  return Number((res as { changes?: number } | undefined)?.changes ?? 1) > 0;
}

export async function starredCount(kind: ListKind): Promise<number> {
  const r = await get<{ n: number }>('SELECT COUNT(*) AS n FROM stocks WHERE starred = 1 AND active = 1 AND is_etf = ?', kind === 'etfs' ? 1 : 0);
  return Number(r?.n ?? 0);
}

async function facet(sql: string, ...args: unknown[]): Promise<Facet[]> {
  const rows = await all<{ value: string; count: number }>(sql, ...args);
  return rows.filter((r) => r.value).map((r) => ({ value: String(r.value), count: Number(r.count) }));
}

const columnFacet = (column: 'country' | 'exchange', kind: ListKind) =>
  facet(
    `SELECT ${column} AS value, COUNT(*) AS count FROM stocks WHERE active = 1 AND is_etf = ? AND ${column} <> '' GROUP BY ${column} ORDER BY count DESC, value ASC`,
    kind === 'etfs' ? 1 : 0,
  );

export const countryFacets = () => columnFacet('country', 'stocks');
export const exchangeFacets = (kind: ListKind) => columnFacet('exchange', kind);
export const tagFacets = () =>
  facet(
    'SELECT t.tag AS value, COUNT(*) AS count FROM stock_tags t JOIN stocks s ON s.symbol = t.symbol WHERE s.active = 1 AND s.is_etf = 0 GROUP BY t.tag ORDER BY count DESC, value ASC',
  );

/** Updates the given `stocks` columns. Column names are internal constants, never user input. */
export async function updateStock(symbol: string, set: Record<string, unknown>, db?: Database) {
  const entries = Object.entries(set);
  const sql = `UPDATE stocks SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE symbol = ?`;
  const args = [...entries.map(([, v]) => v ?? null), symbol];
  await (db ? db.run(sql, ...args) : run(sql, ...args));
}

export async function loadStock(symbol: string): Promise<StockDoc | null> {
  const row = await get('SELECT * FROM stocks WHERE symbol = ?', symbol);
  return row ? readStock(row) : null;
}

/** Returns cached heat for the given symbols, refreshing stale values from FMP. */
export async function refreshHeat(fmp: Fmp, symbols: string[]) {
  const list = [...new Set(symbols)].slice(0, 200);
  if (!list.length) return [];
  const docs = await all<{ symbol: string; heat: number | null; heat_updated_at: string | null }>(
    `SELECT symbol, heat, heat_updated_at FROM stocks WHERE symbol IN (${placeholders(list.length)})`,
    ...list,
  );
  const now = Date.now();
  return mapLimit(docs, 6, async (d) => {
    const cached = d.heat == null ? null : Number(d.heat);
    if (cached != null && d.heat_updated_at && now - Date.parse(d.heat_updated_at) < HEAT_TTL_MS) {
      return { symbol: d.symbol, heat: cached };
    }
    try {
      const heat = await fmp.countRecentNews(d.symbol);
      await updateStock(d.symbol, { heat, heat_updated_at: new Date().toISOString() });
      return { symbol: d.symbol, heat };
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) throw err;
      return { symbol: d.symbol, heat: cached };
    }
  });
}

/** Loads profile + executives from FMP when stale (or forced) and returns the updated stock. */
export async function refreshProfile(fmp: Fmp | null, symbol: string, opts: { force?: boolean } = {}): Promise<StockDoc | null> {
  const doc = await loadStock(symbol);
  if (!doc || !fmp) return doc;
  const fresh = doc.profileUpdatedAt && Date.now() - Date.parse(doc.profileUpdatedAt) < PROFILE_TTL_MS;
  if (fresh && !opts.force) return doc;

  // Funds have no executives or float; skip those calls.
  const [profile, executives, float] = await Promise.all([
    fmp.profile(symbol),
    doc.isEtf ? [] : fmp.executives(symbol).catch(() => []),
    doc.isEtf ? null : fmp.float(symbol).catch(() => null),
  ]);
  const set: Record<string, unknown> = {
    leaders: JSON.stringify(
      executives
        .filter((e) => e.name && e.active !== false)
        .map((e) => ({
          name: e.name,
          title: e.title ?? '',
          pay: e.pay ?? null,
          currencyPay: e.currencyPay ?? null,
          gender: e.gender ?? null,
          yearBorn: e.yearBorn ?? null,
        })),
    ),
    profile_updated_at: new Date().toISOString(),
  };
  if (profile) {
    const employees = Number(profile.fullTimeEmployees);
    Object.assign(set, {
      name: profile.companyName || doc.name,
      price: profile.price,
      market_cap: profile.marketCap,
      change_percentage: profile.changePercentage,
      ...(profile.image ? { image: profile.image } : {}),
      profile: JSON.stringify({
        description: profile.description ?? '',
        website: profile.website ?? '',
        ceo: profile.ceo ?? '',
        employees: Number.isFinite(employees) && employees > 0 ? employees : null,
        ipoDate: profile.ipoDate ?? '',
        range: profile.range ?? '',
      }),
    });
  }
  if (float?.floatShares && float.outstandingShares) {
    Object.assign(set, {
      float_shares: float.floatShares,
      outstanding_shares: float.outstandingShares,
      float_ratio: Math.min(1, float.floatShares / float.outstandingShares),
    });
  }
  await updateStock(symbol, set);
  return loadStock(symbol);
}

export async function getDetail(fmp: Fmp | null, symbol: string): Promise<StockDetail | null> {
  let doc: StockDoc | null;
  try {
    doc = await refreshProfile(fmp, symbol);
  } catch (err) {
    console.warn(`[detail] profile refresh failed for ${symbol}:`, err instanceof Error ? err.message : err);
    doc = await loadStock(symbol);
  }
  if (!doc) return null;
  const [tags, scores] = await Promise.all([tagsFor([symbol]), scoresFor([symbol])]);
  return toDetail(doc, scores.get(symbol) ?? {}, tags.get(symbol) ?? []);
}

export function normalizeTags(tags: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const tag = cleanTag(t);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function mergeTags(llmTags: string[], edits: { added: string[]; removed: string[] }): string[] {
  const removed = new Set(edits.removed.map((t) => t.toLowerCase()));
  return normalizeTags([...llmTags.filter((t) => !removed.has(t.toLowerCase())), ...edits.added]);
}

/** Replaces a stock's tag list via the tag library (see resolveTags) and returns what was stored. Must run inside a transaction. */
export async function replaceTags(db: Database, symbol: string, input: string[], source: 'llm' | 'user'): Promise<string[]> {
  const tags = await resolveTags(db, input, source);
  await db.run('DELETE FROM stock_tags WHERE symbol = ?', symbol);
  if (tags.length) {
    await db.run(
      `INSERT INTO stock_tags (symbol, tag, position) VALUES ${tags.map(() => '(?, ?, ?)').join(', ')}`,
      ...tags.flatMap((tag, i) => [symbol, tag, i]),
    );
  }
  return tags;
}

/** Saves the user's tag list, remembering manual additions/removals so they survive future LLM runs. */
export async function setTags(symbol: string, input: unknown[]): Promise<string[] | null> {
  const row = await get<{ llm_tags: string }>('SELECT llm_tags FROM stocks WHERE symbol = ?', symbol);
  if (!row) return null;
  const llmTags = parseJson<string[]>(row.llm_tags, []);
  return transaction(async (db) => {
    const tags = await replaceTags(db, symbol, normalizeTags(input).slice(0, 30), 'user');
    const lower = new Set(tags.map((t) => t.toLowerCase()));
    const llmLower = new Set(llmTags.map((t) => t.toLowerCase()));
    const edits = {
      added: tags.filter((t) => !llmLower.has(t.toLowerCase())),
      removed: llmTags.filter((t) => !lower.has(t.toLowerCase())),
    };
    await updateStock(symbol, { tag_edits: JSON.stringify(edits) }, db);
    return tags;
  });
}
