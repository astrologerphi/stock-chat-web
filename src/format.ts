const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code || '—';
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '🏳️';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export function money(n: number | null | undefined): { value: string; unit: string } {
  if (n == null || !Number.isFinite(n)) return { value: '—', unit: '' };
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [div, unit] of units) {
    if (Math.abs(n) >= div) return { value: (n / div).toFixed(n / div >= 100 ? 0 : n / div >= 10 ? 1 : 2), unit };
  }
  return { value: n.toFixed(0), unit: '' };
}

export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
}

export function pct(r: number | null | undefined, digits = 1): string {
  if (r == null || !Number.isFinite(r)) return '—';
  return `${(r * 100).toFixed(digits)}%`;
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const diff = Date.now() - Date.parse(iso);
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fullTime(iso: string | null | undefined): string {
  if (!iso) return 'Never analysed';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Maps a 0–10 score onto the app's diverging palette. */
export function scoreTone(score: number | null | undefined): string {
  if (score == null) return 'none';
  if (score >= 9) return 'elite';
  if (score >= 7) return 'high';
  if (score >= 4) return 'mid';
  return 'low';
}

export type HeatTier = 'none' | 'low' | 'medium' | 'hot' | 'explosive';

export const HEAT_TIER_LABEL: Record<HeatTier, string> = { none: 'Not loaded', low: 'Low', medium: 'Medium', hot: 'Hot', explosive: 'Explosive' };

/** Temperature for a 30-day news count: under 30 low, under 100 medium, under 500 hot, otherwise explosive. */
export function heatTier(count: number | null | undefined): HeatTier {
  if (count == null) return 'none';
  if (count < 30) return 'low';
  if (count < 100) return 'medium';
  if (count < 500) return 'hot';
  return 'explosive';
}

export function hue(seed: string): number {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
