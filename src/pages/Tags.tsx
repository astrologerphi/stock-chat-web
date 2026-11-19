import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../api.ts";
import { useOnTasksFinished } from "../tasks.ts";
import { toast } from "../toast.ts";
import * as I from "../components/icons.tsx";
import { Spinner } from "../components/ui.tsx";
import type { TagInfo } from "../types.ts";

const companies = (n: number) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? "company" : "companies"}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Tags() {
  const [library, setLibrary] = useState<TagInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"count" | "name">("count");
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .tagLibrary()
      .then(setLibrary)
      .catch((e: unknown) => {
        toast(errorText(e), "error");
        setLibrary((l) => l ?? []);
      });
  }, []);

  useEffect(load, [load]);
  useOnTasksFinished(load);

  const live = useMemo(
    () => (library ?? []).filter((t) => !t.blocked),
    [library],
  );
  const blocked = useMemo(
    () =>
      (library ?? [])
        .filter((t) => t.blocked)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [library],
  );
  const max = Math.max(1, ...live.map((t) => t.count));
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = q
      ? live.filter((t) => t.name.toLowerCase().includes(q))
      : live;
    return sort === "name"
      ? [...list].sort((a, b) => a.name.localeCompare(b.name))
      : list;
  }, [live, q, sort]);

  const add = async (name: string) => {
    if (!name.trim()) return;
    setAdding(true);
    try {
      const r = await api.addTag(name);
      setDraft("");
      setFresh(r.name);
      toast(
        r.created
          ? `Added “${r.name}”`
          : r.restored
            ? `Restored “${r.name}”`
            : `“${r.name}” is already in the library`,
        r.created || r.restored ? "success" : "info",
      );
      load();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (tag: TagInfo) => {
    setPending(tag.name);
    try {
      const n = await api.deleteTag(tag.name);
      toast(
        `Deleted “${tag.name}”${n ? ` from ${companies(n)}` : ""}`,
        "success",
      );
      setConfirming(null);
      load();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setPending(null);
    }
  };

  return (
    <div class="page narrow tags-page">
      <header class="page-head">
        <h1 class="display display--page">
          Tags, <em>curated once.</em>
        </h1>
        <p class="lede">
          Every tag used by any company, plus the ones you add. Deleting a tag
          removes it from every company, and analysis runs won’t add it back.
        </p>
      </header>

      <section class="card panel">
        <header class="panel__head panel__head--wrap">
          <div>
            <h2 class="panel__title">
              <I.Tag size={16} /> Library
            </h2>
            <p class="panel__sub">
              {library
                ? `${live.length.toLocaleString("en-US")} ${live.length === 1 ? "tag" : "tags"}`
                : "Loading…"}
              {blocked.length ? ` · ${blocked.length} deleted` : ""}
            </p>
          </div>
          <form
            class="tag-add"
            onSubmit={(e) => {
              e.preventDefault();
              void add(draft);
            }}
          >
            <label class="sr-only" for="new-tag">
              New tag
            </label>
            <input
              id="new-tag"
              class="input"
              value={draft}
              maxLength={32}
              placeholder="New tag name"
              onInput={(e) => setDraft(e.currentTarget.value)}
            />
            <button class="btn btn--primary" disabled={adding || !draft.trim()}>
              {adding ? <Spinner /> : <I.Plus size={15} />} Add tag
            </button>
          </form>
        </header>

        {live.length > 0 && (
          <div class="tag-tools">
            <label class="search">
              <I.Search size={15} />
              <input
                value={query}
                placeholder="Filter tags"
                aria-label="Filter tags"
                onInput={(e) => setQuery(e.currentTarget.value)}
              />
              {query && (
                <button
                  type="button"
                  class="search__x"
                  aria-label="Clear filter"
                  onClick={() => setQuery("")}
                >
                  <I.X size={14} />
                </button>
              )}
            </label>
            <div class="seg" role="group" aria-label="Sort tags">
              <button
                type="button"
                class={sort === "count" ? "is-on" : ""}
                aria-pressed={sort === "count"}
                onClick={() => setSort("count")}
              >
                Most used
              </button>
              <button
                type="button"
                class={sort === "name" ? "is-on" : ""}
                aria-pressed={sort === "name"}
                onClick={() => setSort("name")}
              >
                A–Z
              </button>
            </div>
          </div>
        )}

        {!library ? (
          <div class="tag-lib">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                class="skeleton"
                style={{ height: "44px", borderRadius: "12px" }}
              />
            ))}
          </div>
        ) : !live.length ? (
          <div class="tag-empty">
            <I.Tag size={22} />
            <p class="tag-empty__title">No tags yet</p>
            <p class="muted small">
              Tags appear here as analyses run. You can also add your own above.
            </p>
          </div>
        ) : !shown.length ? (
          <div class="tag-empty">
            <p class="tag-empty__title">No tags match “{query.trim()}”</p>
            <button type="button" class="btn" onClick={() => void add(query)}>
              <I.Plus size={15} /> Add “{query.trim()}”
            </button>
          </div>
        ) : (
          <ul class="tag-lib">
            {shown.map((t) => {
              const isConfirming = confirming === t.name;
              const busy = pending === t.name;
              return (
                <li
                  key={t.name}
                  class={`tag-row${isConfirming ? " is-confirming" : ""}${fresh === t.name ? " is-fresh" : ""}`}
                >
                  {isConfirming ? (
                    <>
                      <p class="tag-row__confirm">
                        Delete <strong>{t.name}</strong>
                        {t.count ? ` from ${companies(t.count)}` : ""}? Analysis
                        runs won’t add it back.
                      </p>
                      <div class="tag-row__actions">
                        <button
                          type="button"
                          class="btn btn--ghost"
                          disabled={busy}
                          autoFocus
                          onClick={() => setConfirming(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          class="btn btn--danger"
                          disabled={busy}
                          onClick={() => void remove(t)}
                        >
                          {busy ? <Spinner /> : <I.Trash size={15} />} Delete
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <a
                        class="tag-row__name"
                        href={`#/?tags=${encodeURIComponent(t.name)}`}
                        title={`Show companies tagged ${t.name}`}
                      >
                        {t.name}
                      </a>
                      <span class="tag-row__usage">
                        <span class="tag-row__bar" aria-hidden="true">
                          {t.count > 0 && (
                            <i style={{ width: `${(t.count / max) * 100}%` }} />
                          )}
                        </span>
                        <span class="num">
                          {t.count ? companies(t.count) : "Unused"}
                        </span>
                      </span>
                      <div class="tag-row__actions">
                        <button
                          type="button"
                          class="icon-btn icon-btn--danger"
                          aria-label={`Delete ${t.name}`}
                          title="Delete tag"
                          onClick={() => setConfirming(t.name)}
                        >
                          <I.Trash size={15} />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {blocked.length > 0 && (
        <section class="card panel">
          <header class="panel__head">
            <div>
              <h2 class="panel__title">
                <I.EyeOff size={16} /> Deleted tags
              </h2>
              <p class="panel__sub">
                Analysis runs skip these. Restore one to allow it again; it
                won’t return to companies until they are re-tagged.
              </p>
            </div>
            <span class="count-badge num">{blocked.length}</span>
          </header>
          <ul class="tag-blocked">
            {blocked.map((t) => (
              <li key={t.name}>
                <span>{t.name}</span>
                <button
                  type="button"
                  class="link-btn"
                  disabled={adding}
                  onClick={() => void add(t.name)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
