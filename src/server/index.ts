import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTION, DB_NAME, MONGO_URI, connectDb } from './db.ts';
import { api } from './routes.ts';

const PORT = Number(process.env.PORT ?? 3000);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

await connectDb();
console.log(`[db] connected to ${MONGO_URI}/${DB_NAME} (${COLLECTION})`);

const app = express();
app.disable('x-powered-by');
app.use('/api', api);
app.use(express.static(publicDir, { maxAge: '1h', index: false }));
app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: publicDir }));

app.listen(PORT, () => console.log(`[web] Meridian running at http://localhost:${PORT}`));
