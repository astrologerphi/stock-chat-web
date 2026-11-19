import { HttpError } from './util.ts';

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
  return new HttpError(res.status === 400 || res.status === 403 ? res.status : 502, message);
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
    .map((m) => ({ id: m.name.replace(/^models\//, ''), displayName: m.displayName ?? m.name, outputTokenLimit: m.outputTokenLimit ?? 0 }))
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}

export async function generateJson<T>(opts: {
  key: string;
  model: string;
  system: string;
  prompt: string;
  schema: object;
  maxOutputTokens?: number;
  thinking?: ThinkingLevel;
}): Promise<T> {
  requireKey(opts.key);
  const model = (opts.model || DEFAULT_MODEL).replace(/^models\//, '');
  const request = (thinking: object | undefined) =>
    fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': opts.key, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(300_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: opts.schema,
          maxOutputTokens: opts.maxOutputTokens ?? 60_000,
          temperature: 0.7,
          ...(thinking ? { thinkingConfig: thinking } : {}),
        },
      }),
    });
  const thinking = thinkingConfig(model, opts.thinking);
  let res = await request(thinking);
  if (!res.ok && thinking && res.status === 400) {
    // Not every model supports every level (e.g. "minimal" on Pro models); fall back to the model's default.
    const err = await geminiError(res);
    if (!/thinking/i.test(err.message)) throw err;
    res = await request(undefined);
  }
  if (!res.ok) throw await geminiError(res);
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
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
