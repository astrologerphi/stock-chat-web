import { exclusive, getDb } from './db.ts';
import { activeUrl, isMismatched, linkedUrl, linkTo, normalizeTursoUrl } from './remote.ts';
import { HttpError } from './util.ts';

/**
 * Cloud sync with a Turso database. The local SQLite file is a replica: `push` sends the changes recorded since
 * the last push, `pull` brings in everything written remotely (rebasing unpushed local changes on top). Both run
 * inside the write lock so they never land in the middle of an open transaction.
 */

export interface CloudSyncResult {
  /** True when the pull changed local data, so screens should reload. */
  pulled: boolean;
  pushedChanges: number;
}

export interface CloudStats {
  pending: number;
  lastPullAt: string | null;
  lastPushAt: string | null;
}

const isoFromUnix = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);

function describe(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b401\b|unauthori[sz]ed/i.test(msg)) return 'Turso rejected the database token. Create a new token for this database and paste it in Settings.';
  if (/\b403\b|forbidden/i.test(msg)) return 'The database token is read-only or belongs to another database.';
  if (/\b404\b/.test(msg)) return 'Turso has no database at this URL. Check the database URL in Settings.';
  if (/fetch error|failed to fetch|networkerror|load failed/i.test(msg)) return 'Couldn’t reach Turso. Check your connection and the database URL.';
  return msg;
}

/** Why sync can't run right now, or null if it can. */
export function cloudBlocker(): { reason: 'off' | 'mismatch'; message: string } | null {
  if (isMismatched()) {
    const host = new URL(linkedUrl()!).host;
    return { reason: 'mismatch', message: `This browser’s data is linked to ${host}. Put that URL back in Settings, or clear this site’s data to link a different database.` };
  }
  if (!activeUrl()) return { reason: 'off', message: 'Add a Turso database URL and token in Settings to turn on Cloud sync.' };
  return null;
}

/** Pushes local changes, then (unless `pushOnly`) pulls remote ones. */
export async function cloudSync(opts: { pushOnly?: boolean } = {}): Promise<CloudSyncResult> {
  const blocker = cloudBlocker();
  if (blocker) throw new HttpError(400, blocker.message);
  const url = activeUrl()!;
  const db = await getDb();
  try {
    return await exclusive(async () => {
      const pending = (await db.stats()).cdcOperations;
      if (opts.pushOnly && pending === 0) return { pulled: false, pushedChanges: 0 };
      await db.push();
      const pulled = opts.pushOnly ? false : await db.pull();
      if (!linkedUrl()) linkTo(url);
      return { pulled, pushedChanges: pending };
    });
  } catch (err) {
    throw new HttpError(502, describe(err));
  }
}

export async function cloudStats(): Promise<CloudStats> {
  const s = await (await getDb()).stats();
  return { pending: s.cdcOperations, lastPullAt: isoFromUnix(s.lastPullUnixTime), lastPushAt: isoFromUnix(s.lastPushUnixTime) };
}

/** Runs a read-only query against the database to check the URL and token, without touching local data. */
export async function testTurso(urlInput: string, token: string) {
  const url = normalizeTursoUrl(urlInput);
  if (!url) throw new HttpError(400, 'Enter a database URL such as libsql://my-db-my-org.turso.io');
  if (!token.trim()) throw new HttpError(400, 'Paste a database token.');
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`${url}/v2/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ type: 'execute', stmt: { sql: "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'turso_%'" } }, { type: 'close' }],
      }),
    });
  } catch (err) {
    throw new HttpError(0, describe(err));
  }
  if (!res.ok) throw new HttpError(res.status, describe(new Error(`${res.status} ${await res.text().catch(() => '')}`)));
  const body = (await res.json()) as { results?: { type: string; response?: { result?: { rows?: [{ value?: string }][] } }; error?: { message?: string } }[] };
  const first = body.results?.[0];
  if (first?.type !== 'ok') throw new HttpError(502, first?.error?.message ?? 'Unexpected response from Turso');
  return {
    latencyMs: Math.round(performance.now() - started),
    tables: Number(first.response?.result?.rows?.[0]?.[0]?.value ?? 0),
    linked: linkedUrl() === url,
  };
}
