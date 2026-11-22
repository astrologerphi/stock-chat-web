export interface ScoreEntry {
  score: number;
  reason: string;
}

export interface Diagram {
  promptId: string;
  title: string;
  horizontal: string;
  vertical: string;
}

export interface Leader {
  name: string;
  title: string;
  pay: number | null;
  currencyPay: string | null;
  gender: string | null;
  yearBorn: number | null;
}

export interface StockRow {
  symbol: string;
  name: string;
  image: string;
  exchange: string;
  exchangeFullName: string;
  country: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  price: number | null;
  floatShares: number | null;
  outstandingShares: number | null;
  floatRatio: number | null;
  heat: number | null;
  heatUpdatedAt: string | null;
  scores: Record<string, number>;
  tags: string[];
  lastLlmRunAt: string | null;
  starred: boolean;
}

export interface StockDetail extends Omit<StockRow, 'scores'> {
  isEtf: boolean;
  scores: Record<string, ScoreEntry>;
  description: string;
  website: string;
  ceo: string;
  employees: number | null;
  ipoDate: string;
  changePercentage: number | null;
  range: string;
  leaders: Leader[];
  profileUpdatedAt: string | null;
  introduction: string;
  diagrams: Diagram[];
  llmModel: string | null;
  llmError: string | null;
}

/** One end-of-day close. */
export interface PricePoint {
  date: string;
  price: number;
}

/** Where a holding links to when it is also in the local database. */
export type HoldingLink = 'stock' | 'etf' | null;

export interface EtfHolding {
  asset: string;
  name: string;
  weight: number | null;
  shares: number | null;
  marketValue: number | null;
  image: string;
  link: HoldingLink;
}

export interface EtfHoldings {
  holdings: EtfHolding[];
  updatedAt: string | null;
}

export interface EtfInfo {
  description: string;
  issuer: string;
  assetClass: string;
  expenseRatio: number | null;
  aum: number | null;
  nav: number | null;
  avgVolume: number | null;
  holdingsCount: number | null;
  inceptionDate: string;
  website: string;
  sectors: { name: string; weight: number }[];
}

export interface ListResponse {
  items: StockRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Facet {
  value: string;
  count: number;
}

export interface TagInfo {
  name: string;
  /** Active companies carrying the tag. */
  count: number;
  /** Deleted by the user; LLM runs will not add it again until it is restored. */
  blocked: boolean;
  createdAt: string;
}

export interface PromptItem {
  id: string;
  title: string;
  description: string;
}

export interface PromptConfig {
  scorePrompts: PromptItem[];
  svgPrompts: PromptItem[];
  introPrompt: string;
}

export type TaskState = 'queued' | 'running' | 'done' | 'error';

/** `analysis` = scores, tags and introduction; `diagrams` = SVG diagrams only. */
export type TaskKind = 'analysis' | 'diagrams';

export interface TaskStatus {
  symbol: string;
  kind: TaskKind;
  state: TaskState;
  error?: string;
  updatedAt: string;
}

/** Which list a query or job is about: operating companies or exchange-traded funds. */
export type ListKind = 'stocks' | 'etfs';

export interface HeatJobStatus {
  kind: ListKind;
  running: boolean;
  /** Symbols processed so far, out of `total` (those not refreshed in the last hour). */
  done: number;
  total: number;
  updated: number;
  failed: number;
  /** Symbols left out because their heat was refreshed in the last hour. */
  skipped: number;
  cancelled: boolean;
  error: string | null;
  finishedAt: string | null;
}

export interface SyncStatus {
  running: boolean;
  phase: string;
  progress: number;
  lastSyncedAt: string | null;
  error: string | null;
  /** Active stocks (companies). */
  total: number;
  /** Active ETFs. */
  etfs: number;
}

export type SortKey = 'marketCap' | 'heat' | 'floatRatio' | 'lastLlmRunAt' | 'symbol' | `score:${string}`;

export type BatchState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

/** A Gemini Batch API analysis job, persisted so its results are fetched even after the page was closed. */
export interface BatchRecord {
  /** Gemini operation name, e.g. `batches/abc123`. */
  id: string;
  model: string;
  thinking: string;
  symbols: string[];
  state: BatchState;
  stats: { total: number; succeeded: number; failed: number; pending: number } | null;
  error: string | null;
  createdAt: string;
  checkedAt: string | null;
  finishedAt: string | null;
  /** Results have been written to the stocks (or the job ended without any). */
  applied: boolean;
}

/** One stock's request in a batch that is being reviewed before submission. */
export interface BatchDraftItem {
  symbol: string;
  name: string;
  prompt: string;
  newsCount: number;
  approxTokens: number;
}

export interface BatchDraft {
  model: string;
  thinking: string;
  system: string;
  schema: object;
  items: BatchDraftItem[];
  /** Symbols left out of the draft, with the reason. */
  skipped: { symbol: string; reason: string }[];
}
