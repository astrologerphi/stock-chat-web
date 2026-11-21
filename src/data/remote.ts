import { getSettings } from '../settings.ts';

/**
 * Which Turso Cloud database the local SQLite file syncs with. Kept apart from db.ts / cloud.ts so the
 * connection can read it without an import cycle.
 *
 * A synced local database is a replica of exactly one remote: its change log and pull revision only make sense
 * against that database. The first successful sync records the remote's URL here (per browser, not in the
 * synced database), and sync stays paused if Settings later point somewhere else.
 */
const LINK_KEY = 'meridian.cloud.linkedUrl';

/** Accepts `libsql://host`, `https://host/…` or a bare host and returns `https://host`, or '' if it isn't a URL. */
export function normalizeTursoUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw.replace(/^(libsql|turso|wss?|http):\/\//i, 'https://') : `https://${raw}`);
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) return '';
    return `https://${url.host}`;
  } catch {
    return '';
  }
}

export const configuredUrl = () => normalizeTursoUrl(getSettings().tursoUrl);
export const configuredToken = () => getSettings().tursoToken.trim();

export const linkedUrl = (): string | null => localStorage.getItem(LINK_KEY);
export const linkTo = (url: string) => localStorage.setItem(LINK_KEY, url);
export const unlink = () => localStorage.removeItem(LINK_KEY);

/** Platform API tokens (for managing an organisation) carry only `jti` and `org_id`; they can't open a database. */
export function looksLikePlatformToken(token: string): boolean {
  try {
    const claims = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    return 'org_id' in claims && !('a' in claims) && !('id' in claims) && !('rid' in claims);
  } catch {
    return false;
  }
}

/** True when Settings point at a different database than the one this browser's data is linked to. */
export function isMismatched(): boolean {
  const linked = linkedUrl();
  const url = configuredUrl();
  return !!linked && !!url && linked !== url;
}

/** The URL the sync engine may talk to right now, or null when Cloud sync is off, incomplete or mismatched. */
export function activeUrl(): string | null {
  const url = configuredUrl();
  if (!url || !configuredToken() || isMismatched()) return null;
  return url;
}
