/* EVALUATE THE REAL FUNCTIONS, NEVER A COPY OF THEM.
 *
 * `app.js` runs in a browser and needs a DOM, so a plain Node test cannot
 * import it. It can slice the declarations it wants out by name and run
 * those, which keeps the test pointed at the shipped code: a rewrite of any
 * of them fails the guard rather than leaving a copy agreeing with itself.
 *
 * ONE SLICER, EVERY CALLER. Two guards held the same brace counter, and a
 * second implementation drifts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const appSource = () => readFileSync(join(root, 'app.js'), 'utf8');

/* A TOP-LEVEL DECLARATION IN THIS FILE STARTS AT COLUMN 0 AND ENDS AT ONE.
   Counting brackets from the opening line and stopping where the depth
   returns to zero takes the whole body, nested functions included. */
export function slice(src, name) {
  const lines = src.split('\n');
  const head = new RegExp(`^(?:function|const|let) ${name}\\b`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) throw new Error(`slice-app: no declaration for ${name}`);

  let depth = 0;
  for (let i = start; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{' || ch === '(' || ch === '[') depth += 1;
      if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    }
    if (depth <= 0) return lines.slice(start, i + 1).join('\n');
  }
  throw new Error(`slice-app: ${name} never closes`);
}

/* Build a module out of the named declarations, with the app's own mutable
   state supplied by the harness and handed back through accessors. */
export function build(names, { state = [], extra = '' } = {}) {
  const src = appSource();
  const body = [
    ...state.map((n) => `let ${n};`),
    extra,
    ...names.map((n) => slice(src, n)),
    'return {',
    ...state.map((n) => `  get ${n}() { return ${n} }, set ${n}(v) { ${n} = v },`),
    `  ${names.join(', ')} };`,
  ].join('\n\n');
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}
