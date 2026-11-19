import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { api } from '../api.ts';
import { compact, countryName, flag, fullTime, money, relTime } from '../format.ts';
import { useSettings } from '../settings.ts';
import { isActive, runAnalysis, taskKey, useOnTasksFinished, useTasks } from '../tasks.ts';
import { toast } from '../toast.ts';
import * as I from '../components/icons.tsx';
import { Avatar, Chip, FloatGauge, Heat, Markdown, Modal, ScoreDial, Spinner, svgUrl } from '../components/ui.tsx';
import type { Diagram, PromptConfig, StockDetail as Detail, TagInfo, TaskStatus } from '../types.ts';

function Fact({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TagEditor({ symbol, tags, onChange }: { symbol: string; tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState<TagInfo[]>([]);
  const [active, setActive] = useState(-1);
  const listId = `tag-options-${symbol}`;

  const loadLibrary = () => api.tagLibrary().then(setLibrary).catch(() => {});
  useEffect(() => void loadLibrary(), []);

  const q = draft.trim();
  const key = q.toLowerCase();
  const onStock = new Set(tags.map((t) => t.toLowerCase()));
  const exact = library.find((t) => t.name.toLowerCase() === key);
  const options = useMemo(() => {
    const free = library.filter((t) => !t.blocked && !onStock.has(t.name.toLowerCase()));
    const hits = key ? free.filter((t) => t.name.toLowerCase().includes(key)) : free;
    const starts = (t: TagInfo) => (t.name.toLowerCase().startsWith(key) ? 0 : 1);
    const list: { name: string; count: number; kind: 'pick' | 'create' | 'restore' }[] = hits
      .sort((a, b) => starts(a) - starts(b) || b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((t) => ({ name: t.name, count: t.count, kind: 'pick' }));
    if (q && !onStock.has(key) && (!exact || exact.blocked)) list.push({ name: exact?.name ?? q, count: 0, kind: exact ? 'restore' : 'create' });
    return list;
  }, [library, tags, key]);

  const save = async (next: string[]) => {
    setSaving(true);
    try {
      onChange((await api.setTags(symbol, next)).tags);
      void loadLibrary();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSaving(false);
    }
  };
  const add = (name: string) => {
    const t = name.trim();
    setDraft('');
    setActive(-1);
    if (t && !onStock.has(t.toLowerCase())) void save([...tags, t]);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i < 0 && step < 0 ? options.length - 1 : (i + step + options.length) % options.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = open && active >= 0 ? options[active] : undefined;
      add(pick ? pick.name : (exact && !exact.blocked ? exact.name : q));
    } else if (e.key === 'Escape') {
      if (open) e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };
  const showList = open && (options.length > 0 || !!q);

  return (
    <div class={`tag-editor${saving ? ' is-saving' : ''}`}>
      {tags.map((t) => (
        <Chip key={t} onRemove={() => save(tags.filter((x) => x !== t))}>
          <a href={`#/?tags=${encodeURIComponent(t)}`} class="chip__link">
            {t}
          </a>
        </Chip>
      ))}
      <div class="tag-combo">
        <label class="tag-editor__add">
          <I.Plus size={13} />
          <input
            role="combobox"
            aria-label="Add tag"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            value={draft}
            maxLength={32}
            placeholder="Add tag"
            onFocus={() => {
              setOpen(true);
              void loadLibrary();
            }}
            onBlur={() => {
              setOpen(false);
              setActive(-1);
            }}
            onInput={(e) => {
              setDraft(e.currentTarget.value);
              setOpen(true);
              setActive(e.currentTarget.value.trim() ? 0 : -1);
            }}
            onKeyDown={onKeyDown}
          />
        </label>
        {showList && (
          <div class="popover tag-combo__pop">
            <ul class="popover__list" id={listId} role="listbox" aria-label="Tag suggestions">
              {options.map((o, i) => (
                <li
                  key={`${o.kind}:${o.name}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  class={`popover__row tag-combo__opt${i === active ? ' is-active' : ''}${o.kind !== 'pick' ? ' is-create' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => add(o.name)}
                >
                  {o.kind === 'pick' ? <I.Tag size={13} /> : <I.Plus size={13} />}
                  <span class="popover__label">
                    {o.kind === 'create' ? `Create “${o.name}”` : o.kind === 'restore' ? `Restore deleted tag “${o.name}”` : o.name}
                  </span>
                  {o.kind === 'pick' && <span class="tag-combo__count num">{o.count}</span>}
                </li>
              ))}
            </ul>
            {!options.length && <p class="popover__empty">“{q}” is already on this company</p>}
            <div class="popover__foot">
              <a class="link-btn" href="#/tags" onMouseDown={(e) => e.preventDefault()}>
                Manage tags
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Diagrams({ symbol, diagrams, promptCount, task }: { symbol: string; diagrams: Diagram[]; promptCount: number; task?: TaskStatus }) {
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState<Diagram | null>(null);
  const close = useCallback(() => setZoom(null), []);
  const busy = task ? isActive(task) : false;
  const d = diagrams[Math.min(active, diagrams.length - 1)];
  const noun = `${promptCount} ${promptCount === 1 ? 'diagram' : 'diagrams'}`;
  return (
    <section class="card panel" aria-busy={busy}>
      <header class="panel__head panel__head--wrap">
        <div>
          <h2 class="panel__title">
            <I.Grid size={16} /> Diagrams
          </h2>
          <p class="panel__sub">Generated on demand, separately from the analysis.</p>
        </div>
        {promptCount > 0 ? (
          <button class="btn" disabled={busy} onClick={() => runAnalysis([symbol], 'diagrams')}>
            {busy ? <Spinner /> : d ? <I.Refresh size={15} /> : <I.Sparkle size={15} />}
            {busy ? (task?.state === 'queued' ? 'Queued…' : 'Designing…') : d ? 'Regenerate' : `Generate ${noun}`}
          </button>
        ) : (
          <a class="link-btn" href="#/prompts">
            Add diagram prompts
          </a>
        )}
      </header>
      {task?.state === 'error' && <div class="banner banner--error">Diagram generation failed: {task.error}</div>}
      {d && diagrams.length > 1 && (
        <div class="seg diagram-tabs">
          {diagrams.map((x, i) => (
            <button key={x.promptId} class={i === active ? 'is-on' : ''} onClick={() => setActive(i)}>
              {x.title}
            </button>
          ))}
        </div>
      )}
      {d ? (
        <button
          class={`diagram${d.horizontal ? ' has-h' : ''}${d.vertical ? ' has-v' : ''}${busy ? ' is-stale' : ''}`}
          onClick={() => setZoom(d)}
          title="Open full screen"
        >
          {d.horizontal && <img class="diagram__h" src={svgUrl(d.horizontal)} alt={`${d.title} (landscape)`} />}
          {d.vertical && <img class="diagram__v" src={svgUrl(d.vertical)} alt={`${d.title} (portrait)`} />}
          <span class="diagram__zoom">
            <I.Maximize size={14} />
          </span>
        </button>
      ) : (
        <div class={`diagram-empty${busy ? ' is-busy' : ''}`}>
          {busy ? <Spinner /> : <I.Grid size={22} />}
          <p class="diagram-empty__title">{busy ? `Designing ${noun}…` : 'No diagrams yet'}</p>
          <p class="muted small">
            {busy
              ? 'Usually a minute or two. You can keep browsing; they will appear here when ready.'
              : promptCount > 0
                ? `Generate ${noun} from your diagram prompts. Takes a minute or two.`
                : 'Add a diagram prompt to start generating SVG diagrams.'}
          </p>
        </div>
      )}
      {zoom && (
        <Modal onClose={close} label={zoom.title}>
          <div class={`diagram diagram--full${zoom.horizontal ? ' has-h' : ''}${zoom.vertical ? ' has-v' : ''}`}>
            {zoom.horizontal && <img class="diagram__h" src={svgUrl(zoom.horizontal)} alt={zoom.title} />}
            {zoom.vertical && <img class="diagram__v" src={svgUrl(zoom.vertical)} alt={zoom.title} />}
          </div>
        </Modal>
      )}
    </section>
  );
}

export function StockDetail({ symbol }: { symbol: string }) {
  const settings = useSettings();
  const [data, setData] = useState<Detail | null>(null);
  const [prompts, setPrompts] = useState<PromptConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heatLoading, setHeatLoading] = useState(false);
  const tasks = useTasks();
  const task = tasks.get(taskKey('analysis', symbol));
  const diagramTask = tasks.get(taskKey('diagrams', symbol));
  const busy = task ? isActive(task) : false;

  const load = useCallback(async () => {
    try {
      const d = await api.detail(symbol);
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
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [symbol, settings.fmpKey]);

  useEffect(() => {
    setData(null);
    void load();
    api.prompts().then(setPrompts).catch(() => {});
    window.scrollTo({ top: 0 });
  }, [load]);

  useOnTasksFinished(useCallback((symbols: string[]) => symbols.includes(symbol) && void load(), [symbol, load]));

  if (error) {
    return (
      <div class="page">
        <a class="back" href="#/">
          <I.ChevronLeft size={16} /> Market
        </a>
        <div class="empty empty--error">{error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div class="page detail">
        <a class="back" href="#/">
          <I.ChevronLeft size={16} /> Market
        </a>
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

  const cap = money(data.marketCap);
  const up = (data.changePercentage ?? 0) >= 0;
  const scorePrompts = prompts?.scorePrompts ?? [];
  const analysed = !!data.lastLlmRunAt;

  return (
    <div class="page detail">
      <a class="back" href="#/" onClick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}>
        <I.ChevronLeft size={16} /> Market
      </a>

      <section class="detail-hero">
        <Avatar symbol={data.symbol} src={data.image} size={88} />
        <div class="detail-hero__main">
          <div class="detail-hero__meta">
            <span class="ticker">{data.symbol}</span>
            <span class={`exch exch--${data.exchange.toLowerCase()}`}>{data.exchange}</span>
            <span class="muted">
              {flag(data.country)} {countryName(data.country)}
            </span>
          </div>
          <h1 class="display display--detail">{data.name}</h1>
          <p class="muted">{[data.sector, data.industry].filter(Boolean).join(' · ')}</p>
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
          <button class="btn btn--primary" disabled={busy} onClick={() => runAnalysis([data.symbol], 'analysis')}>
            {busy ? <Spinner /> : <I.Sparkle size={16} />}
            {busy ? (task?.state === 'queued' ? 'Queued…' : 'Analysing…') : analysed ? 'Re-run analysis' : 'Run analysis'}
          </button>
          <span class="muted small" title={fullTime(data.lastLlmRunAt)}>
            {analysed ? `Last LLM run ${relTime(data.lastLlmRunAt)}${data.llmModel ? ` · ${data.llmModel}` : ''}` : 'Not analysed yet'}
          </span>
        </div>
      </section>

      {data.llmError && !busy && <div class="banner banner--error">Last analysis failed: {data.llmError}</div>}
      {busy && (
        <div class="banner banner--busy">
          <Spinner /> Gemini is reading the news and profile for {data.symbol} to score, tag and introduce it.
        </div>
      )}

      <dl class="facts card">
        <Fact label="Market cap">
          <span class="num big">
            {cap.value}
            <span class="cap__unit">{cap.unit}</span>
          </span>
        </Fact>
        <Fact label="Heat · 30d news">
          <Heat count={data.heat} loading={heatLoading} label />
        </Fact>
        <Fact label="Float / outstanding">
          <FloatGauge ratio={data.floatRatio} size={26} />
          <span class="muted small num">
            {compact(data.floatShares)} / {compact(data.outstandingShares)}
          </span>
        </Fact>
        <Fact label="Exchange">{data.exchangeFullName || data.exchange}</Fact>
        <Fact label="Country">
          {flag(data.country)} {countryName(data.country)}
        </Fact>
        <Fact label="Last LLM run">
          <span title={fullTime(data.lastLlmRunAt)}>{relTime(data.lastLlmRunAt)}</span>
        </Fact>
        {data.ceo && <Fact label="CEO">{data.ceo}</Fact>}
        {data.employees != null && <Fact label="Employees">{data.employees.toLocaleString('en-US')}</Fact>}
        {data.ipoDate && <Fact label="IPO">{new Date(data.ipoDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</Fact>}
        {data.range && <Fact label="52-week range"><span class="num">{data.range}</span></Fact>}
        {data.website && (
          <Fact label="Website">
            <a href={data.website} target="_blank" rel="noopener noreferrer" class="ext">
              {data.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} <I.Link size={12} />
            </a>
          </Fact>
        )}
      </dl>

      <div class="detail-grid">
        <div class="detail-main">
          <section class="card panel">
            <header class="panel__head">
              <h2 class="panel__title">
                <I.Sparkle size={16} /> Scores
              </h2>
              <a class="link-btn" href="#/prompts">
                Edit prompts
              </a>
            </header>
            {scorePrompts.length === 0 ? (
              <p class="muted">No score prompts configured.</p>
            ) : (
              <div class="scores">
                {scorePrompts.map((p) => {
                  const s = data.scores[p.id];
                  return (
                    <article key={p.id} class="score-card">
                      <ScoreDial score={s?.score} />
                      <div class="score-card__body">
                        <h3>{p.title}</h3>
                        <p class="score-card__reason">{s?.reason || <span class="muted">Run an analysis to score this criterion.</span>}</p>
                        <p class="score-card__prompt">{p.description}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {(data.diagrams.length > 0 || (prompts?.svgPrompts.length ?? 0) > 0) && (
            <Diagrams symbol={data.symbol} diagrams={data.diagrams} promptCount={prompts?.svgPrompts.length ?? 0} task={diagramTask} />
          )}

          <section class="card panel">
            <header class="panel__head">
              <h2 class="panel__title">
                <I.Quill size={16} /> Introduction
              </h2>
            </header>
            {data.introduction ? (
              <Markdown source={data.introduction} />
            ) : data.description ? (
              <div class="prose">
                <p>{data.description}</p>
                <p class="muted small">Company-provided description. Run an analysis for an AI-written introduction.</p>
              </div>
            ) : (
              <p class="muted">Run an analysis to generate an introduction.</p>
            )}
          </section>
        </div>

        <aside class="detail-side">
          <section class="card panel">
            <header class="panel__head">
              <h2 class="panel__title">
                <I.Tag size={16} /> Tags
              </h2>
            </header>
            <TagEditor symbol={data.symbol} tags={data.tags} onChange={(tags) => setData({ ...data, tags })} />
          </section>

          <section class="card panel">
            <header class="panel__head">
              <h2 class="panel__title">
                <I.Users size={16} /> Leadership
              </h2>
            </header>
            {data.leaders.length === 0 ? (
              <p class="muted">{settings.fmpKey ? 'No leadership data available from FMP.' : 'Add an FMP key to load leadership.'}</p>
            ) : (
              <ul class="leaders">
                {data.leaders.slice(0, 12).map((l) => (
                  <li key={l.name + l.title}>
                    <span class="leader__mono" style={{ '--h': (l.name.length * 47) % 360 }}>
                      {l.name
                        .replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, '')
                        .split(/\s+/)
                        .filter((w) => /^[A-Z]/.test(w))
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join('')}
                    </span>
                    <span class="leader__text">
                      <span class="leader__name">{l.name}</span>
                      <span class="leader__title">{l.title}</span>
                      <span class="leader__meta">
                        {l.yearBorn ? `b. ${l.yearBorn}` : ''}
                        {l.yearBorn && l.pay ? ' · ' : ''}
                        {l.pay ? `${l.currencyPay === 'USD' || !l.currencyPay ? '$' : `${l.currencyPay} `}${compact(l.pay)} pay` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
