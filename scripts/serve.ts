import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Minimal static server for `dist/`, mirroring the headers in vercel.json. The local SQLite engine uses
 * SharedArrayBuffer, which browsers only enable on cross-origin isolated pages (COOP + COEP).
 */
export const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export function serve(root = 'dist', port = Number(process.env.PORT ?? 3000)) {
  const dir = path.resolve(root);

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = path.join(dir, decodeURIComponent(url.pathname));
    if (file !== dir && !file.startsWith(dir + path.sep)) return void res.writeHead(403).end();
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, {
        ...ISOLATION_HEADERS,
        'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { ...ISOLATION_HEADERS, 'Content-Type': 'text/plain' }).end('Not found');
    }
  }

  // HTTPS is used automatically when mkcert files exist (needed to open the app from another device); HTTPS=0 forces HTTP.
  const cert = path.resolve(process.env.HTTPS_CERT ?? 'localhost+2.pem');
  const key = path.resolve(process.env.HTTPS_KEY ?? 'localhost+2-key.pem');
  const tls = process.env.HTTPS !== '0' && existsSync(cert) && existsSync(key);
  if (process.env.HTTPS === '1' && !tls) throw new Error(`HTTPS=1 but certificate files are missing: ${cert}, ${key}`);
  const server = tls
    ? https.createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => void handle(req, res))
    : http.createServer((req, res) => void handle(req, res));
  server.listen(port, () => console.log(`[web] Meridian running at ${tls ? 'https' : 'http'}://localhost:${port}`));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) serve(process.argv[2]);
