import type { Database } from '@tursodatabase/database-wasm';
import type { Diagram, Leader } from '../types.ts';

/** SQLite file in the Origin Private File System (OPFS). Turso keeps `${DB_FILE}-wal` next to it. */
export const DB_FILE = 'meridian.db';
const TAB_LOCK = 'meridian.db';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stocks (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  exchange TEXT NOT NULL DEFAULT '',
  exchange_full_name TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  market_cap REAL,
  price REAL,
  change_percentage REAL,
  active INTEGER NOT NULL DEFAULT 1,
  float_shares REAL,
  outstanding_shares REAL,
  float_ratio REAL,
  heat INTEGER,
  heat_updated_at TEXT,
  profile TEXT NOT NULL DEFAULT '{}',
  leaders TEXT NOT NULL DEFAULT '[]',
  profile_updated_at TEXT,
  llm_tags TEXT NOT NULL DEFAULT '[]',
  tag_edits TEXT NOT NULL DEFAULT '{"added":[],"removed":[]}',
  introduction TEXT NOT NULL DEFAULT '',
  diagrams TEXT NOT NULL DEFAULT '[]',
  last_llm_run_at TEXT,
  llm_model TEXT,
  llm_error TEXT
);
CREATE INDEX IF NOT EXISTS stocks_market_cap ON stocks (active, market_cap);
CREATE INDEX IF NOT EXISTS stocks_heat ON stocks (active, heat);
CREATE INDEX IF NOT EXISTS stocks_float_ratio ON stocks (active, float_ratio);
CREATE INDEX IF NOT EXISTS stocks_last_llm_run_at ON stocks (active, last_llm_run_at);
CREATE INDEX IF NOT EXISTS stocks_country ON stocks (country);
CREATE INDEX IF NOT EXISTS stocks_exchange ON stocks (exchange);

CREATE TABLE IF NOT EXISTS stock_tags (
  symbol TEXT NOT NULL,
  tag TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (symbol, tag)
);
CREATE INDEX IF NOT EXISTS stock_tags_tag ON stock_tags (tag);

CREATE TABLE IF NOT EXISTS stock_scores (
  symbol TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (symbol, prompt_id)
);
CREATE INDEX IF NOT EXISTS stock_scores_prompt ON stock_scores (prompt_id, score);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export interface StockProfile {
  description?: string;
  website?: string;
  ceo?: string;
  employees?: number | null;
  ipoDate?: string;
  range?: string;
}

/** A `stocks` row with JSON columns decoded. Tags and scores live in `stock_tags` / `stock_scores`. */
export interface StockDoc {
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
  changePercentage: number | null;
  active: boolean;
  floatShares: number | null;
  outstandingShares: number | null;
  floatRatio: number | null;
  heat: number | null;
  heatUpdatedAt: string | null;
  profile: StockProfile;
  leaders: Leader[];
  profileUpdatedAt: string | null;
  llmTags: string[];
  tagEdits: { added: string[]; removed: string[] };
  introduction: string;
  diagrams: Diagram[];
  lastLlmRunAt: string | null;
  llmModel: string | null;
  llmError: string | null;
}

type Row = Record<string, unknown>;

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return (JSON.parse(value) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));

export function readStock(r: Row): StockDoc {
  return {
    symbol: str(r.symbol),
    name: str(r.name) || str(r.symbol),
    image: str(r.image),
    exchange: str(r.exchange),
    exchangeFullName: str(r.exchange_full_name),
    country: str(r.country),
    sector: str(r.sector),
    industry: str(r.industry),
    marketCap: num(r.market_cap),
    price: num(r.price),
    changePercentage: num(r.change_percentage),
    active: r.active == null ? true : Number(r.active) === 1,
    floatShares: num(r.float_shares),
    outstandingShares: num(r.outstanding_shares),
    floatRatio: num(r.float_ratio),
    heat: num(r.heat),
    heatUpdatedAt: strOrNull(r.heat_updated_at),
    profile: parseJson<StockProfile>(r.profile, {}),
    leaders: parseJson<Leader[]>(r.leaders, []),
    profileUpdatedAt: strOrNull(r.profile_updated_at),
    llmTags: parseJson<string[]>(r.llm_tags, []),
    tagEdits: parseJson(r.tag_edits, { added: [] as string[], removed: [] as string[] }),
    introduction: str(r.introduction),
    diagrams: parseJson<Diagram[]>(r.diagrams, []),
    lastLlmRunAt: strOrNull(r.last_llm_run_at),
    llmModel: strOrNull(r.llm_model),
    llmError: strOrNull(r.llm_error),
  };
}

export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** Holds a Web Lock for the page's lifetime: OPFS sync handles are exclusive, so only one tab may open the file. */
function acquireTabLock(): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void navigator.locks.request(TAB_LOCK, { ifAvailable: true }, (lock) => {
      resolve(lock != null);
      return lock ? new Promise<never>(() => {}) : undefined;
    });
  });
}

async function open(): Promise<Database> {
  if (!globalThis.crossOriginIsolated) {
    throw new Error(
      'The local database needs cross-origin isolation. Serve the app with “Cross-Origin-Opener-Policy: same-origin” and “Cross-Origin-Embedder-Policy: require-corp”.',
    );
  }
  if (!navigator.storage?.getDirectory) throw new Error('This browser does not support the Origin Private File System, which the local database needs.');
  if (!(await acquireTabLock())) throw new Error('Meridian is already open in another tab. Close it, then reload this page.');
  void navigator.storage.persist?.().catch(() => false);

  // Loaded lazily: the module fetches and instantiates the ~12 MB SQLite engine on import.
  const { connect } = await import('@tursodatabase/database-wasm');
  const db = await connect(DB_FILE);
  await db.exec(SCHEMA);
  return db;
}

let dbPromise: Promise<Database> | undefined;
export const getDb = () => (dbPromise ??= open());

export async function all<T = Row>(sql: string, ...args: unknown[]): Promise<T[]> {
  return (await getDb()).all(sql, ...args) as Promise<T[]>;
}

export async function get<T = Row>(sql: string, ...args: unknown[]): Promise<T | undefined> {
  return ((await (await getDb()).get(sql, ...args)) ?? undefined) as T | undefined;
}

/** Serialises writes so that statements never interleave with an open transaction. */
let writeTail: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeTail.then(fn);
  writeTail = result.catch(() => {});
  return result;
}

export const run = (sql: string, ...args: unknown[]) => exclusive(async () => (await getDb()).run(sql, ...args));

export function transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  return exclusive(async () => {
    const db = await getDb();
    await db.exec('BEGIN');
    try {
      const result = await fn(db);
      await db.exec('COMMIT');
      return result;
    } catch (err) {
      await db.exec('ROLLBACK').catch(() => {});
      throw err;
    }
  });
}

export async function getConfig<T>(key: string): Promise<T | null> {
  const row = await get<{ value: string }>('SELECT value FROM config WHERE key = ?', key);
  return row ? parseJson<T | null>(row.value, null) : null;
}

export function setConfig(key: string, value: unknown) {
  return run('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
