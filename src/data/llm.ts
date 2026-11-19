import { transaction, type StockDoc } from './db.ts';
import { Fmp, type FmpNews } from './fmp.ts';
import { generateJson } from './gemini.ts';
import { getPrompts } from './prompts.ts';
import { mergeTags, normalizeTags, refreshProfile, replaceTags, updateStock } from './stocks.ts';
import { isoDate } from './util.ts';
import type { Diagram, PromptConfig, TaskKind, TaskStatus } from '../types.ts';

interface Keys {
  gemini: string;
  fmp: string;
  model: string;
}

interface LlmResult {
  scores?: { id: string; score: number; reason: string }[];
  tags?: string[];
  introduction?: string;
  diagrams?: { id: string; horizontalSvg: string; verticalSvg: string }[];
}

const CONCURRENCY = 3;
const KEEP_FINISHED_MS = 15 * 60_000;
const tasks = new Map<string, TaskStatus>();
const queue: { symbol: string; kind: TaskKind; keys: Keys }[] = [];
let running = 0;

export function getTaskStatuses(): TaskStatus[] {
  const now = Date.now();
  for (const [key, t] of tasks) {
    if ((t.state === 'done' || t.state === 'error') && now - Date.parse(t.updatedAt) > KEEP_FINISHED_MS) tasks.delete(key);
  }
  return [...tasks.values()];
}

function setTask(symbol: string, kind: TaskKind, state: TaskStatus['state'], error?: string) {
  tasks.set(`${kind}:${symbol}`, { symbol, kind, state, error, updatedAt: new Date().toISOString() });
}

/** Analysis (scores, tags, introduction) and diagrams are separate jobs that write independent columns. */
export function enqueue(symbols: string[], keys: Keys, kind: TaskKind = 'analysis'): number {
  let added = 0;
  for (const symbol of new Set(symbols)) {
    const state = tasks.get(`${kind}:${symbol}`)?.state;
    if (state === 'queued' || state === 'running') continue;
    setTask(symbol, kind, 'queued');
    queue.push({ symbol, kind, keys });
    added++;
  }
  pump();
  return added;
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    running++;
    setTask(job.symbol, job.kind, 'running');
    (job.kind === 'diagrams' ? runDiagrams : runAnalysis)(job.symbol, job.keys)
      .then(() => setTask(job.symbol, job.kind, 'done'))
      .catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[llm] ${job.kind} ${job.symbol}:`, message);
        setTask(job.symbol, job.kind, 'error', message);
        if (job.kind === 'analysis') await updateStock(job.symbol, { llm_error: message }).catch(() => {});
      })
      .finally(() => {
        running--;
        pump();
      });
  }
}

const PALETTE = `Canvas background #0E1013 (fill the whole viewBox with it). Panels #161A21 with #262B35 1px strokes and generous corner radii (16–24).
Text: primary #EDE9E1, secondary #9AA0AA. Accents: chartreuse #C8F560, mint #5EE6C4, coral #FF8A5B, periwinkle #8AB4FF, amber #F5C45E.
Fonts (system sans-serif only, never serif): font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" everywhere; titles font-weight="600" with slightly tight letter-spacing.`;

const SYSTEM_ANALYSIS = `You are a senior equity research analyst.
You analyse US-listed companies using only the supplied context plus well-established public knowledge, and you are calibrated, specific and concise.
You return a single JSON object that strictly follows the provided JSON schema.`;

const SYSTEM_DIAGRAMS = `You are a world-class information designer with deep equity research knowledge.
You turn the supplied company context plus well-established public knowledge into accurate, elegant SVG diagrams.
You return a single JSON object that strictly follows the provided JSON schema.`;

function trimNews(news: FmpNews[]): string {
  return news
    .slice(0, 40)
    .map((n) => `- [${n.publishedDate.slice(0, 10)}] ${n.title} (${n.site})${n.text ? ` — ${n.text.slice(0, 280)}` : ''}`)
    .join('\n');
}

function buildContext(stock: StockDoc, news: FmpNews[]): string[] {
  const facts = {
    symbol: stock.symbol,
    name: stock.name,
    exchange: stock.exchangeFullName || stock.exchange,
    country: stock.country,
    sector: stock.sector,
    industry: stock.industry,
    marketCapUSD: stock.marketCap,
    price: stock.price,
    changePercentToday: stock.changePercentage,
    fiftyTwoWeekRange: stock.profile?.range,
    floatShares: stock.floatShares,
    outstandingShares: stock.outstandingShares,
    newsCountLast30Days: stock.heat,
    ceo: stock.profile?.ceo,
    employees: stock.profile?.employees,
    ipoDate: stock.profile?.ipoDate,
    website: stock.profile?.website,
    leaders: stock.leaders.slice(0, 10).map((l) => `${l.name} — ${l.title}`),
  };

  return [
    `# Company context (today is ${isoDate(new Date())})`,
    '```json',
    JSON.stringify(facts, null, 2),
    '```',
    '## Business description',
    stock.profile?.description || '(not available)',
    '## Recent news (most recent first)',
    news.length ? trimNews(news) : '(no recent news)',
  ];
}

function buildAnalysisPrompt(stock: StockDoc, news: FmpNews[], prompts: PromptConfig): string {
  const sections = [...buildContext(stock, news), '# Tasks'];
  if (prompts.scorePrompts.length) {
    sections.push(
      '## 1. Scores',
      'For EACH criterion below return an object {"id", "score", "reason"}. "score" is an integer from 0 (none) to 10 (exceptional); use the full range and be calibrated. "reason" is 1–2 crisp sentences grounded in the context.',
      ...prompts.scorePrompts.map((p) => `- id "${p.id}" — ${p.title}: ${p.description}`),
    );
  }
  sections.push(
    '## 2. Tags',
    'Return 4–8 short tags (1–3 words each, Title Case) capturing the company’s products, themes, narratives and market positioning. Avoid generic tags such as the sector name alone.',
    '## 3. Introduction',
    `${prompts.introPrompt || 'Write a concise introduction to this company.'} Use markdown (##/### headings, **bold**, bullet lists). Do not include a top-level title.`,
  );
  return sections.join('\n\n');
}

function buildDiagramPrompt(stock: StockDoc, news: FmpNews[], prompts: PromptConfig): string {
  return [
    ...buildContext(stock, news),
    '# Task: SVG diagrams',
    `For EACH diagram below return {"id", "horizontalSvg", "verticalSvg"}: two complete, standalone SVG documents showing the same content.
- horizontalSvg: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"> laid out for wide desktop screens.
- verticalSvg: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1600"> re-composed (not just rotated) for tall phone screens.
Rules: no width/height attributes, no <script>, no <foreignObject>, no external images, fonts or links; only inline SVG shapes, paths, gradients and text.
Keep every text element fully inside the viewBox with ample padding; minimum font size 22; never let text overlap. Include a title at the top and a one-line takeaway.
Style: elegant, editorial, modern data-visualisation with clear hierarchy and whitespace. ${PALETTE}`,
    ...prompts.svgPrompts.map((p) => `- id "${p.id}" — ${p.title}: ${p.description}`),
  ].join('\n\n');
}

function buildAnalysisSchema(prompts: PromptConfig): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  if (prompts.scorePrompts.length) {
    properties.scores = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: prompts.scorePrompts.map((p) => p.id) },
          score: { type: 'integer', minimum: 0, maximum: 10 },
          reason: { type: 'string' },
        },
        required: ['id', 'score', 'reason'],
      },
    };
    required.push('scores');
  }
  properties.tags = { type: 'array', items: { type: 'string' } };
  properties.introduction = { type: 'string' };
  required.push('tags', 'introduction');
  return { type: 'object', properties, required };
}

function buildDiagramSchema(prompts: PromptConfig): object {
  return {
    type: 'object',
    properties: {
      diagrams: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: prompts.svgPrompts.map((p) => p.id) },
            horizontalSvg: { type: 'string' },
            verticalSvg: { type: 'string' },
          },
          required: ['id', 'horizontalSvg', 'verticalSvg'],
        },
      },
    },
    required: ['diagrams'],
  };
}

/** Defensive cleanup: diagrams are rendered via <img>, but never store active content. */
export function sanitizeSvg(raw: string): string {
  const match = /<svg[\s\S]*<\/svg>/i.exec(raw ?? '');
  if (!match) return '';
  let svg = match[0]
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href\s*=\s*)("|')\s*(?!#)[^"']*\2/gi, '$1$2#$2');
  if (!/xmlns=/.test(svg.slice(0, 300))) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

async function loadContext(symbol: string, keys: Keys, force: boolean) {
  const fmp = new Fmp(keys.fmp);
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const [stock, news] = await Promise.all([
    refreshProfile(fmp, symbol, { force }),
    fmp.news(symbol, { from: isoDate(from), to: isoDate(to), limit: 40 }).catch(() => [] as FmpNews[]),
  ]);
  if (!stock) throw new Error(`Unknown symbol ${symbol}`);
  return { stock, news };
}

async function runAnalysis(symbol: string, keys: Keys) {
  const prompts = await getPrompts();
  const { stock, news } = await loadContext(symbol, keys, true);

  const result = await generateJson<LlmResult>({
    key: keys.gemini,
    model: keys.model,
    system: SYSTEM_ANALYSIS,
    prompt: buildAnalysisPrompt(stock, news, prompts),
    schema: buildAnalysisSchema(prompts),
  });

  const scores = new Map<string, { score: number; reason: string }>();
  for (const s of result.scores ?? []) {
    if (!prompts.scorePrompts.some((p) => p.id === s.id)) continue;
    const score = Math.max(0, Math.min(10, Math.round(Number(s.score))));
    if (Number.isFinite(score)) scores.set(s.id, { score, reason: String(s.reason ?? '').trim() });
  }

  const llmTags = normalizeTags(result.tags ?? []).slice(0, 10);
  await transaction(async (db) => {
    await updateStock(
      symbol,
      {
        llm_tags: JSON.stringify(llmTags),
        introduction: String(result.introduction ?? '').trim(),
        last_llm_run_at: new Date().toISOString(),
        llm_model: keys.model,
        llm_error: null,
      },
      db,
    );
    // Scores for prompts that were not part of this run are kept.
    if (scores.size) {
      await db.run(
        `INSERT INTO stock_scores (symbol, prompt_id, score, reason) VALUES ${[...scores].map(() => '(?, ?, ?, ?)').join(', ')}
         ON CONFLICT(symbol, prompt_id) DO UPDATE SET score = excluded.score, reason = excluded.reason`,
        ...[...scores].flatMap(([id, s]) => [symbol, id, s.score, s.reason]),
      );
    }
    await replaceTags(db, symbol, mergeTags(llmTags, stock.tagEdits), 'llm');
  });
}

async function runDiagrams(symbol: string, keys: Keys) {
  const prompts = await getPrompts();
  if (!prompts.svgPrompts.length) throw new Error('No diagram prompts configured. Add one on the Prompts page.');
  const { stock, news } = await loadContext(symbol, keys, false);

  const result = await generateJson<LlmResult>({
    key: keys.gemini,
    model: keys.model,
    system: SYSTEM_DIAGRAMS,
    prompt: buildDiagramPrompt(stock, news, prompts),
    schema: buildDiagramSchema(prompts),
  });

  const diagrams: Diagram[] = [];
  for (const p of prompts.svgPrompts) {
    const d = result.diagrams?.find((x) => x.id === p.id);
    if (!d) continue;
    const horizontal = sanitizeSvg(d.horizontalSvg);
    const vertical = sanitizeSvg(d.verticalSvg);
    if (horizontal || vertical) diagrams.push({ promptId: p.id, title: p.title, horizontal, vertical });
  }
  if (!diagrams.length) throw new Error('Gemini returned no usable diagrams');
  await updateStock(symbol, { diagrams: JSON.stringify(diagrams) });
}
