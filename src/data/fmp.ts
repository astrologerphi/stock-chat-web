import { HttpError, isoDate, sleep } from './util.ts';

const BASE = 'https://financialmodelingprep.com/stable';

export interface FmpScreenerRow {
  symbol: string;
  companyName: string;
  marketCap: number | null;
  sector: string | null;
  industry: string | null;
  price: number | null;
  exchange: string | null;
  exchangeShortName: string | null;
  country: string | null;
}

export interface FmpFloat {
  symbol: string;
  floatShares: number | null;
  outstandingShares: number | null;
}

export interface FmpProfile {
  symbol: string;
  companyName: string;
  price: number | null;
  marketCap: number | null;
  changePercentage: number | null;
  range: string | null;
  exchange: string | null;
  exchangeFullName: string | null;
  industry: string | null;
  sector: string | null;
  country: string | null;
  website: string | null;
  description: string | null;
  ceo: string | null;
  fullTimeEmployees: string | number | null;
  ipoDate: string | null;
  image: string | null;
}

export interface FmpExecutive {
  title: string;
  name: string;
  pay: number | null;
  currencyPay: string | null;
  gender: string | null;
  yearBorn: number | null;
  active: boolean | null;
}

export interface FmpNews {
  symbol: string;
  publishedDate: string;
  publisher: string;
  title: string;
  site: string;
  text: string;
  url: string;
}

export class Fmp {
  constructor(private apiKey: string) {
    if (!apiKey) throw new HttpError(400, 'FMP API key is missing. Add it in Settings.');
  }

  async get<T>(path: string, params: Record<string, string | number | boolean> = {}, attempt = 0): Promise<T> {
    const url = new URL(`${BASE}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set('apikey', this.apiKey);
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (res.status === 429 && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      return this.get(path, params, attempt + 1);
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(502, `FMP ${path}: unexpected response (${res.status})`);
    }
    if (body && typeof body === 'object' && 'Error Message' in body) {
      const msg = String((body as Record<string, unknown>)['Error Message']);
      throw new HttpError(/api key/i.test(msg) ? 401 : 502, `FMP: ${msg.split('.')[0]}`);
    }
    if (!res.ok) throw new HttpError(502, `FMP ${path} failed with ${res.status}`);
    return body as T;
  }

  screener() {
    return this.get<FmpScreenerRow[]>('company-screener', {
      exchange: 'NASDAQ,NYSE,AMEX',
      isEtf: false,
      isFund: false,
      isActivelyTrading: true,
      limit: 20000,
    });
  }

  /** Actively traded US-listed exchange-traded funds. */
  etfScreener() {
    return this.get<FmpScreenerRow[]>('company-screener', {
      exchange: 'NASDAQ,NYSE,AMEX',
      isEtf: true,
      isActivelyTrading: true,
      limit: 20000,
    });
  }

  floatPage(page: number, limit: number) {
    return this.get<FmpFloat[]>('shares-float-all', { page, limit });
  }

  async profile(symbol: string) {
    const [p] = await this.get<FmpProfile[]>('profile', { symbol });
    return p ?? null;
  }

  executives(symbol: string) {
    return this.get<FmpExecutive[]>('key-executives', { symbol });
  }

  async float(symbol: string) {
    const [f] = await this.get<FmpFloat[]>('shares-float', { symbol });
    return f ?? null;
  }

  news(symbol: string, opts: { from?: string; to?: string; page?: number; limit?: number } = {}) {
    return this.get<FmpNews[]>('news/stock', { symbols: symbol, page: 0, limit: 50, ...opts });
  }

  /** Counts news items for a symbol over the last `days` days (FMP pages are capped at 250). */
  async countRecentNews(symbol: string, days = 30): Promise<number> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const limit = 250;
    let total = 0;
    for (let page = 0; page < 12; page++) {
      const batch = await this.news(symbol, { from: isoDate(from), to: isoDate(to), page, limit });
      total += batch.length;
      if (batch.length < limit) break;
    }
    return total;
  }
}
