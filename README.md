# Meridian

A web app for exploring and analysing the US stock market. Market data comes from [FMP](https://financialmodelingprep.com); qualitative analysis (scores, tags, introductions, SVG diagrams) comes from Gemini.

Meridian is a **single static page** with no backend. Data is stored in a SQLite database inside the browser via [`@tursodatabase/sync-wasm`](https://www.npmjs.com/package/@tursodatabase/sync-wasm), optionally synced with a [Turso Cloud](https://turso.tech) database, and FMP, Gemini and Turso are called straight from the page. It deploys to Vercel as plain static files.

## Features

- **Stocks** (`#/`): every NASDAQ / NYSE / AMEX company with logo, market cap, exchange filter, *heat* (news count over the last 30 days shown as a thermometer: low under 30, medium 30–99, hot 100–499, explosive 500+; loaded asynchronously per page; **Refresh heat** reloads it for every company in the background with progress and a Stop button, skipping companies refreshed in the last hour so an interrupted run resumes cheaply), float / outstanding ratio, country as flag + ISO code, country filter (sorted by company count), LLM score columns, tags filter and last LLM run. All numeric columns are sortable, and empty values always sort last.
- **ETFs** (`#/etfs`): every actively traded US-listed ETF with icon, symbol, name, market cap, exchange (filterable) and heat, plus search, sorting and its own **Refresh heat** run. ETFs have no detail page, analysis, tags or float. Databases synced before ETFs existed fetch them automatically the first time the ETF page is opened.
- **Stock detail**: quote and facts, score dials with reasons, editable tags (pick from the tag library or type a new name to create one; manual edits survive later LLM runs), landscape and portrait SVG diagrams (picked by screen orientation and width; click for full screen; generated on demand with the panel's *Generate diagrams* button), AI introduction, and leadership from FMP.
- **Prompts**: manage score prompts (title + description), SVG diagram prompts and the introduction prompt.
- **Tags**: the tag library gathers every tag used by any company, with company counts. Add tags, filter and sort them, or open the list filtered by a tag. Deleting a tag removes it from every company and blocks it, so later analysis runs don't add it back. Deleted tags can be restored.
- **Settings**: Gemini key with connection test, model picker, thinking level (Gemini 3+ `thinkingLevel`, or a mapped `thinkingBudget` on 2.5; unsupported levels fall back to the model default), a separate batch model (only models that support `batchGenerateContent` are listed) and batch thinking level, FMP key with test, Turso Cloud sync (database URL and token, connection test, *Sync now*), page size and universe sync (companies and ETFs).
- **Themes**: a switch in the top bar toggles between dark and a light theme modelled on VS Code's *Solarized Light*. The choice is saved in localStorage (`meridian.theme`). Until you pick one, the app follows the system `prefers-color-scheme`. Typography is sans-serif throughout (Inter Tight, JetBrains Mono for figures).
- **LLM tasks**: two kinds, both using the FMP profile and the news from the last 30 days as context and returning structured JSON.
  - *Analysis*: one Gemini call returns every score with its reason, tags and the introduction. Run it for one stock from its list row or detail page, or for the whole page with **Batch analyse page**.
  - *Batch analysis*: **Batch analyse page** first loads each stock's context from FMP and shows a review sheet with the shared system instruction, the response schema and every stock's full prompt; stocks can be left out. Nothing reaches Gemini until you click *Submit batch*. The requests are then sent as a single [Gemini Batch API](https://ai.google.dev/gemini-api/docs/batch-api) job (about half the price; usually minutes, at most 24 hours) using the batch model and thinking level from Settings. The job id is saved in the database, so the page may be closed: unfinished jobs are checked when the app opens, every 30 seconds while it is visible, and on *Check now*, and finished results are applied like a normal analysis. Stocks in a running batch show *In batch* and are left out of new batches.
  - *Diagrams*: a separate Gemini call returns all SVG diagrams. It runs only from the detail page, because diagrams are slow and token-heavy.

## Requirements

- Node.js 24+ (build only)
- A modern browser with OPFS and `SharedArrayBuffer` support. The page must be **cross-origin isolated** (see [Headers](#headers)).

## Scripts

```sh
npm install
npm run dev        # esbuild watch + static server at http://localhost:3000 (override with PORT)
npm run build      # esbuild → dist/
npm run preview    # serve an existing dist/
npm run typecheck  # TypeScript 7
```

### HTTPS

The dev / preview server switches to HTTPS on the same port when `localhost+2.pem` and `localhost+2-key.pem` (from `mkcert localhost 127.0.0.1 ::1`) exist in the project root. Cross-origin isolation needs a secure context, so use this to open the app from another device on the LAN.

- `HTTPS_CERT` / `HTTPS_KEY`: use certificate files from other paths.
- `HTTPS=1`: fail on startup if the files are missing.
- `HTTPS=0`: force plain HTTP.

`*.pem` files are gitignored.

## Deploying to Vercel

Import the repository in Vercel; `vercel.json` already sets the build command (`npm run build`), the output directory (`dist`) and the required headers. No environment variables are needed, because every user supplies their own keys in Settings.

### Headers

The SQLite engine uses a shared `WebAssembly.Memory`, which browsers only allow on cross-origin isolated pages. Every response must carry:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`vercel.json` and `scripts/serve.ts` both set them. As a consequence, every cross-origin subresource must be CORS-enabled: company logos are loaded with `crossorigin="anonymous"` (FMP serves them with `Access-Control-Allow-Origin: *`), as are Google Fonts.

## Data & keys

- **API keys** stay **only in the browser's localStorage** (`meridian.settings`) and are sent directly to FMP, Gemini and Turso. Enter them on the Settings page. The first visit with an FMP key syncs the company universe automatically.
- **Stock data, scores, tags, prompts** live in `meridian-sync.db`, a SQLite file in the [Origin Private File System](https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system). Each browser profile has its own database, and clearing the site's data deletes it (and its link to Turso). A `meridian.db` left by earlier versions is copied in once on first start and then deleted.
- OPFS file handles are exclusive, so the app can be open in **one tab at a time**; a second tab shows a message instead of corrupting the file.
- Single-stock LLM tasks run in the page (three at a time). Analysis and diagram tasks for the same stock can run side by side because they write different columns. Queued tasks are lost if the page is closed or reloaded before they finish. Batch jobs run on Gemini's side and survive reloads (see above); Gemini keeps them for 48 hours.

### Schema

| Table | Purpose |
| --- | --- |
| `stocks` | One row per company: screener fields, float, heat, profile / leaders / diagrams (JSON text), LLM introduction and run metadata, `active` flag for delisted symbols, `is_etf` flag (ETFs share the table and are filtered out of every company query) |
| `stock_tags` | `(symbol, tag, position)`: effective tags = LLM tags merged with manual edits (`stocks.tag_edits`) |
| `tags` | Tag library: `(key, name, blocked, created_at)`; `key` is the lower-cased name. LLM tags are mapped onto it (new ones are added, blocked ones dropped). Filled from `stock_tags` on first open |
| `stock_scores` | `(symbol, prompt_id, score, reason)` |
| `config` | JSON values: `prompts`, `meta` (last sync time) |
| `llm_batches` | Gemini batch jobs: operation id, model, thinking, symbols, state, stats, error, timestamps, `applied` (results written to the stocks) |

### Turso Cloud sync

The local database keeps working offline; Turso Cloud is an optional copy that lets other browsers pick up the same data.

1. Create a database and a **database token**: `turso db create meridian`, `turso db show meridian --url` and `turso db tokens create meridian` (or the database's *Create token* button in the dashboard, read & write). A Platform API token (`turso auth api-tokens …`) does not work: Turso rejects it on the database host, and Settings warns when one is pasted.
2. Enter the URL (`libsql://…`) and token under **Settings → Turso Cloud sync**, use *Test connection*, then *Sync now*.

How it behaves:

- A full sync (push local changes, then pull remote ones) runs when the app opens and on *Sync now* (Settings or the cloud button in the top bar). Local writes are pushed on their own about 8 seconds after they settle (at most a minute later). Remote changes are pulled only on open or on demand; a pull that changes data reloads the current screen.
- A browser with no local database yet downloads the remote one on first open. A browser that already has data merges it: local changes are pushed, then remote ones pulled. The schema is replicated too, so an empty Turso database needs no setup.
- Rows are merged by primary key and the last write wins; concurrent edits to the same row are not combined.
- After the first sync the browser stays **linked** to that database (localStorage key `meridian.cloud.linkedUrl`). Pointing Settings at a different URL pauses sync with a message; clear the site's data to link another database. Removing the URL just pauses sync.
- The engine keeps its sync state next to the database (`meridian-sync.db-*` files in OPFS and `meridian-sync.db-info` in localStorage).

## Architecture

```
src/
  main.tsx, pages/, components/   Preact SPA (hash router), design system in styles.css
  api.ts                          façade used by the UI; validates input and calls the data layer
  data/db.ts                      Turso wasm connection, schema, legacy import, transactions, config, write hook
  data/remote.ts                  Turso URL / token settings, database link, Platform-token detection
  data/cloud.ts                   Turso Cloud push / pull, sync stats, connection test, error messages
  data/stocks.ts                  list / facets / detail / tags queries, heat + profile refresh
  data/heat.ts                    background "Refresh heat" job for every company or every ETF
  data/tags.ts                    tag library: list, add, delete (block), resolve tags on write
  data/sync.ts                    universe sync from the FMP screener (companies and ETFs) + float data
  data/llm.ts                     Gemini prompt + schema, SVG sanitising, in-page task queue
  data/batch.ts                   batch analysis: build prompts for review, submit, poll and apply results
  batches.ts, tasks.ts            UI stores for batch jobs and in-page LLM tasks (polling, toasts)
  cloud.ts                        UI store for Cloud sync: sync on open, debounced push after writes, top-bar state
  data/fmp.ts, data/gemini.ts     API clients
  types.ts                        shared types
scripts/
  build.ts                        esbuild build / watch (also emits the Turso worker and wasm)
  serve.ts                        static server with COOP / COEP headers
vercel.json                       Vercel build settings and headers
```

`@tursodatabase/sync-wasm` loads its ~12 MB engine with `new URL(…, import.meta.url)`, which esbuild does not bundle. `scripts/build.ts` therefore emits the worker (`turso-worker.js`) and a content-hashed `turso-<hash>.wasm` next to the bundle and rewrites the package's URLs to match. The engine chunk is imported lazily, so the UI renders while it downloads.

## Product spec

This is the original brief the app was built from, kept for future reference and updated for the current architecture.

### Stock list

Each row contains:

| Column | Notes | LLM |
| --- | --- | --- |
| Icon, symbol, name | | no |
| Market cap | sortable | no |
| Exchange | filterable | no |
| Heat | sortable; number of news in the last month, as a thermometer (low < 30 ≤ medium < 100 ≤ hot < 500 ≤ explosive) | no |
| Float / total shares | sortable by percentage | no |
| Country | filter whose options are sorted by company count | no |
| Score columns | one per score prompt; integer 0–10 | yes |
| Tags | string array, filterable | yes |
| Last LLM run | sortable; time of the last LLM task | no |

Score prompts are managed by the user, for example *"the potential of this company, its leader or its product to become a pop-culture symbol"*. Each prompt returns:

```json
{ "score": 8, "reason": "more and more people are using their products" }
```

All score prompts are requested together in one call to save tokens. The list shows only the score; reasons appear on the detail page.

Loaded asynchronously: the heat of each company on the current page, and the number of companies per country.

### ETF list

A separate tab lists ETFs (FMP screener with `isEtf=true`). Each row shows only the icon, symbol, name, market cap (sortable), exchange (filterable) and heat (sortable, loaded asynchronously).

### Stock details

- Company leaders, from FMP when available.
- Everything shown in the list row.
- Score reasons (LLM).
- Tags (LLM); the user can delete tags or add new ones, picking from the tag library.

### Tag management

- A page lists every tag used by any company, so the user can add or delete tags.
- Deleting a tag also deletes it from every company, and LLM runs no longer add it.
- When adding tags on the stock detail page, the user selects from the managed tags (or creates a new one, which joins the library).
- SVG diagrams (LLM): Gemini returns SVG markup directly. Each diagram has a horizontal and a vertical version, displayed according to the screen.
- Company introduction (LLM).

### Prompt management

- Score prompts, each with a title and a description.
- SVG diagram prompts.
- Company introduction prompt.

### Settings

- Gemini API key and connection test.
- Gemini model select.
- Batch model and thinking level select.
- FMP API key.
- Turso Cloud sync: database URL and token, connection test, sync now.
- Number of stocks displayed per page.

### LLM task and context

An analysis task produces, for a single stock: scores with reasons, tags and the company introduction, then updates *Last LLM run*. The user can batch-run analysis for every stock on a page, or run it for a single stock from the list or the detail page. A page batch shows every prompt and its context for confirmation first, is sent as one Gemini Batch API job, and its id is stored so the results are fetched automatically the next time the app opens.

A diagram task produces only the SVG diagrams. It is started from the stock detail page and replaces that stock's diagrams. It does not change the scores, tags, introduction or *Last LLM run*.

Both use the news, company description and other data fetched from FMP as context.

### Tech stack

- FMP API as the data source.
- Gemini API as the analysis tool.
- TypeScript 7, esbuild, Preact.
- Browser SQLite via `@tursodatabase/sync-wasm` for storage, optionally synced with Turso Cloud.
- localStorage for secrets.
- No backend: a single static page hosted on Vercel.
- Aesthetics: distinctive, sans-serif only; dark by default with a Solarized Light alternative.

## Credits

Flag emoji on platforms without native flags (Windows) come from [country-flag-emoji-polyfill](https://github.com/talkjs/country-flag-emoji-polyfill) (MIT), which bundles a flags-only subset of [Twemoji](https://github.com/twitter/twemoji) graphics licensed CC-BY 4.0. The font is self-hosted from the build and only loads where needed.
