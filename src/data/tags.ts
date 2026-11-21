import { all, parseJson, placeholders, transaction, type Database } from './db.ts';
import { HttpError } from './util.ts';
import type { TagInfo } from '../types.ts';

const MAX_TAG_LENGTH = 32;
const NO_EDITS = '{"added":[],"removed":[]}';

export const tagKey = (tag: string) => tag.toLowerCase();

export function cleanTag(input: unknown): string {
  // Commas are reserved as the separator in the list page's ?tags= filter.
  return String(input ?? '').replace(/[\s,]+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
}

export async function listTagLibrary(): Promise<TagInfo[]> {
  const [lib, used] = await Promise.all([
    all<{ key: string; name: string; blocked: number; created_at: string }>('SELECT key, name, blocked, created_at FROM tags'),
    all<{ tag: string; count: number }>(
      'SELECT t.tag AS tag, COUNT(*) AS count FROM stock_tags t JOIN stocks s ON s.symbol = t.symbol WHERE s.active = 1 GROUP BY t.tag',
    ),
  ]);
  const counts = new Map<string, number>();
  for (const u of used) counts.set(tagKey(u.tag), (counts.get(tagKey(u.tag)) ?? 0) + Number(u.count));
  return lib
    .map((r) => ({ name: r.name, count: counts.get(r.key) ?? 0, blocked: Number(r.blocked) === 1, createdAt: r.created_at }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Maps a company's tags onto the library inside a transaction: known tags take the library's spelling,
 * unknown tags are added to it, and blocked tags are dropped for LLM runs or unblocked by a user's explicit add.
 */
export async function resolveTags(db: Database, tags: string[], source: 'llm' | 'user'): Promise<string[]> {
  if (!tags.length) return [];
  const keys = tags.map(tagKey);
  const rows = (await db.all(`SELECT key, name, blocked FROM tags WHERE key IN (${placeholders(keys.length)})`, ...keys)) as {
    key: string;
    name: string;
    blocked: number;
  }[];
  const lib = new Map(rows.map((r) => [r.key, r]));
  const now = new Date().toISOString();
  const out: string[] = [];
  for (const tag of tags) {
    const row = lib.get(tagKey(tag));
    if (!row) {
      await db.run('INSERT INTO tags (key, name, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING', tagKey(tag), tag, now);
      lib.set(tagKey(tag), { key: tagKey(tag), name: tag, blocked: 0 });
      out.push(tag);
    } else if (Number(row.blocked) === 1) {
      if (source === 'llm') continue;
      await db.run('UPDATE tags SET blocked = 0 WHERE key = ?', row.key);
      row.blocked = 0;
      out.push(row.name);
    } else {
      out.push(row.name);
    }
  }
  return out;
}

/** Adds a tag to the library, or restores it if it was deleted. */
export async function addTag(input: unknown): Promise<{ name: string; created: boolean; restored: boolean }> {
  const name = cleanTag(input);
  if (!name) throw new HttpError(400, 'Tag name is empty');
  return transaction(async (db) => {
    const row = (await db.get('SELECT name, blocked FROM tags WHERE key = ?', tagKey(name))) as { name: string; blocked: number } | undefined;
    if (!row) {
      await db.run('INSERT INTO tags (key, name, created_at) VALUES (?, ?, ?)', tagKey(name), name, new Date().toISOString());
      return { name, created: true, restored: false };
    }
    if (Number(row.blocked) === 1) {
      await db.run('UPDATE tags SET blocked = 0 WHERE key = ?', tagKey(name));
      return { name: row.name, created: false, restored: true };
    }
    return { name: row.name, created: false, restored: false };
  });
}

/** Deletes a tag from every company and blocks it so later LLM runs don't bring it back. Returns the number of companies changed. */
export async function deleteTag(input: unknown): Promise<number> {
  const name = cleanTag(input);
  if (!name) throw new HttpError(400, 'Tag name is empty');
  const key = tagKey(name);
  return transaction(async (db) => {
    // Match spellings in JS: SQLite's lower() only folds ASCII.
    const spellings = ((await db.all('SELECT DISTINCT tag FROM stock_tags')) as { tag: string }[]).map((r) => r.tag).filter((t) => tagKey(t) === key);
    let tagged: { symbol: string }[] = [];
    if (spellings.length) {
      tagged = (await db.all(`SELECT symbol FROM stock_tags WHERE tag IN (${placeholders(spellings.length)})`, ...spellings)) as { symbol: string }[];
      await db.run(`DELETE FROM stock_tags WHERE tag IN (${placeholders(spellings.length)})`, ...spellings);
    }
    await db.run(
      'INSERT INTO tags (key, name, blocked, created_at) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET blocked = 1',
      key,
      name,
      new Date().toISOString(),
    );
    // Forget manual additions so the tag stays off these companies if it is restored later.
    const edited = (await db.all('SELECT symbol, tag_edits FROM stocks WHERE tag_edits <> ?', NO_EDITS)) as { symbol: string; tag_edits: string }[];
    for (const r of edited) {
      const edits = parseJson(r.tag_edits, { added: [] as string[], removed: [] as string[] });
      const added = edits.added.filter((t) => tagKey(t) !== key);
      if (added.length !== edits.added.length) {
        await db.run('UPDATE stocks SET tag_edits = ? WHERE symbol = ?', JSON.stringify({ ...edits, added }), r.symbol);
      }
    }
    return new Set(tagged.map((t) => t.symbol)).size;
  });
}
