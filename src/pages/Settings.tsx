import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.ts';
import { fullTime, relTime } from '../format.ts';
import { updateSettings, useSettings } from '../settings.ts';
import { toast } from '../toast.ts';
import * as I from '../components/icons.tsx';
import { Spinner } from '../components/ui.tsx';
import type { SyncStatus } from '../types.ts';

type TestState = { state: 'idle' } | { state: 'testing' } | { state: 'ok'; message: string } | { state: 'error'; message: string };

const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'];

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div class="secret">
      <I.Key size={15} />
      <input
        class="input"
        type={(shown ? 'text' : 'password') as 'text'}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellcheck={false}
        onInput={(e) => onChange(e.currentTarget.value.trim())}
      />
      <button class="icon-btn" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide key' : 'Show key'}>
        {shown ? <I.EyeOff size={15} /> : <I.Eye size={15} />}
      </button>
    </div>
  );
}

function TestResult({ test }: { test: TestState }) {
  if (test.state === 'idle') return null;
  if (test.state === 'testing')
    return (
      <span class="test test--pending">
        <Spinner size={12} /> Testing…
      </span>
    );
  return (
    <span class={`test test--${test.state}`}>
      {test.state === 'ok' ? <I.Check size={13} /> : <I.X size={13} />} {test.message}
    </span>
  );
}

export function Settings() {
  const s = useSettings();
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS);
  const [geminiTest, setGeminiTest] = useState<TestState>({ state: 'idle' });
  const [fmpTest, setFmpTest] = useState<TestState>({ state: 'idle' });
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [customSize, setCustomSize] = useState(String(s.pageSize));

  useEffect(() => {
    if (!s.geminiKey) return;
    const t = setTimeout(() => {
      api
        .models(s.geminiKey)
        .then((m) => m.length && setModels(m.map((x) => x.id)))
        .catch(() => setModels(FALLBACK_MODELS));
    }, 400);
    return () => clearTimeout(t);
  }, [s.geminiKey]);

  useEffect(() => {
    api.syncStatus().then(setSync).catch(() => {});
  }, []);

  useEffect(() => {
    if (!sync?.running) return;
    const t = setTimeout(() => api.syncStatus().then(setSync).catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, [sync]);

  const testGemini = async () => {
    setGeminiTest({ state: 'testing' });
    try {
      const r = await api.testGemini(s.geminiKey, s.geminiModel);
      setGeminiTest({
        state: 'ok',
        message: `Connected in ${r.latencyMs} ms · ${r.modelCount} models${r.modelAvailable ? '' : ` · “${s.geminiModel}” not listed`}`,
      });
    } catch (e) {
      setGeminiTest({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const testFmp = async () => {
    setFmpTest({ state: 'testing' });
    try {
      const r = await api.testFmp(s.fmpKey);
      setFmpTest({ state: 'ok', message: `Connected in ${r.latencyMs} ms` });
    } catch (e) {
      setFmpTest({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const startSync = async () => {
    try {
      setSync(await api.startSync());
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const modelOptions = models.includes(s.geminiModel) ? models : [s.geminiModel, ...models];

  return (
    <div class="page narrow">
      <header class="page-head">
        <p class="eyebrow">Settings</p>
        <h1 class="display display--page">
          Keys, models <em>&amp; preferences.</em>
        </h1>
        <p class="lede">Everything stays in this browser. API keys live in localStorage and go straight to Gemini and FMP; market data and analyses are kept in a local SQLite database.</p>
      </header>

      <section class="card panel">
        <header class="panel__head">
          <div>
            <h2 class="panel__title">
              <I.Sparkle size={16} /> Gemini
            </h2>
            <p class="panel__sub">Powers scores, tags, diagrams and introductions.</p>
          </div>
        </header>
        <div class="field">
          <label>API key</label>
          <SecretInput value={s.geminiKey} onChange={(geminiKey) => { updateSettings({ geminiKey }); setGeminiTest({ state: 'idle' }); }} placeholder="Paste your Gemini API key" />
        </div>
        <div class="field">
          <label>Model</label>
          <div class="select">
            <select value={s.geminiModel} onChange={(e) => updateSettings({ geminiModel: e.currentTarget.value })}>
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <I.ChevronDown size={14} />
          </div>
        </div>
        <div class="field-row">
          <button class="btn" onClick={testGemini} disabled={!s.geminiKey || geminiTest.state === 'testing'}>
            <I.Bolt size={15} /> Test connection
          </button>
          <TestResult test={geminiTest} />
        </div>
      </section>

      <section class="card panel">
        <header class="panel__head">
          <div>
            <h2 class="panel__title">
              <I.Database size={16} /> Financial Modeling Prep
            </h2>
            <p class="panel__sub">Market data, float, news, profiles and leadership.</p>
          </div>
        </header>
        <div class="field">
          <label>API key</label>
          <SecretInput value={s.fmpKey} onChange={(fmpKey) => { updateSettings({ fmpKey }); setFmpTest({ state: 'idle' }); }} placeholder="Paste your FMP API key" />
        </div>
        <div class="field-row">
          <button class="btn" onClick={testFmp} disabled={!s.fmpKey || fmpTest.state === 'testing'}>
            <I.Bolt size={15} /> Test connection
          </button>
          <TestResult test={fmpTest} />
        </div>
        <div class="divider" />
        <div class="field-row field-row--between">
          <div>
            <div class="field-title">Market universe</div>
            <div class="muted small">
              {sync ? `${sync.total.toLocaleString('en-US')} companies · synced ` : ''}
              <span title={fullTime(sync?.lastSyncedAt)}>{sync ? relTime(sync.lastSyncedAt) : '…'}</span>
            </div>
          </div>
          <button class="btn" onClick={startSync} disabled={!s.fmpKey || sync?.running}>
            {sync?.running ? <Spinner /> : <I.Refresh size={15} />}
            {sync?.running ? `${sync.phase} · ${Math.round(sync.progress * 100)}%` : 'Sync now'}
          </button>
        </div>
      </section>

      <section class="card panel">
        <header class="panel__head">
          <div>
            <h2 class="panel__title">
              <I.Rows size={16} /> Display
            </h2>
            <p class="panel__sub">Stocks per page — also the batch size of “Analyse page”.</p>
          </div>
        </header>
        <div class="field-row">
          <div class="seg">
            {[10, 25, 50, 100].map((n) => (
              <button key={n} class={s.pageSize === n ? 'is-on' : ''} onClick={() => { updateSettings({ pageSize: n }); setCustomSize(String(n)); }}>
                {n}
              </button>
            ))}
          </div>
          <input
            class="input input--num"
            type="number"
            min={5}
            max={200}
            value={customSize}
            onInput={(e) => setCustomSize(e.currentTarget.value)}
            onChange={() => {
              const n = Math.min(200, Math.max(5, Number.parseInt(customSize, 10) || 25));
              setCustomSize(String(n));
              updateSettings({ pageSize: n });
            }}
            aria-label="Custom page size"
          />
        </div>
      </section>
    </div>
  );
}
