import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { heatLevel, hue, scoreTone } from '../format.ts';
import { dismiss, useToasts } from '../toast.ts';
import * as I from './icons.tsx';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="14.25" stroke="currentColor" stroke-opacity=".35" stroke-width="1.5" />
      <path d="M16 1.75c-6 7-6 21.5 0 28.5" stroke="currentColor" stroke-opacity=".35" stroke-width="1.5" />
      <path d="M4.5 21.5 11 15l4.5 3.5L27.5 8" stroke="var(--accent)" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="27.5" cy="8" r="2.25" fill="var(--accent)" />
    </svg>
  );
}

export function Avatar({ symbol, src, size = 36 }: { symbol: string; src?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const h = hue(symbol);
  return (
    <span class="avatar" style={{ width: `${size}px`, height: `${size}px`, '--h': h }}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" crossOrigin="anonymous" onError={() => setFailed(true)} />
      ) : (
        <span class="avatar__mono" style={{ fontSize: `${size * 0.36}px` }}>
          {symbol.slice(0, 2)}
        </span>
      )}
    </span>
  );
}

export function ScoreCell({ score }: { score: number | undefined }) {
  if (score == null) return <span class="muted-dash">—</span>;
  return (
    <span class={`score score--${scoreTone(score)}`} title={`${score} / 10`}>
      <span class="score__n">{score}</span>
      <span class="score__bar">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} class={i < score ? 'on' : ''} />
        ))}
      </span>
    </span>
  );
}

export function ScoreDial({ score, size = 76 }: { score: number | undefined; size?: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const arc = 0.75;
  const v = score == null ? 0 : score / 10;
  return (
    <svg class={`dial dial--${scoreTone(score)}`} width={size} height={size} viewBox="0 0 76 76" aria-label={score == null ? 'No score' : `${score} out of 10`}>
      <circle cx="38" cy="38" r={r} class="dial__track" stroke-dasharray={`${c * arc} ${c}`} transform="rotate(135 38 38)" />
      <circle
        cx="38"
        cy="38"
        r={r}
        class="dial__value"
        stroke-dasharray={`${c * arc * v} ${c}`}
        transform="rotate(135 38 38)"
      />
      <text x="38" y="44" text-anchor="middle" class="dial__text">
        {score ?? '–'}
      </text>
    </svg>
  );
}

export function Heat({ count, loading }: { count: number | null; loading?: boolean }) {
  if (loading && count == null) return <span class="skeleton" style={{ width: '64px', height: '14px' }} />;
  const level = heatLevel(count);
  return (
    <span class={`heat heat--${level}${loading ? ' is-refreshing' : ''}`} title={count == null ? 'Not loaded yet' : `${count} news articles in the last 30 days`}>
      <span class="heat__bars">
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} class={i <= level ? 'on' : ''} style={{ height: `${30 + i * 14}%` }} />
        ))}
      </span>
      <span class="heat__n">{count ?? '—'}</span>
    </span>
  );
}

export function FloatGauge({ ratio, size = 22 }: { ratio: number | null; size?: number }) {
  if (ratio == null) return <span class="muted-dash">—</span>;
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <span class="float">
      <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r={r} class="float__track" />
        <circle cx="11" cy="11" r={r} class="float__value" stroke-dasharray={`${c * ratio} ${c}`} transform="rotate(-90 11 11)" />
      </svg>
      <span class="num">{(ratio * 100).toFixed(1)}%</span>
    </span>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span class="spinner" style={{ width: `${size}px`, height: `${size}px` }} />;
}

export function Chip({ children, onRemove, active, onClick }: { children: ComponentChildren; onRemove?: () => void; active?: boolean; onClick?: () => void }) {
  return (
    <span class={`chip${active ? ' chip--active' : ''}${onClick ? ' chip--button' : ''}`} onClick={onClick}>
      {children}
      {onRemove && (
        <button
          class="chip__x"
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <I.X size={12} />
        </button>
      )}
    </span>
  );
}

export interface Option {
  value: string;
  label: ComponentChildren;
  search: string;
  count?: number;
}

export function FilterMenu(props: {
  label: string;
  icon: ComponentChildren;
  options: Option[] | null;
  selected: string[];
  onChange: (v: string[]) => void;
  searchable?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (props.options ?? []).filter((o) => !q || o.search.toLowerCase().includes(q));
  }, [props.options, query]);

  const toggle = (v: string) =>
    props.onChange(props.selected.includes(v) ? props.selected.filter((s) => s !== v) : [...props.selected, v]);
  const max = Math.max(1, ...(props.options ?? []).map((o) => o.count ?? 0));

  return (
    <div class="filter" ref={ref}>
      <button class={`filter__btn${props.selected.length ? ' is-active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {props.icon}
        <span>{props.label}</span>
        {props.selected.length > 0 && <span class="filter__count">{props.selected.length}</span>}
        <I.ChevronDown size={14} class="filter__caret" />
      </button>
      {open && (
        <div class="popover">
          {props.searchable && (
            <div class="popover__search">
              <I.Search size={14} />
              <input ref={searchRef} value={query} placeholder={`Search ${props.label.toLowerCase()}…`} onInput={(e) => setQuery(e.currentTarget.value)} />
            </div>
          )}
          {props.hint && <div class="popover__hint">{props.hint}</div>}
          <div class="popover__list">
            {props.options == null ? (
              Array.from({ length: 6 }, (_, i) => (
                <div class="popover__row" key={i}>
                  <span class="skeleton" style={{ width: `${50 + ((i * 37) % 40)}%`, height: '12px' }} />
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div class="popover__empty">Nothing matches</div>
            ) : (
              filtered.map((o) => {
                const on = props.selected.includes(o.value);
                return (
                  <button class={`popover__row${on ? ' is-on' : ''}`} key={o.value} onClick={() => toggle(o.value)}>
                    <span class="check">{on && <I.Check size={12} />}</span>
                    <span class="popover__label">{o.label}</span>
                    {o.count != null && (
                      <span class="popover__count">
                        <i style={{ width: `${(o.count / max) * 100}%` }} />
                        {o.count.toLocaleString('en-US')}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {props.selected.length > 0 && (
            <div class="popover__foot">
              <button class="link-btn" onClick={() => props.onChange([])}>
                Clear {props.selected.length} selected
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const nums: (number | '…')[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums.at(-1) !== '…') nums.push('…');
  }
  const from = total ? (page - 1) * pageSize + 1 : 0;
  return (
    <div class="pager">
      <span class="pager__info">
        <b>{from.toLocaleString('en-US')}</b>–<b>{Math.min(total, page * pageSize).toLocaleString('en-US')}</b> of <b>{total.toLocaleString('en-US')}</b>
      </span>
      <div class="pager__nums">
        <button class="pager__btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <I.ChevronLeft size={16} />
        </button>
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`e${i}`} class="pager__gap">
              …
            </span>
          ) : (
            <button key={n} class={`pager__btn${n === page ? ' is-current' : ''}`} onClick={() => onPage(n)}>
              {n}
            </button>
          ),
        )}
        <button class="pager__btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <I.ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts();
  return (
    <div class="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast toast--${t.tone}`}>
          <span class="toast__dot" />
          <span>{t.message}</span>
          <button class="toast__x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <I.X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Modal({ onClose, children, label }: { onClose: () => void; children: ComponentChildren; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div class="modal" role="dialog" aria-label={label} onClick={onClose}>
      <button class="modal__x" onClick={onClose} aria-label="Close">
        <I.X size={20} />
      </button>
      <div class="modal__body" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

/** Minimal, escape-first markdown renderer for LLM output (headings, lists, emphasis, links). */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if (!line) {
      flushPara();
      closeList();
    } else if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      flushPara();
      closeList();
      const level = Math.min(4, m[1]!.length + 1);
      out.push(`<h${level}>${inline(m[2]!)}</h${level}>`);
    } else if ((m = /^[-*•]\s+(.*)$/.exec(line)) || (m = /^\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      const kind = /^\d/.test(line) ? 'ol' : 'ul';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(m[1]!)}</li>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr/>');
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
}

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => markdownToHtml(source), [source]);
  return <div class="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
