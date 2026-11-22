import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { api } from '../api.ts';
import { compact, money } from '../format.ts';
import { navigate, scrollToTop } from '../router.ts';
import { useSettings } from '../settings.ts';
import * as I from '../components/icons.tsx';
import { PriceChart } from '../components/PriceChart.tsx';
import { Avatar, Heat, Spinner } from '../components/ui.tsx';
import type { EtfHolding, EtfHoldings, EtfInfo, StockDetail } from '../types.ts';
import { Fact } from './StockDetail.tsx';

const PREVIEW = 25;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Money({ n }: { n: number | null }) {
  const m = money(n);
  return (
    <span class="num">
      {m.value === '—' ? '—' : `$${m.value}`}
      <span class="cap__unit">{m.unit}</span>
    </span>
  );
}

const shortDate = (d: string) => {
  const t = Date.parse(d.length === 10 ? `${d}T00:00:00` : d.replace(' ', 'T'));
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : d;
};

const href = (h: EtfHolding) => (h.link ? `#/${h.link}/${encodeURIComponent(h.asset)}` : undefined);

function Holdings({ symbol, hasKey }: { symbol: string; hasKey: boolean }) {
  const [data, setData] = useState<EtfHoldings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (!hasKey) return;
    let live = true;
    api
      .etfHoldings(symbol)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [symbol, hasKey]);

  const holdings = data?.holdings ?? [];
  const ranks = useMemo(() => new Map(data?.holdings.map((h, i) => [h, i + 1])), [data]);
  const maxWeight = Math.max(0, ...holdings.map((h) => h.weight ?? 0));
  const top10 = holdings.slice(0, 10).reduce((s, h) => s + (h.weight ?? 0), 0);
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? holdings.filter((h) => h.asset.toLowerCase().includes(q) || h.name.toLowerCase().includes(q)) : holdings),
    [holdings, q],
  );
  const visible = all || q ? matches : matches.slice(0, PREVIEW);

  return (
    <section class="card panel">
      <header class="panel__head">
        <div>
          <h2 class="panel__title">
            <I.Layers size={16} /> Holdings
          </h2>
          {holdings.length > 0 && (
            <p class="panel__sub">
              {holdings.length.toLocaleString('en-US')} positions
              {top10 > 0 && holdings.length > 10 ? ` · top 10 are ${top10.toFixed(1)}% of the fund` : ''}
              {data?.updatedAt ? ` · as of ${shortDate(data.updatedAt)}` : ''}
            </p>
          )}
        </div>
        {holdings.length > PREVIEW && (
          <label class="holdings-search">
            <I.Search size={14} />
            <input type="search" placeholder="Find a holding" aria-label="Find a holding" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          </label>
        )}
      </header>

      {!hasKey ? (
        <p class="muted">
          <a class="link-btn" href="#/settings">
            Add an FMP key
          </a>{' '}
          to load this fund’s holdings.
        </p>
      ) : error ? (
        <p class="muted">Couldn’t load holdings. {error}</p>
      ) : !data ? (
        <div class="holdings-loading">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} class="skeleton" style={{ width: `${92 - i * 9}%`, height: '14px' }} />
          ))}
        </div>
      ) : holdings.length === 0 ? (
        <p class="muted">FMP doesn’t list holdings for {symbol}.</p>
      ) : (
        <>
          <div class="table-scroll holdings-scroll">
            <table class="holdings">
              <thead>
                <tr>
                  <th class="holdings__rank" scope="col">
                    #
                  </th>
                  <th scope="col">Holding</th>
                  <th scope="col">Weight</th>
                  <th class="right" scope="col">
                    Shares
                  </th>
                  <th class="right" scope="col">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((h) => {
                  const link = href(h);
                  const rank = ranks.get(h) ?? 0;
                  return (
                    <tr key={`${h.asset}:${h.name}:${rank}`} class={link ? 'is-link' : ''} onClick={link ? () => navigate(link.slice(1)) : undefined}>
                      <td class="holdings__rank num">{rank}</td>
                      <td>
                        <span class="holding">
                          {h.asset ? <Avatar symbol={h.asset} src={h.image} size={28} /> : <span class="holding__blank" />}
                          <span class="holding__text">
                            {link ? (
                              <a class="holding__symbol" href={link} onClick={(e) => e.stopPropagation()}>
                                {h.asset}
                              </a>
                            ) : (
                              <span class="holding__symbol">{h.asset || '—'}</span>
                            )}
                            <span class="holding__name" title={h.name}>
                              {h.name}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span class="weight">
                          <span class="weight__bar" style={{ '--w': maxWeight > 0 ? (h.weight ?? 0) / maxWeight : 0 }} />
                          <span class="weight__pct num">{h.weight == null ? '—' : `${h.weight.toFixed(h.weight < 0.1 ? 3 : 2)}%`}</span>
                        </span>
                      </td>
                      <td class="right num muted">{compact(h.shares)}</td>
                      <td class="right">
                        <Money n={h.marketValue} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {q && matches.length === 0 && <p class="muted holdings-none">No holding matches “{query}”.</p>}
          </div>
          {!q && matches.length > PREVIEW && (
            <button class="btn btn--ghost holdings-more" onClick={() => setAll(!all)}>
              {all ? 'Show top 25' : `Show all ${matches.length.toLocaleString('en-US')} holdings`}
              <I.ChevronDown size={14} style={all ? { transform: 'rotate(180deg)' } : undefined} />
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Sectors({ sectors }: { sectors: EtfInfo['sectors'] }) {
  const max = Math.max(0, ...sectors.map((s) => s.weight));
  return (
    <section class="card panel">
      <header class="panel__head">
        <h2 class="panel__title">
          <I.PieChart size={16} /> Sector exposure
        </h2>
      </header>
      <ul class="sectors">
        {sectors.map((s) => (
          <li key={s.name}>
            <span class="sectors__name">{s.name}</span>
            <span class="sectors__pct num">{s.weight.toFixed(1)}%</span>
            <span class="weight__bar" style={{ '--w': max > 0 ? s.weight / max : 0 }} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EtfDetail({ symbol }: { symbol: string }) {
  const settings = useSettings();
  const hasKey = !!settings.fmpKey;
  const [data, setData] = useState<StockDetail | null>(null);
  const [info, setInfo] = useState<EtfInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [heatLoading, setHeatLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.detail(symbol);
      if (!d.isEtf) {
        navigate(`/stock/${encodeURIComponent(symbol)}`, undefined, true);
        return;
      }
      setData(d);
      setError(null);
      if (settings.fmpKey && (d.heat == null || !d.heatUpdatedAt || Date.now() - Date.parse(d.heatUpdatedAt) > 12 * 3600_000)) {
        setHeatLoading(true);
        api
          .heat([symbol])
          .then(([h]) => h && setData((x) => x && { ...x, heat: h.heat }))
          .catch(() => {})
          .finally(() => setHeatLoading(false));
      }
    } catch (e) {
      setError(e instanceof Error && /not found/i.test(e.message) ? `${symbol} isn’t in your ETF list. Sync from Settings to load it.` : message(e));
    }
  }, [symbol, settings.fmpKey]);

  useEffect(() => {
    void load();
    scrollToTop();
  }, [load]);

  useEffect(() => {
    if (!hasKey) return setInfo(null);
    let live = true;
    api
      .etfInfo(symbol)
      .then((i) => live && setInfo(i))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [symbol, hasKey]);

  const back = (
    <a class="back" href="#/etfs" onClick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}>
      <I.ChevronLeft size={16} /> ETFs
    </a>
  );

  if (error) {
    return (
      <div class="page">
        {back}
        <div class="empty empty--error">{error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div class="page detail">
        {back}
        <div class="detail-hero">
          <span class="skeleton" style={{ width: '88px', height: '88px', borderRadius: '24px' }} />
          <div style={{ flex: 1, display: 'grid', gap: '12px' }}>
            <span class="skeleton" style={{ width: '120px', height: '16px' }} />
            <span class="skeleton" style={{ width: '50%', height: '48px' }} />
          </div>
        </div>
      </div>
    );
  }

  const up = (data.changePercentage ?? 0) >= 0;
  const description = info?.description || data.description;
  const website = info?.website || data.website;
  const subtitle = [info?.issuer, info?.assetClass, 'Exchange-traded fund'].filter(Boolean).join(' · ');

  return (
    <div class="page detail">
      {back}

      <section class="detail-hero">
        <Avatar symbol={data.symbol} src={data.image} size={88} />
        <div class="detail-hero__main">
          <div class="detail-hero__meta">
            <span class="ticker">{data.symbol}</span>
            <span class={`exch exch--${data.exchange.toLowerCase()}`}>{data.exchange}</span>
          </div>
          <h1 class="display display--detail">{data.name}</h1>
          <p class="muted">{subtitle}</p>
        </div>
        <div class="detail-hero__side">
          {data.price != null && (
            <div class="quote">
              <span class="quote__price num">${data.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              {data.changePercentage != null && (
                <span class={`quote__chg num ${up ? 'up' : 'down'}`}>
                  {up ? '▲' : '▼'} {Math.abs(data.changePercentage).toFixed(2)}%
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      <dl class="facts card">
        <Fact label={info?.aum != null ? 'Assets under mgmt' : 'Market cap'}>
          <span class="big">
            <Money n={info?.aum ?? data.marketCap} />
          </span>
        </Fact>
        <Fact label="Heat · 30d news">
          <Heat count={data.heat} loading={heatLoading} label />
        </Fact>
        {info?.expenseRatio != null && (
          <Fact label="Expense ratio">
            <span class="num">{Number(info.expenseRatio.toPrecision(3))}%</span>
          </Fact>
        )}
        {info?.nav != null && (
          <Fact label="NAV">
            <span class="num">${info.nav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </Fact>
        )}
        {info?.holdingsCount != null && (
          <Fact label="Holdings">
            <span class="num">{info.holdingsCount.toLocaleString('en-US')}</span>
          </Fact>
        )}
        {info?.avgVolume != null && (
          <Fact label="Avg volume">
            <span class="num">{compact(info.avgVolume)}</span>
          </Fact>
        )}
        <Fact label="Exchange">{data.exchangeFullName || data.exchange}</Fact>
        {info?.inceptionDate && <Fact label="Inception">{shortDate(info.inceptionDate)}</Fact>}
        {data.range && (
          <Fact label="52-week range">
            <span class="num">{data.range}</span>
          </Fact>
        )}
        {website && (
          <Fact label="Website">
            <a href={website} target="_blank" rel="noopener noreferrer" class="ext">
              {website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} <I.Link size={12} />
            </a>
          </Fact>
        )}
      </dl>

      <PriceChart symbol={data.symbol} />

      <div class="detail-grid">
        <div class="detail-main">
          <Holdings symbol={data.symbol} hasKey={hasKey} />
        </div>
        <aside class="detail-side">
          {info === undefined && hasKey ? (
            <section class="card panel">
              <p class="muted">
                <Spinner /> Loading fund details…
              </p>
            </section>
          ) : (
            info?.sectors.length ? <Sectors sectors={info.sectors} /> : null
          )}
          <section class="card panel">
            <header class="panel__head">
              <h2 class="panel__title">
                <I.Quill size={16} /> About
              </h2>
            </header>
            {description ? (
              <div class="prose">
                <p>{description}</p>
              </div>
            ) : (
              <p class="muted">{hasKey ? 'FMP has no description for this fund.' : 'Add an FMP key to load the fund’s description.'}</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
