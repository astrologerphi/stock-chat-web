import express, { type NextFunction, type Request, type Response } from 'express';
import { Fmp } from './fmp.ts';
import { DEFAULT_MODEL, listModels } from './gemini.ts';
import { enqueue, getTaskStatuses } from './llm.ts';
import { getPrompts, savePrompts } from './prompts.ts';
import { countryFacets, exchangeFacets, getDetail, listStocks, refreshHeat, setTags, tagFacets } from './stocks.ts';
import { getSyncStatus, startSync } from './sync.ts';
import { HttpError } from './util.ts';

/** Secrets live in the browser's localStorage and arrive per request; they are never persisted server-side. */
const fmpKey = (req: Request) => String(req.get('x-fmp-key') ?? '').trim();
const geminiKey = (req: Request) => String(req.get('x-gemini-key') ?? '').trim();
const geminiModel = (req: Request) => String(req.get('x-gemini-model') ?? '').trim() || DEFAULT_MODEL;

const list = (v: unknown): string[] =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);

const symbolParam = (req: Request) => {
  const symbol = String(req.params.symbol ?? '').toUpperCase();
  if (!/^[A-Z0-9.\-^]{1,15}$/.test(symbol)) throw new HttpError(400, 'Invalid symbol');
  return symbol;
};

export const api = express.Router();
api.use(express.json({ limit: '1mb' }));

api.get('/stocks', async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(5, Number.parseInt(String(req.query.pageSize ?? '25'), 10) || 25));
  res.json(
    await listStocks({
      page,
      pageSize,
      sort: String(req.query.sort ?? 'marketCap'),
      order: req.query.order === 'asc' ? 'asc' : 'desc',
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      exchanges: list(req.query.exchange),
      countries: list(req.query.country),
      tags: list(req.query.tags),
    }),
  );
});

api.post('/stocks/heat', async (req, res) => {
  const symbols = Array.isArray(req.body?.symbols) ? req.body.symbols.map(String) : [];
  res.json(await refreshHeat(new Fmp(fmpKey(req)), symbols));
});

api.get('/stocks/:symbol', async (req, res) => {
  const key = fmpKey(req);
  const detail = await getDetail(key ? new Fmp(key) : null, symbolParam(req));
  if (!detail) throw new HttpError(404, 'Stock not found');
  res.json(detail);
});

api.put('/stocks/:symbol/tags', async (req, res) => {
  const tags = await setTags(symbolParam(req), Array.isArray(req.body?.tags) ? req.body.tags : []);
  if (!tags) throw new HttpError(404, 'Stock not found');
  res.json({ tags });
});

api.get('/facets/countries', async (_req, res) => res.json(await countryFacets()));
api.get('/facets/exchanges', async (_req, res) => res.json(await exchangeFacets()));
api.get('/facets/tags', async (_req, res) => res.json(await tagFacets()));

api.get('/prompts', async (_req, res) => res.json(await getPrompts()));
api.put('/prompts', async (req, res) => res.json(await savePrompts(req.body ?? {})));

api.get('/sync', async (_req, res) => res.json(await getSyncStatus()));
api.post('/sync', async (req, res) => {
  const started = startSync(fmpKey(req));
  res.status(started ? 202 : 409).json(await getSyncStatus());
});

api.post('/llm/run', (req, res) => {
  const symbols: string[] = Array.isArray(req.body?.symbols) ? req.body.symbols.map(String).slice(0, 200) : [];
  if (!symbols.length) throw new HttpError(400, 'No symbols provided');
  const keys = { gemini: geminiKey(req), fmp: fmpKey(req), model: geminiModel(req) };
  if (!keys.gemini) throw new HttpError(400, 'Gemini API key is missing. Add it in Settings.');
  if (!keys.fmp) throw new HttpError(400, 'FMP API key is missing. Add it in Settings.');
  res.status(202).json({ queued: enqueue(symbols, keys), tasks: getTaskStatuses() });
});
api.get('/llm/status', (_req, res) => res.json(getTaskStatuses()));

api.get('/gemini/models', async (req, res) => res.json(await listModels(geminiKey(req))));

api.post('/test/gemini', async (req, res) => {
  const started = performance.now();
  const models = await listModels(geminiKey(req));
  const model = geminiModel(req);
  res.json({
    ok: true,
    latencyMs: Math.round(performance.now() - started),
    modelCount: models.length,
    modelAvailable: models.some((m) => m.id === model),
  });
});

api.post('/test/fmp', async (req, res) => {
  const started = performance.now();
  const profile = await new Fmp(fmpKey(req)).profile('AAPL');
  res.json({ ok: !!profile, latencyMs: Math.round(performance.now() - started) });
});

api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));

api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : 'Unexpected error';
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: message });
});
