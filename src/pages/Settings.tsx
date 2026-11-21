import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.ts';
import { THINKING_LEVELS, usesThinkingBudget, type ThinkingLevel } from '../data/gemini.ts';
import { fullTime, relTime } from '../format.ts';
import { updateSettings, useSettings } from '../settings.ts';
import { toast } from '../toast.ts';
import * as I from '../components/icons.tsx';
import { Spinner } from '../components/ui.tsx';
import type { SyncStatus } from '../types.ts';

type TestState = { state: 'idle' } | { state: 'testing' } | { state: 'ok'; message: string } | { state: 'error'; message: string };

const THINKING_LABELS: Record<ThinkingLevel, string> = { default: 'Default', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High' };

type ModelOption = { id: string; batch: boolean };
const FALLBACK_MODELS: ModelOption[] = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'].map((id) => ({ id, batch: true }));

function ModelSelect({ id, value, models, onChange }: { id: string; value: string; models: string[]; onChange: (v: string) => void }) {
  const options = models.includes(value) ? models : [value, ...models];
  return (
    <div class="select">
      <select id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <I.ChevronDown size={14} />
    </div>
  );
}

function ThinkingField({ id, label, model, value, onChange, slowNote }: { id: string; label: string; model: string; value: ThinkingLevel; onChange: (v: ThinkingLevel) => void; slowNote: string }) {
  return (
    <div class="field">
      <label id={id}>{label}</label>
      <div class="seg field__seg" role="group" aria-labelledby={id}>
        {THINKING_LEVELS.map((level) => (
          <button key={level} class={value === level ? 'is-on' : ''} aria-pressed={value === level} onClick={() => onChange(level)}>
            {THINKING_LABELS[level]}
          </button>
        ))}
      </div>
      <p class="field-hint">
        {usesThinkingBudget(model) ? 'Gemini 2.5 uses a token budget: Minimal turns thinking off where the model allows, Low ≈ 1k, Medium ≈ 8k, High ≈ 24k tokens.' : slowNote} If the model
        doesn’t support a level, it falls back to its default.
      </p>
    </div>
  );
}

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
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [geminiTest, setGeminiTest] = useState<TestState>({ state: 'idle' });
  const [fmpTest, setFmpTest] = useState<TestState>({ state: 'idle' });
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [customSize, setCustomSize] = useState(String(s.pageSize));

  useEffect(() => {
    if (!s.geminiKey) return;
    const t = setTimeout(() => {
      api
        .models(s.geminiKey)
        .then((m) => m.length && setModels(m))
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

  const allModels = models.map((m) => m.id);
  const batchModels = models.filter((m) => m.batch).map((m) => m.id);

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
          <label for="gemini-model">Model</label>
          <ModelSelect id="gemini-model" value={s.geminiModel} models={allModels} onChange={(geminiModel) => updateSettings({ geminiModel })} />
        </div>
        <ThinkingField
          id="thinking-label"
          label="Thinking level"
          model={s.geminiModel}
          value={s.geminiThinking}
          onChange={(geminiThinking) => updateSettings({ geminiThinking })}
          slowNote="More thinking gives deeper analysis but runs slower and costs more."
        />
        <div class="field-row">
          <button class="btn" onClick={testGemini} disabled={!s.geminiKey || geminiTest.state === 'testing'}>
            <I.Bolt size={15} /> Test connection
          </button>
          <TestResult test={geminiTest} />
        </div>
        <div class="divider" />
        <div class="field-title">Batch analysis</div>
        <p class="field-hint settings-sub">
          Used by “Batch analyse page”, which sends one Gemini Batch API job at about half the price. Single-stock runs and diagrams keep using the model above.
        </p>
        <div class="field">
          <label for="batch-model">Batch model</label>
          <ModelSelect id="batch-model" value={s.batchModel} models={batchModels} onChange={(batchModel) => updateSettings({ batchModel })} />
          <p class="field-hint">Only models that accept batch jobs are listed.</p>
        </div>
        <ThinkingField
          id="batch-thinking-label"
          label="Batch thinking level"
          model={s.batchModel}
          value={s.batchThinking}
          onChange={(batchThinking) => updateSettings({ batchThinking })}
          slowNote="More thinking gives deeper analysis and costs more; batches aren’t waited on, so speed matters less."
        />
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
              {sync ? `${sync.total.toLocaleString('en-US')} companies · ${sync.etfs.toLocaleString('en-US')} ETFs · synced ` : ''}
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
            <p class="panel__sub">Stocks per page — also the size of a “Batch analyse page” job.</p>
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
