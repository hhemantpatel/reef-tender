// Concatenates the ES modules into one self-contained HTML file. Sources stay
// split so node --test can import them directly; the browser gets a single
// <script type="module"> with the import/export lines stripped out.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// Dependency order. Modules only reference things defined above them.
const MODULES = [
  'lang/errors.js',
  'lang/values.js',
  'lang/features.js',
  'lang/lexer.js',
  'lang/parser.js',
  'lang/interp.js',
  'lang/builtins.js',
  'game/world.js',
  'game/techtree.js',
  'game/api.js',
  'game/session.js',
  'docs/api.js',
  'ui/editor.js',
  'ui/render.js',
  'ui/panels.js',
  'ui/app.js',
];

const strip = (src) => src
  .replace(/^import\s[\s\S]*?;[ \t]*$/gm, '')
  .replace(/^export\s+\{[^}]*\};?[ \t]*$/gm, '')
  .replace(/^export\s+(const|let|var|function|class|async)\b/gm, '$1')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/** Everything lands in one scope, so a duplicated top-level name is a real bug. */
function checkCollisions(chunks) {
  const seen = new Map();
  const clashes = [];
  for (const { file, code } of chunks) {
    const re = /^(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
    for (const m of code.matchAll(re)) {
      const name = m[1];
      if (seen.has(name)) clashes.push(`${name}: ${seen.get(name)} and ${file}`);
      else seen.set(name, file);
    }
  }
  if (clashes.length) {
    console.error('Top-level name collisions in the bundle:\n  ' + clashes.join('\n  '));
    process.exit(1);
  }
}

const chunks = MODULES.map((file) => ({
  file,
  code: strip(readFileSync(join(root, 'src', file), 'utf8')),
}));
checkCollisions(chunks);

const js = chunks.map((c) => `// ===== ${c.file} =====\n${c.code}`).join('\n\n');
const css = readFileSync(join(root, 'src/style.css'), 'utf8').trim();
const html = readFileSync(join(root, 'src/shell.html'), 'utf8')
  .replace('{{CSS}}', () => css)
  .replace('{{JS}}', () => js);

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist/reef-tender.html');
writeFileSync(out, html);
console.log(`built ${out}  ${(html.length / 1024).toFixed(0)} KB  (${MODULES.length} modules)`);
