import type { Database } from '@tursodatabase/sync-wasm';
import type { Diagram, Leader } from '../types.ts';
import { activeUrl, configuredToken, linkTo, unlink } from './remote.ts';

export type { Database };

/**
 * SQLite file in the Origin Private File System (OPFS). The sync engine keeps its WAL and change log in sibling
 * files and a little metadata in localStorage under `${DB_FILE}-info`.
 */
export const DB_FILE = 'meridian-sync.db';
/** Database file written by versions before Cloud sync; imported once, then removed. */
const LEGACY_FILE = 'meridian.db';
const TAB_LOCK = 'meridian.db';
const SYNCED_TABLES = ['stocks', 'stock_tags', 'tags', 'stock_scores', 'config', 'llm_batches'];

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
  is_etf INTEGER NOT NULL DEFAULT 0,
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
-- Indexes on is_etf are created in migrate(), after the column exists in older databases.

CREATE TABLE IF NOT EXISTS stock_tags (
  symbol TEXT NOT NULL,
  tag TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (symbol, tag)
);
CREATE INDEX IF NOT EXISTS stock_tags_tag ON stock_tags (tag);

-- Tag library. key is the lower-cased name; blocked tags were deleted by the user and are never re-added by LLM runs.
CREATE TABLE IF NOT EXISTS tags (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

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

-- Gemini Batch API jobs. id is the operation name (batches/...); results are applied once, on the first check after they finish.
CREATE TABLE IF NOT EXISTS llm_batches (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  thinking TEXT NOT NULL DEFAULT 'default',
  symbols TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'pending',
  stats TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  checked_at TEXT,
  finished_at TEXT,
  applied INTEGER NOT NULL DEFAULT 0
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
  isEtf: boolean;
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
    isEtf: Number(r.is_etf) === 1,
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

  // Loaded lazily: the module fetches and instantiates the ~13 MB SQLite engine on import.
  const { connect } = await import('@tursodatabase/sync-wasm');
  // `url` is a function so sync can be switched on later from Settings. When it returns a URL on a clean start,
  // the engine downloads the remote database instead of creating an empty one.
  const fresh = !(await opfsFile(DB_FILE));
  if (fresh) unlink();
  const bootstrapUrl = fresh ? activeUrl() : null;
  const db = await connect({ path: DB_FILE, url: activeUrl, authToken: async () => configuredToken(), clientName: 'meridian-web' });
  if (bootstrapUrl) linkTo(bootstrapUrl);
  await db.exec(SCHEMA);
  await migrate(db);
  await importLegacy(db, connect);
  await backfillTagLibrary(db);
  return db;
}

async function opfsFile(name: string): Promise<File | null> {
  try {
    return await (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

/**
 * Copies the pre-sync database into the synced one. The sync engine only pushes changes it recorded, so rows
 * must be re-inserted rather than the old file adopted. Existing rows win (they may have come from the cloud).
 * The old file is still open in the worker afterwards, so it is deleted on the next start.
 */
async function importLegacy(db: Database, connect: typeof import('@tursodatabase/sync-wasm').connect) {
  const legacy = await opfsFile(LEGACY_FILE);
  if (!legacy) return;
  const done = await db.get("SELECT 1 FROM config WHERE key = 'legacy_import_done'");
  if (done) {
    const dir = await navigator.storage.getDirectory();
    for (const name of [LEGACY_FILE, `${LEGACY_FILE}-wal`]) await dir.removeEntry(name).catch(() => {});
    return;
  }
  if (legacy.size > 0) {
    const old = await connect({ path: LEGACY_FILE });
    try {
      const tables = new Set(((await old.all("SELECT name FROM sqlite_schema WHERE type = 'table'")) as { name: string }[]).map((r) => r.name));
      await db.exec('BEGIN');
      try {
        for (const table of SYNCED_TABLES) {
          if (!tables.has(table)) continue;
          const target = new Set(((await db.all(`PRAGMA table_info(${table})`)) as { name: string }[]).map((c) => c.name));
          const cols = ((await old.all(`PRAGMA table_info(${table})`)) as { name: string }[]).map((c) => c.name).filter((c) => target.has(c));
          const rows = (await old.all(`SELECT ${cols.join(', ')} FROM ${table}`)) as Row[];
          const perInsert = Math.max(1, Math.floor(900 / cols.length));
          for (let i = 0; i < rows.length; i += perInsert) {
            const batch = rows.slice(i, i + perInsert);
            await db.run(
              `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES ${batch.map(() => `(${placeholders(cols.length)})`).join(', ')}`,
              ...batch.flatMap((r) => cols.map((c) => r[c] ?? null)),
            );
          }
        }
        await db.run("INSERT INTO config (key, value) VALUES ('legacy_import_done', 'true') ON CONFLICT(key) DO NOTHING");
        await db.exec('COMMIT');
      } catch (err) {
        await db.exec('ROLLBACK').catch(() => {});
        throw err;
      }
    } finally {
      await old.close().catch(() => {});
    }
  } else {
    await db.run("INSERT INTO config (key, value) VALUES ('legacy_import_done', 'true') ON CONFLICT(key) DO NOTHING");
  }
}

/** Brings databases created by older versions up to the current schema. */
async function migrate(db: Database) {
  const columns = (await db.all('PRAGMA table_info(stocks)')) as { name: string }[];
  if (!columns.some((c) => c.name === 'is_etf')) await db.exec('ALTER TABLE stocks ADD COLUMN is_etf INTEGER NOT NULL DEFAULT 0');
  await db.exec(`
    CREATE INDEX IF NOT EXISTS stocks_kind_market_cap ON stocks (active, is_etf, market_cap);
    CREATE INDEX IF NOT EXISTS stocks_kind_heat ON stocks (active, is_etf, heat);
  `);
}

/** Adds every tag already used by a company to the library (covers databases created before the library existed). */
async function backfillTagLibrary(db: Database) {
  const [used, known] = await Promise.all([
    db.all('SELECT DISTINCT tag FROM stock_tags') as Promise<{ tag: string }[]>,
    db.all('SELECT key FROM tags') as Promise<{ key: string }[]>,
  ]);
  const keys = new Set(known.map((r) => r.key));
  const now = new Date().toISOString();
  const missing: [string, string][] = [];
  for (const { tag } of used) {
    const key = tag.toLowerCase();
    if (keys.has(key)) continue;
    keys.add(key);
    missing.push([key, tag]);
  }
  for (let i = 0; i < missing.length; i += 200) {
    const batch = missing.slice(i, i + 200);
    await db.run(
      `INSERT INTO tags (key, name, created_at) VALUES ${batch.map(() => '(?, ?, ?)').join(', ')} ON CONFLICT(key) DO NOTHING`,
      ...batch.flatMap(([key, name]) => [key, name, now]),
    );
  }
}

let dbPromise: Promise<Database> | undefined;
export const getDb = () => (dbPromise ??= open());

export async function all<T = Row>(sql: string, ...args: unknown[]): Promise<T[]> {
  return (await getDb()).all(sql, ...args) as Promise<T[]>;
}

export async function get<T = Row>(sql: string, ...args: unknown[]): Promise<T | undefined> {
  return ((await (await getDb()).get(sql, ...args)) ?? undefined) as T | undefined;
}

/** Serialises writes (and sync) so that statements never interleave with an open transaction. */
let writeTail: Promise<unknown> = Promise.resolve();
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeTail.then(fn);
  writeTail = result.catch(() => {});
  return result;
}

const writeListeners = new Set<() => void>();
/** Called after every local write; Cloud sync uses it to schedule a push. */
export function onLocalWrite(listener: () => void) {
  writeListeners.add(listener);
}
function wrote<T>(result: Promise<T>): Promise<T> {
  void result.then(() => writeListeners.forEach((l) => l()), () => {});
  return result;
}

export const run = (sql: string, ...args: unknown[]) => wrote(exclusive(async () => (await getDb()).run(sql, ...args)));

export function transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  return wrote(exclusive(async () => {
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
  }));
}

export async function getConfig<T>(key: string): Promise<T | null> {
  const row = await get<{ value: string }>('SELECT value FROM config WHERE key = ?', key);
  return row ? parseJson<T | null>(row.value, null) : null;
}

export function setConfig(key: string, value: unknown) {
  return run('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
