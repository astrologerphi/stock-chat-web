import { cancelBatch, checkBatches, listBatches, prepareBatch, submitBatch } from './data/batch.ts';
import { cloudBlocker, cloudStats, cloudSync, testTurso } from './data/cloud.ts';
import { onLocalWrite } from './data/db.ts';
import { linkedUrl, looksLikePlatformToken, normalizeTursoUrl } from './data/remote.ts';
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
import type { BatchDraft, BatchRecord, Facet, HeatJobStatus, ListKind, ListResponse, PromptConfig, StockDetail, SyncStatus, TagInfo, TaskKind, TaskStatus } from './types.ts';

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

const batchKeys = () => {
  const s = getSettings();
  return { fmp: s.fmpKey.trim(), gemini: s.geminiKey.trim(), model: s.batchModel.trim() || DEFAULT_MODEL, thinking: s.batchThinking };
};

function requireKeys(k: { gemini: string; fmp: string }) {
  if (!k.gemini) throw new HttpError(400, 'Gemini API key is missing. Add it in Settings.');
  if (!k.fmp) throw new HttpError(400, 'FMP API key is missing. Add it in Settings.');
}

const listParam = (values: string[]) => values.map((v) => v.trim()).filter(Boolean).slice(0, 50);

function checkSymbol(symbol: string) {
  const s = symbol.toUpperCase();
  if (!/^[A-Z0-9.\-^]{1,15}$/.test(s)) throw new HttpError(400, 'Invalid symbol');
  return s;
}

export const api = {
  async list(p: ListParams, kind: ListKind = 'stocks'): Promise<ListResponse> {
    return listStocks({
      kind,
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
  /** Refreshes the heat of every stock or ETF in the background; reports progress if a run is already going. */
  startHeatJob(kind: ListKind = 'stocks'): HeatJobStatus {
    startHeatJob(keys().fmp, kind);
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
  exchanges: (kind: ListKind = 'stocks'): Promise<Facet[]> => exchangeFacets(kind),
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
    requireKeys(k);
    if (kind === 'diagrams' && !(await getPrompts()).svgPrompts.length) {
      throw new HttpError(400, 'No diagram prompts configured. Add one on the Prompts page.');
    }
    return { queued: enqueue(list, k, kind), tasks: getTaskStatuses() };
  },
  async llmStatus(): Promise<TaskStatus[]> {
    return getTaskStatuses();
  },
  /** Builds the batch analysis requests for review; nothing is sent to Gemini. */
  async prepareBatch(symbols: string[], onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<BatchDraft> {
    const list = [...new Set(symbols.map(String))].slice(0, 200);
    if (!list.length) throw new HttpError(400, 'No symbols provided');
    const k = batchKeys();
    requireKeys(k);
    return prepareBatch(list, k, onProgress, signal);
  },
  submitBatch: (draft: BatchDraft, symbols: string[]): Promise<BatchRecord> => submitBatch(draft, symbols, batchKeys().gemini),
  batches: (): Promise<BatchRecord[]> => listBatches(),
  /** Polls unfinished batch jobs and applies finished results. */
  checkBatches: () => checkBatches(batchKeys().gemini),
  cancelBatch: (id: string) => cancelBatch(id, batchKeys().gemini),
  async models(key: string) {
    return (await listModels(key.trim())).map((m) => ({ id: m.id, displayName: m.displayName, batch: m.batch }));
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
  /** Why Cloud sync can't run (not configured, or linked to another database), or null. */
  cloudBlocker: () => cloudBlocker(),
  cloudLinkedUrl: () => linkedUrl(),
  normalizeTursoUrl: (url: string) => normalizeTursoUrl(url),
  looksLikePlatformToken: (token: string) => looksLikePlatformToken(token),
  cloudStats: () => cloudStats(),
  /** Pushes local changes to Turso, then pulls remote ones unless `pushOnly`. */
  cloudSync: (opts?: { pushOnly?: boolean }) => cloudSync(opts),
  testTurso: (url: string, token: string) => testTurso(url, token),
  onLocalWrite: (fn: () => void) => onLocalWrite(fn),
  async testFmp(key: string) {
    const started = performance.now();
    const profile = await new Fmp(key.trim()).profile('AAPL');
    return { ok: !!profile, latencyMs: Math.round(performance.now() - started) };
  },
};
