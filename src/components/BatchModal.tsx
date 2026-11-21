import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api } from '../api.ts';
import { cancel, check, isOpenBatch, submit, useBatches } from '../batches.ts';
import { fullTime, relTime } from '../format.ts';
import * as I from './icons.tsx';
import { Modal, Spinner } from './ui.tsx';
import type { BatchDraft, BatchRecord } from '../types.ts';

type Phase = { name: 'preparing'; done: number; total: number } | { name: 'review'; draft: BatchDraft } | { name: 'error'; message: string };

const fmt = (n: number) => n.toLocaleString('en-US');
const tokens = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const THINKING: Record<string, string> = { default: 'default thinking', minimal: 'minimal thinking', low: 'low thinking', medium: 'medium thinking', high: 'high thinking' };

/** Builds every request locally, shows them for review, and only then submits one Gemini batch job. */
export function BatchModal({ symbols, onClose }: { symbols: string[]; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ name: 'preparing', done: 0, total: symbols.length });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = (abort.current = new AbortController());
    api
      .prepareBatch(symbols, (done, total) => !ctrl.signal.aborted && setPhase({ name: 'preparing', done, total }), ctrl.signal)
      .then((draft) => {
        setSelected(new Set(draft.items.map((i) => i.symbol)));
        setPhase({ name: 'review', draft });
      })
      .catch((e: unknown) => !ctrl.signal.aborted && setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => ctrl.abort();
  }, []);

  const close = () => {
    if (submitting) return;
    abort.current?.abort();
    onClose();
  };

  const draft = phase.name === 'review' ? phase.draft : null;
  const chosen = useMemo(() => draft?.items.filter((i) => selected.has(i.symbol)) ?? [], [draft, selected]);
  const totalTokens = chosen.reduce((sum, i) => sum + i.approxTokens, 0);
  const allOn = !!draft && chosen.length === draft.items.length;

  const toggle = (symbol: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(symbol)) next.add(symbol);
      return next;
    });

  const send = async () => {
    if (!draft || !chosen.length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submit(draft, chosen.map((i) => i.symbol));
      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={close} label="Review batch analysis" variant="sheet">
      <div class="bsheet card">
        <header class="bsheet__head">
          <p class="eyebrow">Batch analysis</p>
          <h2 class="bsheet__title">
            {draft ? `Review ${fmt(draft.items.length)} ${draft.items.length === 1 ? 'request' : 'requests'}` : phase.name === 'error' ? 'Couldn’t prepare the batch' : 'Gathering context…'}
          </h2>
          {draft && (
            <p class="bsheet__meta">
              <span class="mono">{draft.model}</span>
              <span>{THINKING[draft.thinking] ?? draft.thinking}</span>
              <span>scores · tags · introduction</span>
            </p>
          )}
        </header>

        {phase.name === 'preparing' && (
          <div class="bsheet__state" aria-live="polite">
            <Spinner size={18} />
            <p>
              Loading profiles and 30 days of news from FMP · {fmt(phase.done)} of {fmt(phase.total)}
            </p>
            <div class="progress">
              <i style={{ width: `${Math.max(3, phase.total ? (phase.done / phase.total) * 100 : 0)}%` }} />
            </div>
            <p class="muted small">Nothing is sent to Gemini until you confirm.</p>
          </div>
        )}

        {phase.name === 'error' && (
          <div class="bsheet__state bsheet__state--error" role="alert">
            <I.X size={18} />
            <p>{phase.message}</p>
          </div>
        )}

        {draft && (
          <div class="bsheet__scroll">
            <div class="bnote">
              <I.Clock size={16} />
              <p>
                Runs on Gemini’s Batch API at about half the cost of single runs. Most batches finish within minutes; some take up to 24 hours. You can close Meridian:
                the batch id is saved, and results are fetched and applied the next time you open it.
              </p>
            </div>

            <div class="bshared">
              <details>
                <summary>
                  <I.ChevronRight size={14} /> System instruction <span class="muted">· same for every request</span>
                </summary>
                <pre>{draft.system}</pre>
              </details>
              <details>
                <summary>
                  <I.ChevronRight size={14} /> Response schema <span class="muted">· JSON the answer must follow</span>
                </summary>
                <pre>{JSON.stringify(draft.schema, null, 2)}</pre>
              </details>
            </div>

            {draft.skipped.length > 0 && (
              <div class="bskipped">
                <p class="field-title">Left out</p>
                <ul>
                  {draft.skipped.map((s) => (
                    <li key={s.symbol}>
                      <span class="mono">{s.symbol}</span> <span class="muted">{s.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {draft.items.length > 0 && (
              <div class="blist">
                <div class="blist__head">
                  <button
                    type="button"
                    class={`bcheck${allOn ? ' is-on' : ''}`}
                    role="checkbox"
                    aria-checked={allOn ? 'true' : chosen.length ? 'mixed' : 'false'}
                    onClick={() => setSelected(allOn ? new Set() : new Set(draft.items.map((i) => i.symbol)))}
                  >
                    <span class="check">{allOn ? <I.Check size={11} /> : chosen.length ? <span class="check__dash" /> : null}</span>
                    {allOn ? 'Deselect all' : 'Select all'}
                  </button>
                  <span class="muted small">Expand a stock to read its full prompt and context</span>
                </div>
                {draft.items.map((item) => {
                  const on = selected.has(item.symbol);
                  return (
                    <div key={item.symbol} class={`breq${on ? '' : ' is-off'}`}>
                      <button
                        type="button"
                        class={`bcheck${on ? ' is-on' : ''}`}
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`Include ${item.symbol}`}
                        onClick={() => toggle(item.symbol)}
                      >
                        <span class="check">{on && <I.Check size={11} />}</span>
                      </button>
                      <details>
                        <summary>
                          <span class="breq__symbol">{item.symbol}</span>
                          <span class="breq__name">{item.name}</span>
                          <span class="breq__facts">
                            <span>{item.newsCount} news</span>
                            <span>~{tokens(item.approxTokens)} tokens</span>
                          </span>
                          <I.ChevronDown size={14} />
                        </summary>
                        <pre>{item.prompt}</pre>
                      </details>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <footer class="bsheet__foot">
          {submitError ? (
            <span class="test test--error">
              <I.X size={13} /> {submitError}
            </span>
          ) : (
            <span class="muted small">{draft ? `${fmt(chosen.length)} of ${fmt(draft.items.length)} selected · ~${tokens(totalTokens)} input tokens` : ''}</span>
          )}
          <span class="toolbar__spacer" />
          <button class="btn" onClick={close} disabled={submitting}>
            Cancel
          </button>
          <button class="btn btn--primary" onClick={send} disabled={!chosen.length || submitting}>
            {submitting ? <Spinner /> : <I.Stack size={16} />}
            {submitting ? 'Submitting…' : `Submit batch (${fmt(chosen.length)})`}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

const STATE_LABEL: Record<BatchRecord['state'], string> = {
  pending: 'Queued on Gemini',
  running: 'Running on Gemini',
  succeeded: 'Finished',
  failed: 'Failed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** One line per unfinished batch job, above the stock table. */
export function BatchBar() {
  const { batches, checking } = useBatches();
  const open = batches.filter(isOpenBatch);
  if (!open.length) return null;
  return (
    <>
      {open.map((b) => {
        const done = b.stats ? b.stats.succeeded + b.stats.failed : 0;
        const total = b.stats?.total || b.symbols.length;
        const pct = total ? (done / total) * 100 : 0;
        return (
          <section key={b.id} class="syncbar card bbar" aria-live="polite">
            <div class="syncbar__head">
              {checking ? <Spinner /> : <I.Clock size={16} />}
              <span>
                Batch analysis · {fmt(b.symbols.length)} {b.symbols.length === 1 ? 'stock' : 'stocks'}
                <span class="muted">
                  {' '}
                  · {STATE_LABEL[b.state]}
                  {done > 0 && ` · ${fmt(done)} of ${fmt(total)} answered`} · submitted <span title={fullTime(b.createdAt)}>{relTime(b.createdAt)}</span>
                </span>
              </span>
              <span class="bbar__actions">
                <button class="link-btn" onClick={() => void check({ manual: true })} disabled={checking} title={b.checkedAt ? `Last checked ${relTime(b.checkedAt)}` : undefined}>
                  Check now
                </button>
                <button
                  class="link-btn"
                  onClick={() => {
                    if (confirm(`Cancel the batch of ${b.symbols.length} stocks? Answers already produced are discarded.`)) void cancel(b.id);
                  }}
                >
                  Cancel
                </button>
              </span>
            </div>
            <div class={`progress${done ? '' : ' progress--wait'}`}>
              <i style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
          </section>
        );
      })}
    </>
  );
}
