# Meridian

A web app for exploring and analysing the US stock market. Market data comes from [FMP](https://financialmodelingprep.com); qualitative analysis (scores, tags, introductions, SVG diagrams) comes from Gemini.

Meridian is a **single static page** with no backend. Data is stored in a SQLite database inside the browser via [`@tursodatabase/database-wasm`](https://www.npmjs.com/package/@tursodatabase/database-wasm), and FMP and Gemini are called straight from the page. It deploys to Vercel as plain static files.

## Features

- **Stock list**: every NASDAQ / NYSE / AMEX company with logo, market cap, exchange filter, *heat* (news count over the last 30 days, loaded asynchronously per page; **Refresh heat** reloads it for every company in the background with progress and a Stop button, skipping companies refreshed in the last hour so an interrupted run resumes cheaply), float / outstanding ratio, country filter (sorted by company count), LLM score columns, tags filter and last LLM run. All numeric columns are sortable, and empty values always sort last.
- **Stock detail**: quote and facts, score dials with reasons, editable tags (pick from the tag library or type a new name to create one; manual edits survive later LLM runs), landscape and portrait SVG diagrams (picked by screen orientation and width; click for full screen; generated on demand with the panel's *Generate diagrams* button), AI introduction, and leadership from FMP.
- **Prompts**: manage score prompts (title + description), SVG diagram prompts and the introduction prompt.
- **Tags**: the tag library gathers every tag used by any company, with company counts. Add tags, filter and sort them, or open the list filtered by a tag. Deleting a tag removes it from every company and blocks it, so later analysis runs don't add it back. Deleted tags can be restored.
- **Settings**: Gemini key with connection test, model picker, thinking level (Gemini 3+ `thinkingLevel`, or a mapped `thinkingBudget` on 2.5; unsupported levels fall back to the model default), FMP key with test, page size and universe sync.
- **Themes**: a switch in the top bar toggles between dark and a light theme modelled on VS Code's *Solarized Light*. The choice is saved in localStorage (`meridian.theme`). Until you pick one, the app follows the system `prefers-color-scheme`. Typography is sans-serif throughout (Inter Tight, JetBrains Mono for figures).
- **LLM tasks**: two kinds, both using the FMP profile and the news from the last 30 days as context and returning structured JSON.
  - *Analysis*: one Gemini call returns every score with its reason, tags and the introduction. Run it from the list (one row or the whole page) or from the detail page.
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

- **API keys** stay **only in the browser's localStorage** (`meridian.settings`) and are sent directly to FMP and Gemini. Enter them on the Settings page. The first visit with an FMP key syncs the company universe automatically.
- **Stock data, scores, tags, prompts** live in `meridian.db`, a SQLite file in the [Origin Private File System](https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system). Each browser profile has its own database, and clearing the site's data deletes it.
- OPFS file handles are exclusive, so the app can be open in **one tab at a time**; a second tab shows a message instead of corrupting the file.
- LLM tasks run in the page (three at a time). Analysis and diagram tasks for the same stock can run side by side because they write different columns. Queued tasks are lost if the page is closed or reloaded before they finish.

### Schema

| Table | Purpose |
| --- | --- |
| `stocks` | One row per company: screener fields, float, heat, profile / leaders / diagrams (JSON text), LLM introduction and run metadata, `active` flag for delisted symbols |
| `stock_tags` | `(symbol, tag, position)`: effective tags = LLM tags merged with manual edits (`stocks.tag_edits`) |
| `tags` | Tag library: `(key, name, blocked, created_at)`; `key` is the lower-cased name. LLM tags are mapped onto it (new ones are added, blocked ones dropped). Filled from `stock_tags` on first open |
| `stock_scores` | `(symbol, prompt_id, score, reason)` |
| `config` | JSON values: `prompts`, `meta` (last sync time) |

### Roadmap: Turso Cloud sync

The local database is the source of truth for now. The plan is to sync it with [Turso Cloud](https://turso.tech) so data follows the user across devices. `@tursodatabase/sync-wasm` offers the same API with push / pull, so the data layer (`src/data/db.ts`) is the only place that should need to change.

## Architecture

```
src/
  main.tsx, pages/, components/   Preact SPA (hash router), design system in styles.css
  api.ts                          façade used by the UI; validates input and calls the data layer
  data/db.ts                      Turso wasm connection, schema, transactions, config
  data/stocks.ts                  list / facets / detail / tags queries, heat + profile refresh
  data/heat.ts                    background "Refresh heat" job for every company
  data/tags.ts                    tag library: list, add, delete (block), resolve tags on write
  data/sync.ts                    universe sync from the FMP screener + float data
  data/llm.ts                     Gemini prompt + schema, SVG sanitising, in-page task queue
  data/fmp.ts, data/gemini.ts     API clients
  types.ts                        shared types
scripts/
  build.ts                        esbuild build / watch (also emits the Turso worker and wasm)
  serve.ts                        static server with COOP / COEP headers
vercel.json                       Vercel build settings and headers
```

`@tursodatabase/database-wasm` loads its ~12 MB engine with `new URL(…, import.meta.url)`, which esbuild does not bundle. `scripts/build.ts` therefore emits the worker (`turso-worker.js`) and a content-hashed `turso-<hash>.wasm` next to the bundle and rewrites the package's URLs to match. The engine chunk is imported lazily, so the UI renders while it downloads.

## Product spec

This is the original brief the app was built from, kept for future reference and updated for the current architecture.

### Stock list

Each row contains:

| Column | Notes | LLM |
| --- | --- | --- |
| Icon, symbol, name | | no |
| Market cap | sortable | no |
| Exchange | filterable | no |
| Heat | sortable; number of news in the last month | no |
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
- FMP API key.
- Number of stocks displayed per page.

### LLM task and context

An analysis task produces, for a single stock: scores with reasons, tags and the company introduction, then updates *Last LLM run*. The user can batch-run analysis for every stock on a page, or run it for a single stock from the list or the detail page.

A diagram task produces only the SVG diagrams. It is started from the stock detail page and replaces that stock's diagrams. It does not change the scores, tags, introduction or *Last LLM run*.

Both use the news, company description and other data fetched from FMP as context.

### Tech stack

- FMP API as the data source.
- Gemini API as the analysis tool.
- TypeScript 7, esbuild, Preact.
- Browser SQLite via `@tursodatabase/database-wasm` for storage (later synced with Turso Cloud).
- localStorage for secrets.
- No backend: a single static page hosted on Vercel.
- Aesthetics: distinctive, sans-serif only; dark by default with a Solarized Light alternative.
