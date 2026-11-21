import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, type ListParams } from '../api.ts';
import { countryName, flag, fullTime, money, relTime } from '../format.ts';
import { navigate, scrollToTop } from '../router.ts';
import { useSettings } from '../settings.ts';
import { isOpenBatch, useBatches, useOnBatchesFinished } from '../batches.ts';
import { isActive, runAnalysis, taskKey, useOnTasksFinished, useTasks } from '../tasks.ts';
import { BatchBar, BatchModal } from '../components/BatchModal.tsx';
import * as I from '../components/icons.tsx';
import { Avatar, Chip, FilterMenu, FloatGauge, Heat, Pager, ScoreCell, Spinner, type Option } from '../components/ui.tsx';
import type { Facet, ListResponse, PromptConfig } from '../types.ts';
import { csv, HeatButton, HeatJobBar, SortHeader, SyncBar, useHeatJob, useRowHeat, useSyncStatus } from './listing.tsx';

function readParams(params: URLSearchParams, pageSize: number): ListParams {
  return {
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize,
    sort: params.get('sort') || 'marketCap',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    q: params.get('q') ?? '',
    exchange: csv(params.get('exchange')),
    country: csv(params.get('country')),
    tags: csv(params.get('tags')),
  };
}

function writeParams(p: ListParams, replace = false) {
  const qs = new URLSearchParams();
  if (p.page > 1) qs.set('page', String(p.page));
  if (p.sort !== 'marketCap') qs.set('sort', p.sort);
  if (p.order !== 'desc') qs.set('order', p.order);
  if (p.q) qs.set('q', p.q);
  if (p.exchange.length) qs.set('exchange', p.exchange.join(','));
  if (p.country.length) qs.set('country', p.country.join(','));
  if (p.tags.length) qs.set('tags', p.tags.join(','));
  navigate('/', qs, replace);
}

export function StockList({ params: rawParams }: { params: URLSearchParams }) {
  const settings = useSettings();
  const params = useMemo(() => readParams(rawParams, settings.pageSize), [rawParams, settings.pageSize]);
  const key = JSON.stringify(params);

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PromptConfig | null>(null);
  const [countries, setCountries] = useState<Facet[] | null>(null);
  const [exchanges, setExchanges] = useState<Facet[] | null>(null);
  const [tagFacets, setTagFacets] = useState<Facet[] | null>(null);
  const [search, setSearch] = useState(params.q);
  const tasks = useTasks();
  const { batches } = useBatches();
  const [batchSymbols, setBatchSymbols] = useState<string[] | null>(null);
  const autoSynced = useRef(false);
  const requestId = useRef(0);
  const tableScroll = useRef<HTMLDivElement>(null);

  const { heatLoading, loadHeat } = useRowHeat(setData);

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const res = await api.list(params);
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
    api.countries().then(setCountries).catch(() => setCountries([]));
    api.exchanges().then(setExchanges).catch(() => setExchanges([]));
    api.tags().then(setTagFacets).catch(() => setTagFacets([]));
  }, []);

  useEffect(() => void load(), [load]);
  useEffect(() => setSearch(params.q), [params.q]);
  useEffect(() => {
    loadFacets();
    api.prompts().then(setPrompts).catch(() => {});
  }, [loadFacets]);

  const { sync, startSync } = useSyncStatus(() => {
    void load();
    loadFacets();
  });
  const heat = useHeatJob('stocks', (silent) => void load(silent));

  // Kick off the first universe sync automatically once an FMP key is present.
  useEffect(() => {
    if (!sync || autoSynced.current || sync.running || sync.total > 0 || !settings.fmpKey) return;
    autoSynced.current = true;
    startSync();
  }, [sync, settings.fmpKey]);

  const onFinished = useCallback(() => {
    void load(true);
    api.tags().then(setTagFacets).catch(() => {});
  }, [load]);
  useOnTasksFinished(onFinished);
  useOnBatchesFinished(onFinished);

  useEffect(() => {
    if (search === params.q) return;
    const t = setTimeout(() => writeParams({ ...params, q: search.trim(), page: 1 }, true), 280);
    return () => clearTimeout(t);
  }, [search]);

  const set = (patch: Partial<ListParams>) => writeParams({ ...params, page: 1, ...patch });
  const sortProps = { sort: params.sort, order: params.order, onSort: (sort: string, order: 'asc' | 'desc') => set({ sort, order }) };

  const countryOptions: Option[] | null = countries?.map((c) => ({
    value: c.value,
    label: (
      <>
        <span class="flag">{flag(c.value)}</span> {countryName(c.value)}
      </>
    ),
    search: `${c.value} ${countryName(c.value)}`,
    count: c.count,
  })) ?? null;
  const exchangeOptions: Option[] | null = exchanges?.map((e) => ({ value: e.value, label: e.value, search: e.value, count: e.count })) ?? null;
  const tagOptions: Option[] | null = tagFacets?.map((t) => ({ value: t.value, label: t.value, search: t.value, count: t.count })) ?? null;

  const scorePrompts = prompts?.scorePrompts ?? [];
  const rows = data?.items ?? [];
  const pageSymbols = rows.map((r) => r.symbol);
  const inBatch = useMemo(() => new Set(batches.filter(isOpenBatch).flatMap((b) => b.symbols)), [batches]);
  const batchable = pageSymbols.filter((s) => !inBatch.has(s));
  const hasFilters = params.q || params.exchange.length || params.country.length || params.tags.length;
  const needsKeys = !settings.fmpKey;
  const empty = sync && sync.total === 0;

  return (
    <div class="page page--list">
      <section class="hero">
        <div class="hero__text">
          <p class="eyebrow">
            <span class="pulse" /> US equities · NASDAQ · NYSE · AMEX
          </p>
          <h1 class="display">
            The market, <em>annotated.</em>
          </h1>
          <p class="lede">Every listed company, sized up by the numbers and read between the lines by Gemini.</p>
        </div>
        <dl class="hero__stats">
          <div>
            <dt>Companies</dt>
            <dd class="num">{sync ? sync.total.toLocaleString('en-US') : '—'}</dd>
          </div>
          <div>
            <dt>Countries</dt>
            <dd class="num">{countries ? countries.length : <span class="skeleton" style={{ width: '36px', height: '28px' }} />}</dd>
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

      {needsKeys && empty && (
        <section class="onboard card">
          <div class="onboard__icon">
            <I.Key size={22} />
          </div>
          <div>
            <h2>Connect your data sources</h2>
            <p>Add your Financial Modeling Prep and Gemini API keys to load the market and unlock AI analysis. Keys stay in this browser’s local storage.</p>
          </div>
          <a class="btn btn--primary" href="#/settings">
            Open settings <I.ChevronRight size={16} />
          </a>
        </section>
      )}

      <SyncBar sync={sync} />
      <HeatJobBar job={heat.job} onStop={heat.stop} />
      <BatchBar />

      <section class="toolbar">
        <label class="search">
          <I.Search size={16} />
          <input value={search} placeholder="Search symbol or company…" onInput={(e) => setSearch(e.currentTarget.value)} />
          {search && (
            <button class="search__x" onClick={() => setSearch('')} aria-label="Clear search">
              <I.X size={14} />
            </button>
          )}
          <kbd>/</kbd>
        </label>
        <FilterMenu label="Exchange" icon={<I.Building size={15} />} options={exchangeOptions} selected={params.exchange} onChange={(v) => set({ exchange: v })} />
        <FilterMenu
          label="Country"
          icon={<I.Globe size={15} />}
          options={countryOptions}
          selected={params.country}
          onChange={(v) => set({ country: v })}
          searchable
          hint="Sorted by number of listed companies"
        />
        <FilterMenu label="Tags" icon={<I.Tag size={15} />} options={tagOptions} selected={params.tags} onChange={(v) => set({ tags: v })} searchable hint={tagOptions?.length ? undefined : 'Tags appear after running an analysis'} />
        {hasFilters ? (
          <button class="link-btn" onClick={() => writeParams({ ...params, page: 1, q: '', exchange: [], country: [], tags: [] })}>
            Reset
          </button>
        ) : null}
        <span class="toolbar__spacer" />
        <HeatButton kind="stocks" job={heat.job} disabled={!!sync?.running || !sync?.total} onStart={heat.start} />
        <button
          class="btn btn--primary"
          disabled={!batchable.length}
          onClick={() => setBatchSymbols(batchable)}
          title={
            rows.length && !batchable.length
              ? 'Every stock on this page is already in a running batch'
              : 'Review, then send one Gemini batch job that scores, tags and introduces every stock on this page. Generate diagrams from a stock’s detail page.'
          }
        >
          <I.Stack size={16} />
          Batch analyse page ({batchable.length})
        </button>
      </section>

      {(params.exchange.length > 0 || params.country.length > 0 || params.tags.length > 0) && (
        <div class="active-filters">
          {params.exchange.map((e) => (
            <Chip key={`e${e}`} onRemove={() => set({ exchange: params.exchange.filter((x) => x !== e) })}>
              <I.Building size={12} /> {e}
            </Chip>
          ))}
          {params.country.map((c) => (
            <Chip key={`c${c}`} onRemove={() => set({ country: params.country.filter((x) => x !== c) })}>
              {flag(c)} {countryName(c)}
            </Chip>
          ))}
          {params.tags.map((t) => (
            <Chip key={`t${t}`} onRemove={() => set({ tags: params.tags.filter((x) => x !== t) })}>
              <I.Tag size={12} /> {t}
            </Chip>
          ))}
        </div>
      )}

      <section class={`table-wrap card${loading && data ? ' is-loading' : ''}`}>
        <div class="table-scroll" ref={tableScroll}>
          <table class="stocks">
            <thead>
              <tr>
                <SortHeader label="Company" sortKey="symbol" {...sortProps} />
                <SortHeader label="Market cap" sortKey="marketCap" {...sortProps} align="right" />
                <th>Exchange</th>
                <SortHeader label="Heat" sortKey="heat" {...sortProps} title="News articles published in the last 30 days" />
                <SortHeader label="Float" sortKey="floatRatio" {...sortProps} title="Float shares / total shares outstanding" />
                <th>Country</th>
                {scorePrompts.map((p) => (
                  <SortHeader key={p.id} label={p.title} sortKey={`score:${p.id}`} {...sortProps} title={p.description} />
                ))}
                <th>Tags</th>
                <SortHeader label="Last LLM run" sortKey="lastLlmRunAt" {...sortProps} />
                <th class="actions-col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {!data && loading
                ? Array.from({ length: 10 }, (_, i) => (
                    <tr key={i} class="skeleton-row">
                      <td colSpan={9 + scorePrompts.length}>
                        <span class="skeleton" style={{ width: `${40 + ((i * 23) % 50)}%`, height: '14px' }} />
                      </td>
                    </tr>
                  ))
                : rows.map((r, i) => {
                    const cap = money(r.marketCap);
                    const task = tasks.get(taskKey('analysis', r.symbol));
                    const busy = task && isActive(task);
                    return (
                      <tr key={r.symbol} class={busy ? 'is-busy' : ''} onClick={() => navigate(`/stock/${encodeURIComponent(r.symbol)}`)} style={{ '--i': i }}>
                        <td class="company">
                          <a href={`#/stock/${encodeURIComponent(r.symbol)}`} onClick={(e) => e.preventDefault()}>
                            <Avatar symbol={r.symbol} src={r.image} />
                            <span class="company__text">
                              <span class="company__symbol">{r.symbol}</span>
                              <span class="company__name">{r.name}</span>
                            </span>
                          </a>
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
                        <td>
                          <FloatGauge ratio={r.floatRatio} />
                        </td>
                        <td class="country" title={countryName(r.country)}>
                          <span class="flag">{flag(r.country)}</span>
                          <span class="country__code">{r.country}</span>
                        </td>
                        {scorePrompts.map((p) => (
                          <td key={p.id}>
                            <ScoreCell score={r.scores[p.id]} />
                          </td>
                        ))}
                        <td class="tags-cell">
                          {r.tags.slice(0, 2).map((t) => (
                            <Chip
                              key={t}
                              active={params.tags.includes(t)}
                              onClick={() => {
                                if (!params.tags.includes(t)) set({ tags: [...params.tags, t] });
                              }}
                            >
                              {t}
                            </Chip>
                          ))}
                          {r.tags.length > 2 && (
                            <span class="more" title={r.tags.slice(2).join(', ')}>
                              +{r.tags.length - 2}
                            </span>
                          )}
                          {!r.tags.length && <span class="muted-dash">—</span>}
                        </td>
                        <td class="when" title={fullTime(r.lastLlmRunAt)}>
                          {busy ? (
                            <span class={`state state--${task.state}`}>
                              <Spinner size={11} /> {task.state === 'queued' ? 'Queued' : 'Analysing'}
                            </span>
                          ) : inBatch.has(r.symbol) ? (
                            <span class="state state--batch" title="Waiting for a Gemini batch job">
                              <I.Clock size={12} /> In batch
                            </span>
                          ) : (
                            <span class={r.lastLlmRunAt ? '' : 'muted'}>{relTime(r.lastLlmRunAt)}</span>
                          )}
                        </td>
                        <td class="actions-col">
                          <button
                            class="icon-btn"
                            disabled={!!busy}
                            title={`Score, tag and introduce ${r.symbol}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void runAnalysis([r.symbol], 'analysis');
                            }}
                          >
                            <I.Bolt size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {data && !rows.length && !loading && (
            <div class="empty">
              <I.Search size={22} />
              <p>{sync?.total ? 'No companies match these filters.' : sync?.running ? 'Loading the market…' : 'No companies yet.'}</p>
            </div>
          )}
          {error && <div class="empty empty--error">{error}</div>}
        </div>
        {data && data.total > 0 && <Pager page={params.page} total={data.total} pageSize={params.pageSize} onPage={(p) => { writeParams({ ...params, page: p }); scrollToTop(tableScroll.current, 'smooth'); }} />}
      </section>
      {batchSymbols && <BatchModal symbols={batchSymbols} onClose={() => setBatchSymbols(null)} />}
    </div>
  );
}
