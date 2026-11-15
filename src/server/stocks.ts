import type { SortOrder } from 'mongoose';
import { Stock, type StockDoc } from './db.ts';
import type { Fmp } from './fmp.ts';
import { HttpError, mapLimit } from './util.ts';
import type { Facet, ListResponse, StockDetail, StockRow } from '../shared/types.ts';

const HEAT_TTL_MS = 12 * 3600_000;
const PROFILE_TTL_MS = 24 * 3600_000;

export interface ListQuery {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q?: string;
  exchanges: string[];
  countries: string[];
  tags: string[];
}

const SCORE_SORT = /^score:([a-z0-9_]{1,40})$/;
const SORT_FIELDS: Record<string, string> = {
  marketCap: 'marketCap',
  heat: 'heat',
  floatRatio: 'floatRatio',
  lastLlmRunAt: 'lastLlmRunAt',
  symbol: 'symbol',
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toRow(d: StockDoc): StockRow {
  const scores: Record<string, number> = {};
  for (const [id, s] of Object.entries(d.scores ?? {})) scores[id] = s.score;
  return {
    symbol: d.symbol,
    name: d.name ?? d.symbol,
    image: d.image ?? '',
    exchange: d.exchange ?? '',
    exchangeFullName: d.exchangeFullName ?? '',
    country: d.country ?? '',
    sector: d.sector ?? '',
    industry: d.industry ?? '',
    marketCap: d.marketCap ?? null,
    price: d.price ?? null,
    floatShares: d.floatShares ?? null,
    outstandingShares: d.outstandingShares ?? null,
    floatRatio: d.floatRatio ?? null,
    heat: d.heat ?? null,
    heatUpdatedAt: d.heatUpdatedAt?.toISOString() ?? null,
    scores,
    tags: d.tags ?? [],
    lastLlmRunAt: d.lastLlmRunAt?.toISOString() ?? null,
  };
}

function toDetail(d: StockDoc): StockDetail {
  return {
    ...toRow(d),
    scores: d.scores ?? {},
    description: d.profile?.description ?? '',
    website: d.profile?.website ?? '',
    ceo: d.profile?.ceo ?? '',
    employees: d.profile?.employees ?? null,
    ipoDate: d.profile?.ipoDate ?? '',
    changePercentage: d.changePercentage ?? null,
    range: d.profile?.range ?? '',
    leaders: d.leaders ?? [],
    profileUpdatedAt: d.profileUpdatedAt?.toISOString() ?? null,
    introduction: d.introduction ?? '',
    diagrams: d.diagrams ?? [],
    llmModel: d.llmModel ?? null,
    llmError: d.llmError ?? null,
  };
}

function buildFilter(q: Pick<ListQuery, 'q' | 'exchanges' | 'countries' | 'tags'>) {
  const filter: Record<string, unknown> = { active: true };
  if (q.exchanges.length) filter.exchange = { $in: q.exchanges };
  if (q.countries.length) filter.country = { $in: q.countries };
  if (q.tags.length) filter.tags = { $all: q.tags };
  const text = q.q?.trim();
  if (text) {
    const re = escapeRe(text.slice(0, 50));
    filter.$or = [{ symbol: new RegExp(`^${re}`, 'i') }, { name: new RegExp(re, 'i') }];
  }
  return filter;
}

export async function listStocks(q: ListQuery): Promise<ListResponse> {
  const scoreSort = SCORE_SORT.exec(q.sort);
  const field = scoreSort ? `scores.${scoreSort[1]}.score` : (SORT_FIELDS[q.sort] ?? 'marketCap');
  const dir: SortOrder = q.order === 'asc' ? 1 : -1;
  const filter = buildFilter(q);

  // Missing values always sink to the bottom regardless of direction.
  const sortable = { ...filter, [field]: { $ne: null } };
  const unsortable = { ...filter, [field]: null };
  const skip = (q.page - 1) * q.pageSize;
  const [total, withValue] = await Promise.all([Stock.countDocuments(filter), Stock.countDocuments(sortable)]);

  const docs: StockDoc[] = [];
  if (skip < withValue) {
    docs.push(
      ...(await Stock.find(sortable)
        .sort({ [field]: dir, symbol: 1 })
        .skip(skip)
        .limit(q.pageSize)
        .select('-diagrams -introduction -leaders -profile')
        .lean<StockDoc[]>()),
    );
  }
  if (docs.length < q.pageSize) {
    docs.push(
      ...(await Stock.find(unsortable)
        .sort({ marketCap: -1, symbol: 1 })
        .skip(Math.max(0, skip - withValue))
        .limit(q.pageSize - docs.length)
        .select('-diagrams -introduction -leaders -profile')
        .lean<StockDoc[]>()),
    );
  }
  return { items: docs.map(toRow), total, page: q.page, pageSize: q.pageSize };
}

async function facet(field: 'country' | 'exchange' | 'tags'): Promise<Facet[]> {
  const pipeline: object[] = [{ $match: { docType: 'stock', active: true } }];
  if (field === 'tags') pipeline.push({ $unwind: '$tags' });
  pipeline.push({ $group: { _id: `$${field}`, count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } });
  const rows = await Stock.collection.aggregate<{ _id: string; count: number }>(pipeline).toArray();
  return rows.filter((r) => r._id).map((r) => ({ value: r._id, count: r.count }));
}

export const countryFacets = () => facet('country');
export const exchangeFacets = () => facet('exchange');
export const tagFacets = () => facet('tags');

/** Returns cached heat for the given symbols, refreshing stale values from FMP. */
export async function refreshHeat(fmp: Fmp, symbols: string[]) {
  const docs = await Stock.find({ symbol: { $in: symbols.slice(0, 200) } })
    .select('symbol heat heatUpdatedAt')
    .lean<Pick<StockDoc, 'symbol' | 'heat' | 'heatUpdatedAt'>[]>();
  const now = Date.now();
  return mapLimit(docs, 6, async (d) => {
    if (d.heat != null && d.heatUpdatedAt && now - d.heatUpdatedAt.getTime() < HEAT_TTL_MS) {
      return { symbol: d.symbol, heat: d.heat };
    }
    try {
      const heat = await fmp.countRecentNews(d.symbol);
      await Stock.updateOne({ symbol: d.symbol }, { $set: { heat, heatUpdatedAt: new Date() } });
      return { symbol: d.symbol, heat };
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) throw err;
      return { symbol: d.symbol, heat: d.heat ?? null };
    }
  });
}

/** Loads profile + executives from FMP when stale (or forced) and returns the updated doc. */
export async function refreshProfile(fmp: Fmp | null, symbol: string, opts: { force?: boolean } = {}): Promise<StockDoc | null> {
  const doc = await Stock.findOne({ symbol }).lean<StockDoc>();
  if (!doc || !fmp) return doc;
  const fresh = doc.profileUpdatedAt && Date.now() - doc.profileUpdatedAt.getTime() < PROFILE_TTL_MS;
  if (fresh && !opts.force) return doc;

  const [profile, executives, float] = await Promise.all([
    fmp.profile(symbol),
    fmp.executives(symbol).catch(() => []),
    fmp.float(symbol).catch(() => null),
  ]);
  const set: Record<string, unknown> = {
    leaders: executives
      .filter((e) => e.name && e.active !== false)
      .map((e) => ({ name: e.name, title: e.title, pay: e.pay, currencyPay: e.currencyPay, gender: e.gender, yearBorn: e.yearBorn })),
    profileUpdatedAt: new Date(),
  };
  if (profile) {
    const employees = Number(profile.fullTimeEmployees);
    Object.assign(set, {
      name: profile.companyName || doc.name,
      price: profile.price,
      marketCap: profile.marketCap,
      changePercentage: profile.changePercentage,
      ...(profile.image ? { image: profile.image } : {}),
      profile: {
        description: profile.description ?? '',
        website: profile.website ?? '',
        ceo: profile.ceo ?? '',
        employees: Number.isFinite(employees) && employees > 0 ? employees : null,
        ipoDate: profile.ipoDate ?? '',
        range: profile.range ?? '',
      },
    });
  }
  if (float?.floatShares && float.outstandingShares) {
    Object.assign(set, {
      floatShares: float.floatShares,
      outstandingShares: float.outstandingShares,
      floatRatio: Math.min(1, float.floatShares / float.outstandingShares),
    });
  }
  return Stock.findOneAndUpdate({ symbol }, { $set: set }, { returnDocument: 'after' }).lean<StockDoc>();
}

export async function getDetail(fmp: Fmp | null, symbol: string): Promise<StockDetail | null> {
  let doc: StockDoc | null;
  try {
    doc = await refreshProfile(fmp, symbol);
  } catch (err) {
    console.warn(`[detail] profile refresh failed for ${symbol}:`, err instanceof Error ? err.message : err);
    doc = await Stock.findOne({ symbol }).lean<StockDoc>();
  }
  return doc ? toDetail(doc) : null;
}

export function normalizeTags(tags: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const tag = String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
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

/** Saves the user's tag list, remembering manual additions/removals so they survive future LLM runs. */
export async function setTags(symbol: string, input: unknown[]): Promise<string[] | null> {
  const doc = await Stock.findOne({ symbol }).select('llmTags tagEdits').lean<Pick<StockDoc, 'llmTags' | 'tagEdits'>>();
  if (!doc) return null;
  const tags = normalizeTags(input).slice(0, 30);
  const lower = new Set(tags.map((t) => t.toLowerCase()));
  const llmLower = new Set((doc.llmTags ?? []).map((t) => t.toLowerCase()));
  const edits = {
    added: tags.filter((t) => !llmLower.has(t.toLowerCase())),
    removed: (doc.llmTags ?? []).filter((t) => !lower.has(t.toLowerCase())),
  };
  await Stock.updateOne({ symbol }, { $set: { tags, tagEdits: edits } });
  return tags;
}
