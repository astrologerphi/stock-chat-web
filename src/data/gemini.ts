import { HttpError } from './util.ts';
import type { BatchState } from '../types.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.8-flash';

export const THINKING_LEVELS = ['default', 'minimal', 'low', 'medium', 'high'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Gemini 2.x has no thinking levels, only a token budget. */
export const usesThinkingBudget = (model: string) => /^(models\/)?gemini-2\./i.test(model);

const BUDGETS: Record<Exclude<ThinkingLevel, 'default'>, number> = { minimal: 0, low: 1024, medium: 8192, high: 24576 };

/** Maps a level to the model family's thinkingConfig; 'default' leaves the choice to the model. */
export function thinkingConfig(model: string, level: ThinkingLevel | undefined): object | undefined {
  if (!level || level === 'default' || !THINKING_LEVELS.includes(level)) return undefined;
  if (!usesThinkingBudget(model)) return { thinkingLevel: level };
  // 2.5 Pro can't switch thinking off; 128 is its minimum budget.
  if (level === 'minimal' && /pro/i.test(model)) return { thinkingBudget: 128 };
  return { thinkingBudget: BUDGETS[level] };
}

export interface GeminiModel {
  id: string;
  displayName: string;
  outputTokenLimit: number;
  /** Accepts Batch API jobs (`batchGenerateContent`). */
  batch: boolean;
}

interface RawModel {
  name: string;
  displayName?: string;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

function requireKey(key: string) {
  if (!key) throw new HttpError(400, 'Gemini API key is missing. Add it in Settings.');
}

async function geminiError(res: Response): Promise<HttpError> {
  let message = `Gemini request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) message = `Gemini: ${body.error.message}`;
  } catch {
    /* keep default message */
  }
  return new HttpError([400, 403, 404, 429].includes(res.status) ? res.status : 502, message);
}

const EXCLUDED = /(tts|image|robotics|computer-use|transcribe|embedding|lyria|banana|deep-research|antigravity|live|audio)/i;

export async function listModels(key: string): Promise<GeminiModel[]> {
  requireKey(key);
  const res = await fetch(`${BASE}/models?pageSize=1000`, {
    headers: { 'x-goog-api-key': key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw await geminiError(res);
  const body = (await res.json()) as { models?: RawModel[] };
  return (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/i.test(m.name) && !EXCLUDED.test(m.name))
    .map((m) => ({
      id: m.name.replace(/^models\//, ''),
      displayName: m.displayName ?? m.name,
      outputTokenLimit: m.outputTokenLimit ?? 0,
      batch: !!m.supportedGenerationMethods?.includes('batchGenerateContent'),
    }))
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}

export interface JsonRequest {
  system: string;
  prompt: string;
  schema: object;
  maxOutputTokens?: number;
}

const modelId = (model: string) => (model || DEFAULT_MODEL).replace(/^models\//, '');

/** A `GenerateContentRequest` that asks for JSON matching `schema`. */
function contentRequest(opts: JsonRequest, thinking: object | undefined) {
  return {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: opts.schema,
      maxOutputTokens: opts.maxOutputTokens ?? 60_000,
      temperature: 0.7,
      ...(thinking ? { thinkingConfig: thinking } : {}),
    },
  };
}

interface ContentResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

function parseJsonResponse<T>(body: ContentResponse): T {
  const candidate = body.candidates?.[0];
  if (!candidate) throw new HttpError(502, `Gemini returned no answer${body.promptFeedback?.blockReason ? ` (${body.promptFeedback.blockReason})` : ''}`);
  const text = (candidate.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join('');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, `Gemini returned malformed JSON (finish reason: ${candidate.finishReason ?? 'unknown'})`);
  }
}

/**
 * Sends a request with the chosen thinking level. Not every model supports every level (e.g. "minimal"
 * on Pro models), so a 400 about thinking is retried with the model's default.
 */
async function withThinkingFallback(model: string, level: ThinkingLevel | undefined, send: (thinking: object | undefined) => Promise<Response>) {
  const thinking = thinkingConfig(model, level);
  let res = await send(thinking);
  if (!res.ok && thinking && res.status === 400) {
    const err = await geminiError(res);
    if (!/thinking/i.test(err.message)) throw err;
    res = await send(undefined);
  }
  if (!res.ok) throw await geminiError(res);
  return res;
}

export async function generateJson<T>(opts: JsonRequest & { key: string; model: string; thinking?: ThinkingLevel }): Promise<T> {
  requireKey(opts.key);
  const model = modelId(opts.model);
  const res = await withThinkingFallback(model, opts.thinking, (thinking) =>
    fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': opts.key, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(300_000),
      body: JSON.stringify(contentRequest(opts, thinking)),
    }),
  );
  return parseJsonResponse<T>((await res.json()) as ContentResponse);
}

/* ---------- Batch API: jobs run on Google's side, so the page may close while they do ---------- */

export const FINAL_BATCH_STATES: readonly BatchState[] = ['succeeded', 'failed', 'cancelled', 'expired'];

export interface BatchStats {
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
}

export interface BatchInfo<T> {
  /** Operation name, e.g. `batches/abc123`. */
  id: string;
  state: BatchState;
  stats: BatchStats | null;
  error: string | null;
  /** Present once the batch succeeded: one entry per request, matched by its key. */
  results: { key: string; value?: T; error?: string }[] | null;
}

interface RawStatus {
  code?: number;
  message?: string;
}

interface RawInlined {
  metadata?: { key?: string };
  key?: string;
  response?: ContentResponse;
  error?: RawStatus;
}

interface RawBatch {
  name?: string;
  state?: string;
  batchStats?: { requestCount?: string; successfulRequestCount?: string; failedRequestCount?: string; pendingRequestCount?: string };
  output?: RawOutput;
}

interface RawOutput {
  inlinedResponses?: { inlinedResponses?: RawInlined[] } | RawInlined[];
  responsesFile?: string;
}

interface RawOperation {
  name?: string;
  done?: boolean;
  metadata?: RawBatch;
  response?: RawOutput;
  error?: RawStatus;
}

function batchState(raw: string | undefined): BatchState {
  const s = (raw ?? '').replace(/^(BATCH|JOB)_STATE_/, '').toLowerCase();
  return s === 'running' || s === 'succeeded' || s === 'failed' || s === 'cancelled' || s === 'expired' ? s : 'pending';
}

function batchStats(raw: RawBatch['batchStats']): BatchStats | null {
  if (!raw) return null;
  const n = (v: string | undefined) => Number(v ?? 0) || 0;
  return { total: n(raw.requestCount), succeeded: n(raw.successfulRequestCount), failed: n(raw.failedRequestCount), pending: n(raw.pendingRequestCount) };
}

function readInlined<T>(items: RawInlined[], keys: readonly string[]): BatchInfo<T>['results'] {
  // Responses come back in request order; the metadata key is preferred when present.
  return items.map((item, i) => {
    const key = item.metadata?.key ?? item.key ?? keys[i] ?? String(i);
    if (item.error) return { key, error: item.error.message || `Request failed (code ${item.error.code ?? '?'})` };
    if (!item.response) return { key, error: 'Gemini returned no response' };
    try {
      return { key, value: parseJsonResponse<T>(item.response) };
    } catch (e) {
      return { key, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Submits one JSON request per item as a single batch job. */
export async function createBatch(opts: {
  key: string;
  model: string;
  thinking?: ThinkingLevel;
  displayName: string;
  system: string;
  schema: object;
  items: { key: string; prompt: string }[];
}): Promise<BatchInfo<never>> {
  requireKey(opts.key);
  const model = modelId(opts.model);
  const res = await withThinkingFallback(model, opts.thinking, (thinking) =>
    fetch(`${BASE}/models/${encodeURIComponent(model)}:batchGenerateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': opts.key, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        batch: {
          displayName: opts.displayName,
          inputConfig: {
            requests: {
              requests: opts.items.map((item) => ({
                request: { model: `models/${model}`, ...contentRequest({ system: opts.system, prompt: item.prompt, schema: opts.schema }, thinking) },
                metadata: { key: item.key },
              })),
            },
          },
        },
      }),
    }),
  );
  const op = (await res.json()) as RawOperation;
  const id = op.name ?? op.metadata?.name;
  if (!id) throw new HttpError(502, 'Gemini did not return a batch id');
  return { id, state: batchState(op.metadata?.state), stats: batchStats(op.metadata?.batchStats), error: null, results: null };
}

/** Reads a batch job; `keys` (request order) is the fallback when responses carry no metadata. */
export async function getBatch<T>(key: string, id: string, keys: readonly string[] = []): Promise<BatchInfo<T>> {
  requireKey(key);
  const res = await fetch(`${BASE}/${id}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw await geminiError(res);
  const op = (await res.json()) as RawOperation;
  const meta = op.metadata ?? {};
  const state = op.error ? 'failed' : batchState(meta.state);
  const info: BatchInfo<T> = { id, state, stats: batchStats(meta.batchStats), error: op.error?.message ?? null, results: null };
  if (state !== 'succeeded') return info;

  const output = op.response ?? meta.output ?? {};
  const inlined = Array.isArray(output.inlinedResponses) ? output.inlinedResponses : output.inlinedResponses?.inlinedResponses;
  if (inlined) {
    info.results = readInlined<T>(inlined, keys);
  } else if (output.responsesFile) {
    const file = await fetch(`${BASE.replace('/v1beta', '/download/v1beta')}/${output.responsesFile}:download?alt=media`, {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(120_000),
    });
    if (!file.ok) throw await geminiError(file);
    const lines = (await file.text()).split('\n').filter((l) => l.trim());
    info.results = readInlined<T>(lines.map((l) => JSON.parse(l) as RawInlined), keys);
  } else {
    info.results = [];
  }
  return info;
}

export async function cancelBatch(key: string, id: string): Promise<void> {
  requireKey(key);
  const res = await fetch(`${BASE}/${id}:cancel`, { method: 'POST', headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw await geminiError(res);
}
