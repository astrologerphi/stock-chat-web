import { DEFAULT_MODEL, listModels } from './data/gemini.ts';
import { Fmp } from './data/fmp.ts';
import { getHeatJob, startHeatJob, stopHeatJob } from './data/heat.ts';
import { enqueue, getTaskStatuses } from './data/llm.ts';
import { getPrompts, savePrompts } from './data/prompts.ts';
import { countryFacets, exchangeFacets, getDetail, listStocks, refreshHeat, setTags, tagFacets } from './data/stocks.ts';
import { getSyncStatus, startSync } from './data/sync.ts';
import { addTag, deleteTag, listTagLibrary } from './data/tags.ts';
import { HttpError } from './data/util.ts';
import { getSettings } from './settings.ts';
import type { Facet, HeatJobStatus, ListResponse, PromptConfig, StockDetail, SyncStatus, TagInfo, TaskKind, TaskStatus } from './types.ts';

/**
 * The app's single entry point to data. Everything runs in the browser: stocks live in a local
 * SQLite database (see data/db.ts), and FMP / Gemini are called directly with the keys from Settings.
 */
export { HttpError as ApiError };

export interface ListParams {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q: string;
  exchange: string[];
  country: string[];
  tags: string[];
}

const keys = () => {
  const s = getSettings();
  return { fmp: s.fmpKey.trim(), gemini: s.geminiKey.trim(), model: s.geminiModel.trim() || DEFAULT_MODEL, thinking: s.geminiThinking };
};

const listParam = (values: string[]) => values.map((v) => v.trim()).filter(Boolean).slice(0, 50);

function checkSymbol(symbol: string) {
  const s = symbol.toUpperCase();
  if (!/^[A-Z0-9.\-^]{1,15}$/.test(s)) throw new HttpError(400, 'Invalid symbol');
  return s;
}

export const api = {
  async list(p: ListParams): Promise<ListResponse> {
    return listStocks({
      page: Math.max(1, Math.floor(p.page) || 1),
      pageSize: Math.min(200, Math.max(5, Math.floor(p.pageSize) || 25)),
      sort: p.sort,
      order: p.order === 'asc' ? 'asc' : 'desc',
      q: p.q,
      exchanges: listParam(p.exchange),
      countries: listParam(p.country),
      tags: listParam(p.tags),
    });
  },
  async heat(symbols: string[]) {
    return refreshHeat(new Fmp(keys().fmp), symbols);
  },
  heatJob: (): HeatJobStatus => getHeatJob(),
  /** Refreshes the heat of every company in the background; reports progress if a run is already going. */
  startHeatJob(): HeatJobStatus {
    startHeatJob(keys().fmp);
    return getHeatJob();
  },
  stopHeatJob(): HeatJobStatus {
    stopHeatJob();
    return getHeatJob();
  },
  async detail(symbol: string): Promise<StockDetail> {
    const key = keys().fmp;
    const detail = await getDetail(key ? new Fmp(key) : null, checkSymbol(symbol));
    if (!detail) throw new HttpError(404, 'Stock not found');
    return detail;
  },
  async setTags(symbol: string, tags: string[]) {
    const saved = await setTags(checkSymbol(symbol), tags);
    if (!saved) throw new HttpError(404, 'Stock not found');
    return { tags: saved };
  },
  countries: (): Promise<Facet[]> => countryFacets(),
  exchanges: (): Promise<Facet[]> => exchangeFacets(),
  tags: (): Promise<Facet[]> => tagFacets(),
  /** Every tag in the library, including deleted (blocked) ones. */
  tagLibrary: (): Promise<TagInfo[]> => listTagLibrary(),
  addTag: (name: string) => addTag(name),
  /** Removes the tag from every company and blocks it; resolves to the number of companies changed. */
  deleteTag: (name: string) => deleteTag(name),
  prompts: (): Promise<PromptConfig> => getPrompts(),
  savePrompts: (p: PromptConfig): Promise<PromptConfig> => savePrompts(p),
  syncStatus: (): Promise<SyncStatus> => getSyncStatus(),
  /** Starts a sync, or simply reports progress if one is already running. */
  async startSync(): Promise<SyncStatus> {
    startSync(keys().fmp);
    return getSyncStatus();
  },
  async runLlm(symbols: string[], kind: TaskKind = 'analysis') {
    const list = symbols.map(String).slice(0, 200);
    if (!list.length) throw new HttpError(400, 'No symbols provided');
    const k = keys();
    if (!k.gemini) throw new HttpError(400, 'Gemini API key is missing. Add it in Settings.');
    if (!k.fmp) throw new HttpError(400, 'FMP API key is missing. Add it in Settings.');
    if (kind === 'diagrams' && !(await getPrompts()).svgPrompts.length) {
      throw new HttpError(400, 'No diagram prompts configured. Add one on the Prompts page.');
    }
    return { queued: enqueue(list, k, kind), tasks: getTaskStatuses() };
  },
  async llmStatus(): Promise<TaskStatus[]> {
    return getTaskStatuses();
  },
  async models(key: string) {
    return (await listModels(key.trim())).map((m) => ({ id: m.id, displayName: m.displayName }));
  },
  async testGemini(key: string, model: string) {
    const started = performance.now();
    const models = await listModels(key.trim());
    return {
      latencyMs: Math.round(performance.now() - started),
      modelCount: models.length,
      modelAvailable: models.some((m) => m.id === (model.trim() || DEFAULT_MODEL)),
    };
  },
  async testFmp(key: string) {
    const started = performance.now();
    const profile = await new Fmp(key.trim()).profile('AAPL');
    return { ok: !!profile, latencyMs: Math.round(performance.now() - started) };
  },
};
