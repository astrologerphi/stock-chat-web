import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, type ListParams } from '../api.ts';
import { fullTime, money, relTime } from '../format.ts';
import { navigate, scrollToTop } from '../router.ts';
import { useSettings } from '../settings.ts';
import * as I from '../components/icons.tsx';
import { Avatar, Chip, FilterMenu, Heat, Pager, Spinner, type Option } from '../components/ui.tsx';
import type { Facet, ListResponse } from '../types.ts';
import { csv, HeatButton, HeatJobBar, SortHeader, SyncBar, useHeatJob, useRowHeat, useSyncStatus } from './listing.tsx';

/** Databases synced before ETFs were added have none; fetch them once per session instead of on every visit. */
let autoSynced = false;

function readParams(params: URLSearchParams, pageSize: number): ListParams {
  const sort = params.get('sort');
  return {
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize,
    sort: sort === 'heat' || sort === 'symbol' ? sort : 'marketCap',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    q: params.get('q') ?? '',
    exchange: csv(params.get('exchange')),
    country: [],
    tags: [],
  };
}

function writeParams(p: ListParams, replace = false) {
  const qs = new URLSearchParams();
  if (p.page > 1) qs.set('page', String(p.page));
  if (p.sort !== 'marketCap') qs.set('sort', p.sort);
  if (p.order !== 'desc') qs.set('order', p.order);
  if (p.q) qs.set('q', p.q);
  if (p.exchange.length) qs.set('exchange', p.exchange.join(','));
  navigate('/etfs', qs, replace);
}

export function EtfList({ params: rawParams }: { params: URLSearchParams }) {
  const settings = useSettings();
  const params = useMemo(() => readParams(rawParams, settings.pageSize), [rawParams, settings.pageSize]);
  const key = JSON.stringify(params);

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Facet[] | null>(null);
  const [search, setSearch] = useState(params.q);
  const requestId = useRef(0);
  const tableScroll = useRef<HTMLDivElement>(null);

  const { heatLoading, loadHeat } = useRowHeat(setData);

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const res = await api.list(params, 'etfs');
        if (id !== requestId.current) return;
        setData(res);
        setError(null);
        void loadHeat(res.items);
      } catch (e) {
        if (id === requestId.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [key, loadHeat],
  );

  const loadFacets = useCallback(() => {
    api.exchanges('etfs').then(setExchanges).catch(() => setExchanges([]));
  }, []);

  useEffect(() => void load(), [load]);
  useEffect(() => setSearch(params.q), [params.q]);
  useEffect(loadFacets, [loadFacets]);

  const { sync, startSync } = useSyncStatus(() => {
    void load();
    loadFacets();
  });
  const heat = useHeatJob('etfs', (silent) => void load(silent));

  useEffect(() => {
    if (!sync || autoSynced || sync.running || sync.etfs > 0 || !settings.fmpKey) return;
    autoSynced = true;
    startSync();
  }, [sync, settings.fmpKey]);

  useEffect(() => {
    if (search === params.q) return;
    const t = setTimeout(() => writeParams({ ...params, q: search.trim(), page: 1 }, true), 280);
    return () => clearTimeout(t);
  }, [search]);

  const set = (patch: Partial<ListParams>) => writeParams({ ...params, page: 1, ...patch });
  const sortProps = { sort: params.sort, order: params.order, onSort: (sort: string, order: 'asc' | 'desc') => set({ sort, order }) };
  const exchangeOptions: Option[] | null = exchanges?.map((e) => ({ value: e.value, label: e.value, search: e.value, count: e.count })) ?? null;

  const rows = data?.items ?? [];
  const hasFilters = params.q || params.exchange.length;

  return (
    <div class="page page--list page--etfs">
      <section class="hero">
        <div class="hero__text">
          <p class="eyebrow">
            <span class="pulse" /> US exchange-traded funds · NASDAQ · NYSE · AMEX
          </p>
          <h1 class="display">
            The funds, <em>weighed.</em>
          </h1>
          <p class="lede">Every US-listed ETF, ranked by size and by how loudly the news is talking about it.</p>
        </div>
        <dl class="hero__stats">
          <div>
            <dt>ETFs</dt>
            <dd class="num">{sync ? sync.etfs.toLocaleString('en-US') : '—'}</dd>
          </div>
          <div>
            <dt>Exchanges</dt>
            <dd class="num">{exchanges ? exchanges.length : <span class="skeleton" style={{ width: '36px', height: '28px' }} />}</dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd class="num small" title={fullTime(sync?.lastSyncedAt)}>
              {sync?.running ? (
                <span class="sync-inline">
                  <Spinner size={12} /> {Math.round(sync.progress * 100)}%
                </span>
              ) : (
                relTime(sync?.lastSyncedAt)
              )}
            </dd>
          </div>
        </dl>
      </section>

      {!settings.fmpKey && sync?.etfs === 0 && (
        <section class="onboard card">
          <div class="onboard__icon">
            <I.Key size={22} />
          </div>
          <div>
            <h2>Connect your data source</h2>
            <p>Add your Financial Modeling Prep API key to load every US-listed ETF. Keys stay in this browser’s local storage.</p>
          </div>
          <a class="btn btn--primary" href="#/settings">
            Open settings <I.ChevronRight size={16} />
          </a>
        </section>
      )}

      <SyncBar sync={sync} />
      <HeatJobBar job={heat.job} onStop={heat.stop} />

      <section class="toolbar">
        <label class="search">
          <I.Search size={16} />
          <input value={search} placeholder="Search symbol or fund…" onInput={(e) => setSearch(e.currentTarget.value)} />
          {search && (
            <button class="search__x" onClick={() => setSearch('')} aria-label="Clear search">
              <I.X size={14} />
            </button>
          )}
          <kbd>/</kbd>
        </label>
        <FilterMenu label="Exchange" icon={<I.Building size={15} />} options={exchangeOptions} selected={params.exchange} onChange={(v) => set({ exchange: v })} />
        {hasFilters ? (
          <button class="link-btn" onClick={() => writeParams({ ...params, page: 1, q: '', exchange: [] })}>
            Reset
          </button>
        ) : null}
        <span class="toolbar__spacer" />
        <HeatButton kind="etfs" job={heat.job} disabled={!!sync?.running || !sync?.etfs} onStart={heat.start} />
      </section>

      {params.exchange.length > 0 && (
        <div class="active-filters">
          {params.exchange.map((e) => (
            <Chip key={e} onRemove={() => set({ exchange: params.exchange.filter((x) => x !== e) })}>
              <I.Building size={12} /> {e}
            </Chip>
          ))}
        </div>
      )}

      <section class={`table-wrap card${loading && data ? ' is-loading' : ''}`}>
        <div class="table-scroll table-scroll--fixed" ref={tableScroll} style={{ '--rows': params.pageSize }}>
          <table class="stocks stocks--plain">
            <thead>
              <tr>
                <SortHeader label="Fund" sortKey="symbol" {...sortProps} />
                <SortHeader label="Market cap" sortKey="marketCap" {...sortProps} align="right" />
                <th>Exchange</th>
                <SortHeader label="Heat" sortKey="heat" {...sortProps} title="News articles published in the last 30 days" />
              </tr>
            </thead>
            <tbody>
              {!data && loading
                ? Array.from({ length: 10 }, (_, i) => (
                    <tr key={i} class="skeleton-row">
                      <td colSpan={4}>
                        <span class="skeleton" style={{ width: `${40 + ((i * 23) % 50)}%`, height: '14px' }} />
                      </td>
                    </tr>
                  ))
                : rows.map((r, i) => {
                    const cap = money(r.marketCap);
                    return (
                      <tr key={r.symbol} style={{ '--i': i }} onClick={() => navigate(`/etf/${encodeURIComponent(r.symbol)}`)}>
                        <td class="company">
                          <span class="company__id">
                            <Avatar symbol={r.symbol} src={r.image} />
                            <span class="company__text">
                              <span class="company__symbol">{r.symbol}</span>
                              <span class="company__name" title={r.name}>
                                {r.name}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td class="right">
                          <span class="cap num">
                            {cap.value}
                            <span class="cap__unit">{cap.unit}</span>
                          </span>
                        </td>
                        <td>
                          <span class={`exch exch--${r.exchange.toLowerCase()}`}>{r.exchange || '—'}</span>
                        </td>
                        <td>
                          <Heat count={r.heat} loading={heatLoading.has(r.symbol)} />
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {data && !rows.length && !loading && (
            <div class="empty">
              <I.Search size={22} />
              <p>{sync?.etfs ? 'No ETFs match these filters.' : sync?.running ? 'Loading the funds…' : 'No ETFs yet.'}</p>
            </div>
          )}
          {error && <div class="empty empty--error">{error}</div>}
        </div>
        {data && (
          <Pager
            page={params.page}
            total={data.total}
            pageSize={params.pageSize}
            onPage={(p) => {
              writeParams({ ...params, page: p });
              scrollToTop(tableScroll.current, 'smooth');
            }}
          />
        )}
      </section>
    </div>
  );
}
