import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.ts';
import { toast } from '../toast.ts';
import * as I from '../components/icons.tsx';
import { Spinner } from '../components/ui.tsx';
import type { PromptConfig, PromptItem } from '../types.ts';

const newId = () => `p_${Math.random().toString(36).slice(2, 10)}`;

function PromptList(props: {
  items: PromptItem[];
  onChange: (items: PromptItem[]) => void;
  titlePlaceholder: string;
  descriptionPlaceholder: string;
  addLabel: string;
  max: number;
}) {
  const update = (i: number, patch: Partial<PromptItem>) => props.onChange(props.items.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...props.items];
    const [it] = next.splice(i, 1);
    next.splice(i + d, 0, it!);
    props.onChange(next);
  };
  return (
    <div class="prompt-list">
      {props.items.map((p, i) => (
        <div class="prompt-item" key={p.id}>
          <span class="prompt-item__n num">{String(i + 1).padStart(2, '0')}</span>
          <div class="prompt-item__fields">
            <input class="input input--title" value={p.title} maxLength={60} placeholder={props.titlePlaceholder} onInput={(e) => update(i, { title: e.currentTarget.value })} />
            <textarea class="input" rows={2} value={p.description} maxLength={2000} placeholder={props.descriptionPlaceholder} onInput={(e) => update(i, { description: e.currentTarget.value })} />
          </div>
          <div class="prompt-item__actions">
            <button class="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              <I.ArrowUp size={14} />
            </button>
            <button class="icon-btn" disabled={i === props.items.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              <I.ArrowDown size={14} />
            </button>
            <button class="icon-btn icon-btn--danger" onClick={() => props.onChange(props.items.filter((_, j) => j !== i))} aria-label="Delete">
              <I.Trash size={14} />
            </button>
          </div>
        </div>
      ))}
      {props.items.length < props.max && (
        <button class="add-row" onClick={() => props.onChange([...props.items, { id: newId(), title: '', description: '' }])}>
          <I.Plus size={15} /> {props.addLabel}
        </button>
      )}
    </div>
  );
}

export function Prompts() {
  const [saved, setSaved] = useState<PromptConfig | null>(null);
  const [draft, setDraft] = useState<PromptConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .prompts()
      .then((p) => {
        setSaved(p);
        setDraft(p);
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error'));
  }, []);

  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async () => {
    if (!draft) return;
    const incomplete = [...draft.scorePrompts, ...draft.svgPrompts].some((p) => !p.title.trim() || !p.description.trim());
    if (incomplete) {
      toast('Every prompt needs both a title and a description', 'error');
      return;
    }
    setSaving(true);
    try {
      const p = await api.savePrompts(draft);
      setSaved(p);
      setDraft(p);
      toast('Prompts saved', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <div class="page narrow">
        <span class="skeleton" style={{ width: '280px', height: '48px' }} />
      </div>
    );
  }

  return (
    <div class="page narrow">
      <header class="page-head">
        <p class="eyebrow">Prompt studio</p>
        <h1 class="display display--page">
          Teach the analyst <em>what to look for.</em>
        </h1>
        <p class="lede">Scores, tags and the introduction are requested together in one analysis call per stock. Diagrams are a separate call, started from the stock page.</p>
      </header>

      <section class="card panel">
        <header class="panel__head">
          <div>
            <h2 class="panel__title">
              <I.Sparkle size={16} /> Score prompts
            </h2>
            <p class="panel__sub">Each becomes a sortable 0–10 column in the market list. Reasons are shown on the stock page.</p>
          </div>
          <span class="count-badge num">{draft.scorePrompts.length}</span>
        </header>
        <PromptList
          items={draft.scorePrompts}
          onChange={(scorePrompts) => setDraft({ ...draft, scorePrompts })}
          titlePlaceholder="Column title, e.g. Pop Icon"
          descriptionPlaceholder="What should be scored? e.g. the potential of this company, or its leader, or its product to become a popular culture symbol"
          addLabel="Add score prompt"
          max={20}
        />
      </section>

      <section class="card panel">
        <header class="panel__head">
          <div>
            <h2 class="panel__title">
              <I.Grid size={16} /> SVG diagram prompts
            </h2>
            <p class="panel__sub">Generated on demand from a stock page. Gemini draws each diagram twice — landscape for desktop, portrait for phones.</p>
          </div>
          <span class="count-badge num">{draft.svgPrompts.length}</span>
        </header>
        <PromptList
          items={draft.svgPrompts}
          onChange={(svgPrompts) => setDraft({ ...draft, svgPrompts })}
          titlePlaceholder="Diagram title, e.g. Business Map"
          descriptionPlaceholder="Describe what the diagram should visualise"
          addLabel="Add diagram prompt"
          max={6}
        />
      </section>

      <section class="card panel">
        <header class="panel__head">
          <div>
            <h2 class="panel__title">
              <I.Quill size={16} /> Company introduction prompt
            </h2>
            <p class="panel__sub">Rendered as an article on the stock page.</p>
          </div>
        </header>
        <textarea class="input" rows={5} value={draft.introPrompt} maxLength={4000} onInput={(e) => setDraft({ ...draft, introPrompt: e.currentTarget.value })} />
      </section>

      <div class={`savebar${dirty ? ' is-visible' : ''}`}>
        <span>You have unsaved changes</span>
        <button class="btn btn--ghost" onClick={() => setDraft(saved)} disabled={saving}>
          Discard
        </button>
        <button class="btn btn--primary" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <I.Check size={16} />} Save prompts
        </button>
      </div>
    </div>
  );
}
