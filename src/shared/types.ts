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

export interface TaskStatus {
  symbol: string;
  state: TaskState;
  error?: string;
  updatedAt: string;
}

export interface SyncStatus {
  running: boolean;
  phase: string;
  progress: number;
  lastSyncedAt: string | null;
  error: string | null;
  total: number;
}

export type SortKey = 'marketCap' | 'heat' | 'floatRatio' | 'lastLlmRunAt' | 'symbol' | `score:${string}`;
