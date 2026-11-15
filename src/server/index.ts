import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTION, DB_NAME, MONGO_URI, connectDb } from './db.ts';
import { api } from './routes.ts';

const PORT = Number(process.env.PORT ?? 3000);
const CERT = path.resolve(process.env.HTTPS_CERT ?? 'localhost+2.pem');
const KEY = path.resolve(process.env.HTTPS_KEY ?? 'localhost+2-key.pem');
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

await connectDb();
console.log(`[db] connected to ${MONGO_URI}/${DB_NAME} (${COLLECTION})`);

const app = express();
app.disable('x-powered-by');
app.use('/api', api);
app.use(express.static(publicDir, { maxAge: '1h', index: false }));
app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: publicDir }));

// HTTPS is used automatically when the mkcert files exist; HTTPS=0 forces plain HTTP.
const tls = process.env.HTTPS !== '0' && existsSync(CERT) && existsSync(KEY);
if (process.env.HTTPS === '1' && !tls) throw new Error(`HTTPS=1 but certificate files are missing: ${CERT}, ${KEY}`);
const server = tls ? https.createServer({ cert: readFileSync(CERT), key: readFileSync(KEY) }, app) : http.createServer(app);
server.listen(PORT, () => console.log(`[web] Meridian running at ${tls ? 'https' : 'http'}://localhost:${PORT}`));
