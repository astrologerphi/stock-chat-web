import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { serve } from './serve.ts';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

/*
 * @tursodatabase/database-wasm loads its engine with `new URL('./turso.wasm32-wasi.wasm', import.meta.url)` and
 * starts `new Worker(new URL('./worker.js', import.meta.url))`. esbuild leaves those URLs alone, so we emit both
 * files next to the bundle (chunks go to the dist root, keeping `import.meta.url` relative paths valid) and
 * rewrite the names: the wasm gets a content hash so it can be cached forever.
 */
const tursoDist = path.dirname(createRequire(import.meta.url).resolve('@tursodatabase/database-wasm'));
const wasm = await readFile(path.join(tursoDist, 'turso.wasm32-wasi.wasm'));
const wasmName = `turso-${createHash('sha256').update(wasm).digest('hex').slice(0, 10)}.wasm`;
const workerName = 'turso-worker.js';

const tursoAssets: esbuild.Plugin = {
  name: 'turso-assets',
  setup(build) {
    build.onLoad({ filter: /database-wasm[\\/]dist[\\/]index-default\.js$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const contents = source.replace("'./turso.wasm32-wasi.wasm'", `'./${wasmName}'`).replace("'./worker.js'", `'./${workerName}'`);
      if (!contents.includes(wasmName) || !contents.includes(workerName)) {
        throw new Error('Could not rewrite @tursodatabase/database-wasm asset URLs — the package layout changed.');
      }
      return { contents, loader: 'js' };
    });
  },
};

const copyStatic: esbuild.Plugin = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(async () => {
      await copyFile('src/index.html', `${outdir}/index.html`);
      await copyFile('src/favicon.svg', `${outdir}/favicon.svg`);
    });
  },
};

const common: esbuild.BuildOptions = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: !watch,
  sourcemap: true,
  logLevel: 'info',
};

const app: esbuild.BuildOptions = {
  ...common,
  entryPoints: { app: 'src/main.tsx' },
  outdir,
  splitting: true,
  chunkNames: '[name]-[hash]',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.woff2': 'file' },
  plugins: [tursoAssets, copyStatic],
};

const worker: esbuild.BuildOptions = {
  ...common,
  entryPoints: [path.join(tursoDist, 'worker.js')],
  outfile: `${outdir}/${workerName}`,
};

await writeFile(`${outdir}/${wasmName}`, wasm);

if (watch) {
  const contexts = await Promise.all([esbuild.context(app), esbuild.context(worker)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  serve(outdir);
} else {
  await Promise.all([esbuild.build(app), esbuild.build(worker)]);
}
