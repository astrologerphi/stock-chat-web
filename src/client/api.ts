import { getSettings } from './settings.ts';
import type {
  Facet,
  ListResponse,
  PromptConfig,
  StockDetail,
  SyncStatus,
  TaskStatus,
} from '../shared/types.ts';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, overrides: Record<string, string> = {}): Promise<T> {
  const s = getSettings();
  const headers: Record<string, string> = {
    'x-fmp-key': s.fmpKey,
    'x-gemini-key': s.geminiKey,
    'x-gemini-model': s.geminiModel,
    ...overrides,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

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

export const api = {
  list(p: ListParams) {
    const qs = new URLSearchParams({
      page: String(p.page),
      pageSize: String(p.pageSize),
      sort: p.sort,
      order: p.order,
      q: p.q,
      exchange: p.exchange.join(','),
      country: p.country.join(','),
      tags: p.tags.join(','),
    });
    return request<ListResponse>('GET', `/stocks?${qs}`);
  },
  heat: (symbols: string[]) => request<{ symbol: string; heat: number | null }[]>('POST', '/stocks/heat', { symbols }),
  detail: (symbol: string) => request<StockDetail>('GET', `/stocks/${encodeURIComponent(symbol)}`),
  setTags: (symbol: string, tags: string[]) => request<{ tags: string[] }>('PUT', `/stocks/${encodeURIComponent(symbol)}/tags`, { tags }),
  countries: () => request<Facet[]>('GET', '/facets/countries'),
  exchanges: () => request<Facet[]>('GET', '/facets/exchanges'),
  tags: () => request<Facet[]>('GET', '/facets/tags'),
  prompts: () => request<PromptConfig>('GET', '/prompts'),
  savePrompts: (p: PromptConfig) => request<PromptConfig>('PUT', '/prompts', p),
  syncStatus: () => request<SyncStatus>('GET', '/sync'),
  startSync: () => request<SyncStatus>('POST', '/sync').catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 409) return api.syncStatus();
    throw e;
  }),
  runLlm: (symbols: string[]) => request<{ queued: number; tasks: TaskStatus[] }>('POST', '/llm/run', { symbols }),
  llmStatus: () => request<TaskStatus[]>('GET', '/llm/status'),
  models: (key: string) => request<{ id: string; displayName: string }[]>('GET', '/gemini/models', undefined, { 'x-gemini-key': key }),
  testGemini: (key: string, model: string) =>
    request<{ latencyMs: number; modelCount: number; modelAvailable: boolean }>('POST', '/test/gemini', {}, { 'x-gemini-key': key, 'x-gemini-model': model }),
  testFmp: (key: string) => request<{ ok: boolean; latencyMs: number }>('POST', '/test/fmp', {}, { 'x-fmp-key': key }),
};
