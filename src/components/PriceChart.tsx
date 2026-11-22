import type { Chart as ChartJs, Plugin } from 'chart.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api } from '../api.ts';
import { useSettings } from '../settings.ts';
import { useTheme } from '../theme.ts';
import type { PricePoint } from '../types.ts';
import * as I from './icons.tsx';
import { Spinner } from './ui.tsx';

const RANGES = [
  { id: '1M', name: 'Past month', months: 1 },
  { id: '3M', name: 'Past 3 months', months: 3 },
  { id: '6M', name: 'Past 6 months', months: 6 },
  { id: 'YTD', name: 'Year to date', months: 0 },
  { id: '1Y', name: 'Past year', months: 12 },
  { id: '5Y', name: 'Past 5 years', months: 60 },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

/** The range sticks while the app is open, so comparing stocks keeps the same window. */
let lastRange: RangeId = '1Y';

type ChartCtor = typeof import('./chart-lib.ts').Chart;
let lib: Promise<ChartCtor> | null = null;
const loadChart = () => (lib ??= import('./chart-lib.ts').then((m) => m.Chart));

type Rgb = [number, number, number];

function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const rgb = (name: string) => v(name).split(/[\s,]+/).map(Number).slice(0, 3) as Rgb;
  return { up: rgb('--mint-rgb'), down: rgb('--coral-rgb'), ink: rgb('--ink-rgb'), text3: v('--text-3'), bg: v('--bg'), font: v('--sans') };
}

const rgba = (c: Rgb, a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

function usd(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })}`;
}

const day = (date: string) => new Date(`${date}T00:00:00`);

function longDate(date: string) {
  return day(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Cuts a range out of the series, counting back from its latest close rather than from today. */
function slice(points: PricePoint[], id: RangeId): PricePoint[] {
  const last = points.at(-1);
  if (!last) return [];
  const anchor = day(last.date);
  let start: string;
  if (id === 'YTD') start = `${anchor.getFullYear()}-01-01`;
  else {
    const months = RANGES.find((r) => r.id === id)!.months;
    const d = new Date(anchor);
    d.setMonth(d.getMonth() - months);
    start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return points.filter((p) => p.date >= start);
}

export function PriceChart({ symbol }: { symbol: string }) {
  const settings = useSettings();
  const theme = useTheme();
  const [points, setPoints] = useState<PricePoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeId>(lastRange);
  const [hover, setHover] = useState<number | null>(null);
  const [Chart, setChart] = useState<ChartCtor | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<ChartJs<'line', number[], string> | null>(null);
  const drawn = useRef<{ theme: string; series: PricePoint[] | null }>({ theme, series: null });
  const colors = useRef(palette());
  const longSpan = useRef(false);
  const hasKey = !!settings.fmpKey;

  useEffect(() => {
    let live = true;
    setPoints(null);
    setError(null);
    if (!hasKey) return;
    Promise.all([api.prices(symbol), loadChart()])
      .then(([p, C]) => {
        if (!live) return;
        setChart(() => C);
        setPoints(p);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [symbol, hasKey]);

  useEffect(
    () => () => {
      chart.current?.destroy();
      chart.current = null;
    },
    [],
  );

  const series = useMemo(() => (points ? slice(points, range) : null), [points, range]);
  const ok = !!series && series.length >= 2;

  useEffect(() => {
    if (!Chart || !canvas.current) return;
    const themeChanged = drawn.current.theme !== theme;
    if (chart.current && themeChanged) {
      chart.current.destroy();
      chart.current = null;
    }
    if (!chart.current) {
      colors.current = palette();
      const c = colors.current;
      const guides: Plugin<'line'> = {
        id: 'guides',
        beforeDatasetsDraw(ch) {
          const data = ch.data.datasets[0]?.data as number[] | undefined;
          if (!data?.length) return;
          const { ctx, chartArea: a, scales } = ch;
          ctx.save();
          ctx.lineWidth = 1;
          // Where the period opened: everything above it is a gain.
          const base = scales.y!.getPixelForValue(data[0]!);
          ctx.strokeStyle = rgba(colors.current.ink, 0.22);
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(a.left, base);
          ctx.lineTo(a.right, base);
          ctx.stroke();
          const active = ch.getActiveElements()[0];
          if (active) {
            ctx.setLineDash([]);
            ctx.strokeStyle = rgba(colors.current.ink, 0.3);
            ctx.beginPath();
            ctx.moveTo(active.element.x, a.top);
            ctx.lineTo(active.element.x, a.bottom);
            ctx.stroke();
          }
          ctx.restore();
        },
      };
      chart.current = new Chart(canvas.current, {
        type: 'line',
        data: { labels: [], datasets: [{ data: [], fill: 'start', tension: 0, borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 4.5, pointHoverBorderWidth: 2 }] },
        plugins: [guides],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { top: 6 } },
          font: { family: c.font, size: 11 },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: c.text3,
                autoSkip: true,
                maxTicksLimit: 6,
                maxRotation: 0,
                padding: 8,
                callback(value) {
                  const d = day(this.getLabelForValue(Number(value)));
                  return longSpan.current
                    ? `${d.toLocaleDateString('en-US', { month: 'short' })} ’${String(d.getFullYear()).slice(2)}`
                    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                },
              },
            },
            y: {
              position: 'right',
              grace: '4%',
              border: { display: false },
              grid: { color: rgba(c.ink, 0.06), drawTicks: false },
              ticks: { color: c.text3, padding: 10, maxTicksLimit: 5, callback: (v) => usd(Number(v)).replace(/\.00$/, '') },
            },
          },
          onHover: (_e, active) => setHover(active[0]?.index ?? null),
        },
      });
    }

    const ch = chart.current;
    const ds = ch.data.datasets[0]!;
    const data = ok ? series!.map((p) => p.price) : [];
    const tone = ok && data.at(-1)! < data[0]! ? colors.current.down : colors.current.up;
    longSpan.current = ok && day(series!.at(-1)!.date).getTime() - day(series![0]!.date).getTime() > 200 * 86_400_000;
    ch.data.labels = ok ? series!.map((p) => p.date) : [];
    ds.data = data;
    ds.borderColor = rgba(tone, 1);
    ds.pointHoverBackgroundColor = rgba(tone, 1);
    ds.pointHoverBorderColor = colors.current.bg;
    ds.backgroundColor = (ctx) => {
      const a = ctx.chart.chartArea;
      if (!a) return 'transparent';
      const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
      g.addColorStop(0, rgba(tone, 0.22));
      g.addColorStop(1, rgba(tone, 0));
      return g;
    };
    ch.setActiveElements([]);
    ch.update('none');
    setHover(null);

    const seriesChanged = drawn.current.series !== series;
    drawn.current = { theme, series };
    if (ok && seriesChanged && !themeChanged && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      canvas.current.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 700, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
  }, [Chart, series, theme]);

  const pick = (id: RangeId) => {
    lastRange = id;
    setRange(id);
  };

  const rangeName = RANGES.find((r) => r.id === range)!.name;
  const first = ok ? series![0]! : null;
  const last = ok ? series!.at(-1)! : null;
  const shown = ok ? (hover != null && series![hover]) || last : null;
  const change = shown && first ? shown.price - first.price : 0;
  const changePct = first ? (change / first.price) * 100 : 0;
  const prices = ok ? series!.map((p) => p.price) : [];
  const high = prices.length ? Math.max(...prices) : 0;
  const low = prices.length ? Math.min(...prices) : 0;
  const label = ok
    ? `${symbol} daily close, ${rangeName.toLowerCase()}: ${usd(first!.price)} to ${usd(last!.price)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`
    : `${symbol} price chart`;

  let overlay = null;
  if (!hasKey)
    overlay = (
      <p>
        <a href="#/settings">Add an FMP key</a> to chart prices.
      </p>
    );
  else if (error) overlay = <p class="price-chart__error">{error}</p>;
  else if (!points)
    overlay = (
      <p>
        <Spinner /> Loading prices…
      </p>
    );
  else if (!ok) overlay = <p>{points.length ? 'Not enough trading days in this range yet.' : 'FMP has no price history for this symbol.'}</p>;

  return (
    <section class="card panel price-panel">
      <header class="panel__head price-panel__head">
        <div class="price-readout" aria-live="polite">
          <h2 class="panel__title">
            <I.TrendLine size={16} /> Price
          </h2>
          {shown && (
            <p class="price-readout__line">
              <span class="price-readout__price num">{usd(shown.price)}</span>
              <span class={`price-readout__chg num ${change >= 0 ? 'up' : 'down'}`}>
                {change >= 0 ? '+' : '−'}
                {usd(Math.abs(change)).slice(1)} ({change >= 0 ? '+' : '−'}
                {Math.abs(changePct).toFixed(2)}%)
              </span>
              <span class="price-readout__when">{hover != null ? longDate(shown.date) : rangeName}</span>
            </p>
          )}
        </div>
        <div class="seg seg--range" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button key={r.id} type="button" class={range === r.id ? 'is-on' : ''} aria-pressed={range === r.id} title={r.name} onClick={() => pick(r.id)}>
              {r.id}
            </button>
          ))}
        </div>
      </header>
      <div class="price-chart" onPointerLeave={() => setHover(null)}>
        <canvas ref={canvas} role="img" aria-label={label} style={{ visibility: ok ? 'visible' : 'hidden' }} />
        {overlay && <div class="price-chart__state">{overlay}</div>}
      </div>
      {ok && (
        <dl class="price-stats">
          <div>
            <dt>Open</dt>
            <dd class="num">{usd(first!.price)}</dd>
          </div>
          <div>
            <dt>High</dt>
            <dd class="num">{usd(high)}</dd>
          </div>
          <div>
            <dt>Low</dt>
            <dd class="num">{usd(low)}</dd>
          </div>
          <div>
            <dt>Last close</dt>
            <dd class="num">
              {usd(last!.price)} <span class="muted">{longDate(last!.date)}</span>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
