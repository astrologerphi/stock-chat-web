# Meridian

A dark, editorial web app for exploring and analysing the US stock market. Market data comes from [FMP](https://financialmodelingprep.com); qualitative analysis (scores, tags, introductions, SVG diagrams) comes from Gemini.

## Features

- **Stock list**: every NASDAQ / NYSE / AMEX company with logo, market cap, exchange filter, *heat* (news count over the last 30 days, loaded asynchronously per page), float / outstanding ratio, country filter (sorted by company count), LLM score columns, tags filter and last LLM run. All numeric columns are sortable; empty values always sort last.
- **Stock detail**: quote and facts, score dials with reasons, editable tags (manual edits survive later LLM runs), landscape and portrait SVG diagrams (picked by screen orientation and width; click for full screen), AI introduction and leadership from FMP.
- **Prompts**: manage score prompts (title + description), SVG diagram prompts and the introduction prompt.
- **Settings**: Gemini key with connection test, model picker, FMP key with test, page size and universe sync.
- **LLM tasks**: one Gemini call per stock returns every score, tags, the introduction and all diagrams as structured JSON. The context is the FMP profile and the news from the last 30 days. Run it for a single stock or for the whole page.

## Requirements

- Node.js 24+
- MongoDB at `mongodb://localhost:27017`. Data is stored in database `Local1114`, collection `Coll01`.

## Scripts

```sh
npm install
npm run build      # esbuild → dist/
npm start          # http(s)://localhost:3000 (override with PORT)
npm run dev        # rebuild + restart on change
npm run typecheck  # TypeScript 7
```

## HTTPS

If `localhost+2.pem` and `localhost+2-key.pem` (from `mkcert localhost 127.0.0.1 ::1`) exist in the project root, `npm start` and `npm run dev` serve over HTTPS on the same port (`https://localhost:3000`).

- `HTTPS_CERT` / `HTTPS_KEY`: use certificate files from other paths.
- `HTTPS=1`: fail on startup if the files are missing.
- `HTTPS=0`: force plain HTTP.

`*.pem` files are gitignored.

## Keys

API keys are kept **only in the browser's localStorage** (`meridian.settings`). They are sent to the local server in request headers and are never written to the database or the disk. Enter them on the Settings page. The first visit with an FMP key syncs the company universe automatically.

## Architecture

```
src/shared/   API types shared by client and server
src/server/   Express 5 API, Mongoose models (discriminators on Coll01), FMP + Gemini clients, LLM task queue
src/client/   Preact SPA (hash router), design system in styles.css
scripts/      esbuild build / watch script
```
