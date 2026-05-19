/**
 * build.mjs — esbuild build script for dev-agent
 *
 * Produces two artefacts:
 *   dist/extension.cjs    — CJS bundle for the VS Code extension host
 *   dist/panel-webview.js — IIFE bundle for the sandboxed webview
 *
 * Also compiles src/styles/panel.scss → src/styles/compiled-css.js so that
 * panel.js can require() it without touching the file-system at runtime.
 *
 * Usage:
 *   node scripts/build.mjs           — one-shot build
 *   node scripts/build.mjs --watch   — rebuild on source changes
 */

import { build, context } from 'esbuild';
import { argv }           from 'process';
import { writeFileSync }  from 'fs';
import * as sass          from 'sass';

const watch = argv.includes('--watch');

// ── 1. Compile SCSS ────────────────────────────────────────────────────────
// Compile the SCSS entry point and write the result as a CJS module so that
// panel.js can require('./styles/compiled-css') without any extra loaders.

function compileSCSS() {
  const result = sass.compile('src/styles/panel.scss', {
    style: 'compressed',
    loadPaths: ['src/styles'],
  });
  // Write as a CommonJS module (required by the extension host at build time)
  const js = '/* AUTO-GENERATED — do not edit; run `npm run build` */\n'
    + 'module.exports = ' + JSON.stringify(result.css) + ';\n';
  writeFileSync('src/styles/compiled-css.js', js);
  console.log('SCSS compiled → src/styles/compiled-css.js (' + result.css.length + ' bytes)');
}

compileSCSS();

// ── 2. Bundle the VS Code extension host ──────────────────────────────────

const extensionOptions = {
  entryPoints: ['src/extension.js'],
  bundle: true,
  outfile: 'dist/extension.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: [
    'vscode',
    // Native modules that can't be bundled:
    'better-sqlite3',
    'node-pty',
    'tree-sitter',
    'tree-sitter-go',
    'tree-sitter-javascript',
    'tree-sitter-php',
    'tree-sitter-python',
    'tree-sitter-rust',
  ],
  // agent-core and browser-ai-bridge ship as ESM packages loaded at runtime
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
};

// ── 3. Bundle the webview ──────────────────────────────────────────────────
// The webview modules use ESM syntax; esbuild compiles them to an IIFE that
// runs in the sandboxed webview context (no CommonJS, no Node globals).

const webviewOptions = {
  entryPoints: ['src/webview/index.js'],
  bundle: true,
  outfile: 'dist/panel-webview.js',
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  // Use esbuild context API for watch mode — rebuilds on any source change.
  const [extCtx, wvCtx] = await Promise.all([
    context(extensionOptions),
    context(webviewOptions),
  ]);
  await Promise.all([extCtx.watch(), wvCtx.watch()]);
  console.log('Watching for changes…');
  // Re-compile SCSS on changes by polling (esbuild watch doesn't handle non-JS)
  // For SCSS live-reload run: sass --watch src/styles/panel.scss src/styles/compiled-css.css
} else {
  await Promise.all([
    build(extensionOptions),
    build(webviewOptions),
  ]);
}
