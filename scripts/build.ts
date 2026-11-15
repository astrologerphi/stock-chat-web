import * as esbuild from 'esbuild';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFile, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(`${outdir}/public`, { recursive: true });

const copyHtml: esbuild.Plugin = {
  name: 'copy-html',
  setup(build) {
    build.onEnd(async () => {
      await copyFile('src/client/index.html', `${outdir}/public/index.html`);
      await copyFile('src/client/favicon.svg', `${outdir}/public/favicon.svg`);
    });
  },
};

let server: ChildProcess | undefined;
const restartServer: esbuild.Plugin = {
  name: 'restart-server',
  setup(build) {
    build.onEnd((result) => {
      if (!watch || result.errors.length) return;
      server?.kill();
      server = spawn(process.execPath, ['--enable-source-maps', `${outdir}/server.js`], { stdio: 'inherit' });
    });
  },
};

const client: esbuild.BuildOptions = {
  entryPoints: { app: 'src/client/main.tsx' },
  outdir: `${outdir}/public`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: !watch,
  sourcemap: true,
  loader: { '.woff2': 'file' },
  logLevel: 'info',
  plugins: [copyHtml],
};

const serverBuild: esbuild.BuildOptions = {
  entryPoints: ['src/server/index.ts'],
  outfile: `${outdir}/server.js`,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
  plugins: [restartServer],
};

if (watch) {
  const contexts = await Promise.all([esbuild.context(client), esbuild.context(serverBuild)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  process.on('SIGINT', () => {
    server?.kill();
    process.exit(0);
  });
} else {
  await Promise.all([esbuild.build(client), esbuild.build(serverBuild)]);
}
