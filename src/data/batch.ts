import { all, get, parseJson, run } from './db.ts';
import { cancelBatch as cancelRemote, createBatch, FINAL_BATCH_STATES, getBatch, type ThinkingLevel } from './gemini.ts';
import { applyAnalysis, buildAnalysisPrompt, buildAnalysisSchema, loadContext, SYSTEM_ANALYSIS, type LlmResult } from './llm.ts';
import { getPrompts } from './prompts.ts';
import { updateStock } from './stocks.ts';
import { HttpError, mapLimit } from './util.ts';
import type { BatchDraft, BatchDraftItem, BatchRecord, BatchState } from '../types.ts';

/**
 * Page analysis through the Gemini Batch API. A job is created once and then runs on Google's side, so the
 * page can close; its id is kept in `llm_batches` and results are applied on a later check (e.g. next launch).
 */

interface BatchRow {
  id: string;
  model: string;
  thinking: string;
  symbols: string;
  state: string;
  stats: string | null;
  error: string | null;
  created_at: string;
  checked_at: string | null;
  finished_at: string | null;
  applied: number;
}

const toRecord = (r: BatchRow): BatchRecord => ({
  id: r.id,
  model: r.model,
  thinking: r.thinking,
  symbols: parseJson<string[]>(r.symbols, []),
  state: r.state as BatchState,
  stats: parseJson<BatchRecord['stats']>(r.stats, null),
  error: r.error,
  createdAt: r.created_at,
  checkedAt: r.checked_at,
  finishedAt: r.finished_at,
  applied: !!r.applied,
});

const isOpen = (b: BatchRecord) => !b.applied;

/** Unfinished jobs plus the most recent finished ones. */
export async function listBatches(): Promise<BatchRecord[]> {
  const rows = await all<BatchRow>('SELECT * FROM llm_batches WHERE applied = 0 OR created_at >= ? ORDER BY created_at DESC LIMIT 50', new Date(Date.now() - 7 * 86_400_000).toISOString());
  return rows.map(toRecord);
}

async function symbolsInOpenBatches(): Promise<Set<string>> {
  const rows = await all<BatchRow>('SELECT * FROM llm_batches WHERE applied = 0');
  return new Set(rows.map(toRecord).flatMap((b) => b.symbols));
}

/** Gathers each stock's context and builds the exact prompts a batch would send, without sending anything. */
export async function prepareBatch(
  symbols: string[],
  keys: { fmp: string; model: string; thinking: ThinkingLevel },
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<BatchDraft> {
  const prompts = await getPrompts();
  const busy = await symbolsInOpenBatches();
  const skipped: BatchDraft['skipped'] = [];
  const todo = symbols.filter((s) => {
    if (busy.has(s)) skipped.push({ symbol: s, reason: 'Already in a running batch' });
    return !busy.has(s);
  });

  let done = 0;
  onProgress(0, todo.length);
  const items = await mapLimit(todo, 4, async (symbol): Promise<BatchDraftItem | null> => {
    signal?.throwIfAborted();
    try {
      const { stock, news } = await loadContext(symbol, keys, false);
      const prompt = buildAnalysisPrompt(stock, news, prompts);
      return { symbol, name: stock.name, prompt, newsCount: news.length, approxTokens: Math.ceil((prompt.length + SYSTEM_ANALYSIS.length) / 4) };
    } catch (e) {
      skipped.push({ symbol, reason: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      onProgress(++done, todo.length);
    }
  });
  signal?.throwIfAborted();

  return {
    model: keys.model,
    thinking: keys.thinking,
    system: SYSTEM_ANALYSIS,
    schema: buildAnalysisSchema(prompts),
    items: items.filter((i): i is BatchDraftItem => !!i),
    skipped,
  };
}

export async function submitBatch(draft: BatchDraft, symbols: string[], geminiKey: string): Promise<BatchRecord> {
  const chosen = new Set(symbols);
  const items = draft.items.filter((i) => chosen.has(i.symbol));
  if (!items.length) throw new HttpError(400, 'Select at least one stock');
  const now = new Date();
  const info = await createBatch({
    key: geminiKey,
    model: draft.model,
    thinking: draft.thinking as ThinkingLevel,
    displayName: `meridian-analysis-${now.toISOString().slice(0, 16)}-${items.length}`,
    system: draft.system,
    schema: draft.schema,
    items: items.map((i) => ({ key: i.symbol, prompt: i.prompt })),
  });
  const record: BatchRecord = {
    id: info.id,
    model: draft.model,
    thinking: draft.thinking,
    symbols: items.map((i) => i.symbol),
    state: info.state,
    stats: info.stats,
    error: null,
    createdAt: now.toISOString(),
    checkedAt: now.toISOString(),
    finishedAt: null,
    applied: false,
  };
  await run(
    'INSERT INTO llm_batches (id, model, thinking, symbols, state, stats, created_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    record.id,
    record.model,
    record.thinking,
    JSON.stringify(record.symbols),
    record.state,
    JSON.stringify(record.stats),
    record.createdAt,
    record.checkedAt,
  );
  return record;
}

export interface BatchCheck {
  /** Jobs that finished during this check (results already applied). */
  finished: (BatchRecord & { appliedCount: number; failedSymbols: string[] })[];
}

async function save(b: BatchRecord) {
  await run(
    'UPDATE llm_batches SET state = ?, stats = ?, error = ?, checked_at = ?, finished_at = ?, applied = ? WHERE id = ?',
    b.state,
    JSON.stringify(b.stats),
    b.error,
    b.checkedAt,
    b.finishedAt,
    b.applied ? 1 : 0,
    b.id,
  );
}

async function checkOne(b: BatchRecord, key: string): Promise<BatchCheck['finished'][number] | null> {
  const now = new Date().toISOString();
  let info;
  try {
    info = await getBatch<LlmResult>(key, b.id, b.symbols);
  } catch (e) {
    // A job that is gone (deleted, or purged after it expired) will never return results.
    if (e instanceof HttpError && e.status === 404) {
      const gone = { ...b, state: 'expired' as const, error: 'Gemini no longer has this batch (deleted, expired, or created with a different API key)', checkedAt: now, finishedAt: now, applied: true };
      await save(gone);
      return { ...gone, appliedCount: 0, failedSymbols: [] };
    }
    // Offline, invalid key, rate limit…: keep the job and try again later.
    throw e;
  }

  const next: BatchRecord = { ...b, state: info.state, stats: info.stats ?? b.stats, error: info.error, checkedAt: now };
  if (!FINAL_BATCH_STATES.includes(info.state)) {
    await save(next);
    return null;
  }

  let appliedCount = 0;
  const failedSymbols: string[] = [];
  if (info.results) {
    const prompts = await getPrompts();
    const expected = new Set(b.symbols);
    for (const r of info.results) {
      if (!expected.has(r.key)) continue;
      try {
        if (!r.value) throw new Error(r.error ?? 'No answer');
        await applyAnalysis(r.key, r.value, b.model, prompts);
        appliedCount++;
      } catch (e) {
        failedSymbols.push(r.key);
        await updateStock(r.key, { llm_error: `Batch: ${e instanceof Error ? e.message : String(e)}` }).catch(() => {});
      }
    }
  }
  const done = { ...next, finishedAt: now, applied: true };
  await save(done);
  return { ...done, appliedCount, failedSymbols };
}

let inflight: Promise<BatchCheck> | null = null;

/** Polls every unfinished job and applies the results of those that completed. Concurrent calls share one run. */
export function checkBatches(key: string): Promise<BatchCheck> {
  return (inflight ??= (async () => {
    const finished: BatchCheck['finished'] = [];
    if (!key) return { finished };
    const open = (await listBatches()).filter(isOpen);
    for (const b of open) {
      try {
        const result = await checkOne(b, key);
        if (result) finished.push(result);
      } catch (e) {
        console.warn(`[batch] check ${b.id}:`, e instanceof Error ? e.message : e);
      }
    }
    return { finished };
  })().finally(() => {
    inflight = null;
  }));
}

export async function cancelBatch(id: string, key: string): Promise<void> {
  const row = await get<BatchRow>('SELECT * FROM llm_batches WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'Batch not found');
  try {
    await cancelRemote(key, id);
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 404)) throw e;
  }
  const now = new Date().toISOString();
  await save({ ...toRecord(row), state: 'cancelled', checkedAt: now, finishedAt: now, applied: true });
}
