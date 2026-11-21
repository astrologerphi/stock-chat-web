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
}

export interface StockDetail extends Omit<StockRow, 'scores'> {
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
