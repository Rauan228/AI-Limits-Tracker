// Builds the self-hosted server, the web panel (PWA) and the Chrome extension.
// Usage: node scripts/build.mjs [server|web|extension ...]   (no args = all)
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = process.argv.slice(2);
const want = (t) => targets.length === 0 || targets.includes(t);

const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  logLevel: 'info',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
};

async function buildWeb() {
  const out = join(root, 'web/dist');
  rmSync(out, { recursive: true, force: true });
  const result = await build({
    ...common,
    entryPoints: [join(root, 'web/src/main.tsx')],
    outdir: join(out, 'assets'),
    entryNames: 'app-[hash]',
    format: 'iife',
    target: ['es2020', 'safari15'],
    metafile: true,
  });
  const outputs = Object.keys(result.metafile.outputs).map((p) => p.split('/').pop());
  const js = outputs.find((f) => f.endsWith('.js'));
  const css = outputs.find((f) => f.endsWith('.css'));
  for (const f of readdirSync(join(root, 'web/public'))) {
    if (f === 'index.html') continue;
    cpSync(join(root, 'web/public', f), join(out, f), { recursive: true });
  }
  const html = readFileSync(join(root, 'web/public/index.html'), 'utf8').replace('%JS%', js).replace('%CSS%', css);
  writeFileSync(join(out, 'index.html'), html);
}

async function buildServer() {
  await build({
    ...common,
    minify: false,
    entryPoints: [join(root, 'server/src/index.ts')],
    outfile: join(root, 'server/dist/server.mjs'),
    platform: 'node',
    format: 'esm',
    target: 'node22',
    define: {},
  });
}

async function buildExtension() {
  const src = join(root, 'extension');
  const out = join(src, 'dist');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({
    ...common,
    entryPoints: {
      background: join(src, 'src/background.ts'),
      popup: join(src, 'src/popup.tsx'),
    },
    outdir: out,
    format: 'esm',
    target: 'chrome110',
  });
  cpSync(join(src, 'public'), out, { recursive: true });
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

if (want('server')) await buildServer();
if (want('web')) await buildWeb();
if (want('extension') && existsSync(join(root, 'extension/src/background.ts'))) await buildExtension();
