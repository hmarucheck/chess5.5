// Bundles the app into single self-contained HTML files with no build
// dependencies:
//
//   dist/chess.html     a complete page you can open straight from disk
//   dist/artifact.html  the same page without the <html>/<head>/<body>
//                       wrapper, for hosts that supply their own skeleton
//
// The bundler is deliberately tiny. It follows relative ES module imports,
// orders modules so dependencies come first, strips import/export syntax,
// and wraps everything in one function scope. That only works because the
// codebase keeps a few rules, which this script enforces:
//   * every import is a named import from a relative path (no aliases),
//   * top-level declaration names are unique across all modules.
// The engine worker is bundled the same way and started from a Blob URL.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const IMPORT_RE = /^import\s+(?:\{([\s\S]*?)\}\s+from\s+)?['"]([^'"]+)['"];?[ \t]*$/gm;
const DECL_RE = /^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

function readModule(file) {
  return fs.readFileSync(file, 'utf8');
}

// Depth-first walk of the import graph; returns files in dependency order.
function collect(entry, replacements = {}) {
  const order = [];
  const state = new Map(); // file -> 'visiting' | 'done'
  const visit = (file, from) => {
    if (state.get(file) === 'done') return;
    if (state.get(file) === 'visiting') throw new Error(`Circular import: ${from} -> ${file}`);
    state.set(file, 'visiting');
    const source = replacements[file] ?? readModule(file);
    for (const match of source.matchAll(IMPORT_RE)) {
      const [, names, spec] = match;
      if (!spec.startsWith('.')) throw new Error(`${rel(file)} imports a bare module "${spec}"; only relative imports can be bundled.`);
      if (names && /\bas\b/.test(names)) throw new Error(`${rel(file)} uses an aliased import; rename instead.`);
      visit(path.resolve(path.dirname(file), spec), file);
    }
    state.set(file, 'done');
    order.push(file);
  };
  visit(entry, '(entry)');
  return order;
}

function rel(file) {
  return path.relative(root, file);
}

function stripModuleSyntax(source, file) {
  let out = source.replace(IMPORT_RE, '');
  out = out.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '');
  if (/^export\s/m.test(out)) throw new Error(`${rel(file)} has an export form the bundler does not support.`);
  if (/import\.meta/.test(out)) throw new Error(`${rel(file)} uses import.meta, which cannot be bundled.`);
  return out;
}

function bundle(entry, replacements = {}) {
  const files = collect(entry, replacements);
  const seen = new Map();
  const parts = [];
  for (const file of files) {
    const source = replacements[file] ?? readModule(file);
    for (const match of source.matchAll(DECL_RE)) {
      const name = match[1];
      if (seen.has(name)) {
        throw new Error(`Top-level name "${name}" is declared in both ${rel(seen.get(name))} and ${rel(file)}.`);
      }
      seen.set(name, file);
    }
    parts.push(`// ---- ${rel(file)}\n${stripModuleSyntax(source, file).trim()}\n`);
  }
  return { code: `(() => {\n'use strict';\n${parts.join('\n')}\n})();\n`, files };
}

// Keeps inline scripts from terminating early inside HTML.
function safeForScriptTag(code) {
  return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

function build() {
  const workerEntry = path.join(root, 'src/ai/worker.js');
  const worker = bundle(workerEntry);

  const factoryFile = path.join(root, 'src/ai/worker-factory.js');
  const factorySource = [
    '// Single-file build: the engine worker is inlined and started from a Blob URL.',
    `const ENGINE_WORKER_SOURCE = ${JSON.stringify(worker.code)};`,
    'export function createEngineWorker() {',
    "  const blob = new Blob([ENGINE_WORKER_SOURCE], { type: 'text/javascript' });",
    '  return new Worker(URL.createObjectURL(blob));',
    '}',
    '',
  ].join('\n');

  const app = bundle(path.join(root, 'src/main.js'), { [factoryFile]: factorySource });
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  const script = `<script>\n${safeForScriptTag(app.code)}</script>`;
  const style = `<style>\n${css}</style>`;

  const stylesheetTag = '<link rel="stylesheet" href="styles.css">';
  const scriptTag = '<script type="module" src="src/main.js"></script>';
  if (!html.includes(stylesheetTag) || !html.includes(scriptTag)) {
    throw new Error('index.html no longer contains the expected stylesheet and script tags.');
  }

  const full = html.replace(stylesheetTag, () => style).replace(scriptTag, () => script);

  // Fragment version: head contents we need (title, fonts) plus body contents.
  const headMatch = /<head>([\s\S]*?)<\/head>/.exec(html);
  const bodyMatch = /<body>([\s\S]*?)<\/body>/.exec(html);
  const headKeep = headMatch[1]
    .split('\n')
    .filter((line) => /<title>|fonts\.g|preconnect|name="description"/.test(line))
    .map((line) => line.trim())
    .join('\n');
  // Hosted viewers block file downloads, so the fragment drops that button.
  const downloadButton = '<button class="btn" type="button" id="io-download-pgn">Download .pgn</button>';
  if (!html.includes(downloadButton)) throw new Error('index.html no longer contains the download button markup.');
  const body = bodyMatch[1].trim().replace(downloadButton, '').replace(scriptTag, () => script);
  const fragment = `${headKeep}\n${style}\n${body}\n`;

  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'chess.html'), full);
  fs.writeFileSync(path.join(dist, 'artifact.html'), fragment);

  const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
  console.log(`Bundled ${app.files.length} modules (${worker.files.length} in the engine worker).`);
  console.log(`  dist/chess.html     ${kb(full)}`);
  console.log(`  dist/artifact.html  ${kb(fragment)}`);
}

try {
  build();
} catch (err) {
  console.error(`Build failed: ${err.message}`);
  process.exit(1);
}
