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
  // app.js is the Carcassonne client; rummy.js is the standalone rummy solver page (/rummy).
  entryPoints: {
    app: path.join(root, 'src/client/main.ts'),
    rummy: path.join(root, 'src/rummy/main.ts'),
  },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir,
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
  loader: { '.svg': 'text' }, // tile art is imported as raw SVG source, wrapped into a data: URI at runtime
});

if (watch) {
  await ctx.watch();
  console.log('esbuild watching src/client -> dist/client/app.js, src/rummy -> dist/client/rummy.js');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
