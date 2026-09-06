import * as esbuild from 'esbuild';
import { mkdirSync, cpSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outdir = path.join(root, 'dist', 'client');
const watch = process.argv.includes('--watch');

mkdirSync(outdir, { recursive: true });

// Static files (html, favicon, css authored directly) ship as-is.
const staticDir = path.join(root, 'static');
for (const f of readdirSync(staticDir)) {
  cpSync(path.join(staticDir, f), path.join(outdir, f), { recursive: true });
}

const ctx = await esbuild.context({
  entryPoints: [path.join(root, 'src/client/main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: path.join(outdir, 'app.js'),
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  console.log('esbuild watching src/client -> dist/client/app.js');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
