import { HttpError } from './util.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.8-flash';

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
}): Promise<T> {
  requireKey(opts.key);
  const model = (opts.model || DEFAULT_MODEL).replace(/^models\//, '');
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
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
      },
    }),
  });
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
