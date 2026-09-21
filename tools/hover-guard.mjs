#!/usr/bin/env node
/* A HOVER STICKS ON A TOUCH SCREEN UNTIL SOMETHING ELSE IS TAPPED.
 *
 * Their report, 22 September 2026, with a screenshot: "i swiped left twice
 * from Notes. why is there still a grey rectangle stuck on the Notes tab?"
 *
 * The tab they last tapped kept `:hover`, so its fill stayed painted on a
 * tab nobody was on. `--row-hover` is #202020, which is the grey in the
 * picture. Nothing had gone wrong with the swipe: the fill belonged to a
 * pointer the device does not have.
 *
 * SO EVERY HOVER RULE SITS BEHIND A DEVICE THAT HAS ONE. This asks that,
 * because 36 scattered rules is exactly the shape where the next one gets
 * written outside the gate and nobody notices until a finger finds it.
 *
 * IT READS THE CASCADE, NEVER THE TEXT. A rule can sit inside one media
 * query nested in another, so the question is whether every condition
 * wrapping it includes a hover test. A scan for the string on the line above
 * would pass a rule nested two deep and fail a correct one.
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });

/* ── Walk the file, tracking the conditions in force ────────────────────
 *
 * Comments are stripped first. A `:hover` inside one is prose, and this
 * file's own explanation of the fault names it several times.
 */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const lines = bare.split('\n');

const stack = [];      // the @-rule preludes currently open
const ungated = [];    // hover rules with no hover condition over them
const gated = [];
let pending = '';      // a selector or prelude built across lines

for (let n = 0; n < lines.length; n += 1) {
  const line = lines[n];
  for (let k = 0; k < line.length; k += 1) {
    const ch = line[k];
    if (ch === '{') {
      const head = pending.trim();
      pending = '';
      if (head.startsWith('@')) { stack.push(head); continue; }
      /* A style rule. Ask what is over it. */
      if (head.includes(':hover')) {
        const covered = stack.some((s) => /\(\s*(?:any-)?hover\s*:\s*hover\s*\)/.test(s));
        (covered ? gated : ungated).push({ line: n + 1, head: head.slice(0, 70) });
      }
      stack.push(head);
      continue;
    }
    if (ch === '}') { stack.pop(); pending = ''; continue; }
    if (ch === ';') { pending = ''; continue; }
    pending += ch;
  }
  pending += ' ';
}

ok('the walk balanced its braces', stack.length === 0, `${stack.length} left open`);
ok('there are hover rules to ask about', gated.length + ungated.length > 20,
  String(gated.length + ungated.length));
ok('every hover rule is behind a device that has one', ungated.length === 0,
  ungated.map((u) => `${u.line}: ${u.head}`).join(' | '));

/* ── A GATE THAT SWALLOWED A NEIGHBOUR IS WORSE THAN NO GATE ────────────
 *
 * The wrap opened between the two halves of one selector list, leaving a
 * dangling selector followed by an at-rule. That is invalid, and CSS error
 * recovery would have discarded the rule after it in silence.
 */
{
  const dangling = [];
  for (let n = 0; n < lines.length - 1; n += 1) {
    if (!/,\s*$/.test(lines[n])) continue;
    if (/^\s*@/.test(lines[n + 1])) dangling.push(n + 1);
  }
  ok('no selector list is cut by an at-rule', dangling.length === 0, dangling.join(', '));
}

/* ── FOCUS IS NOT A HOVER, and gating it would take it from a finger ──── */
{
  const took = gated.filter((g) => /:focus/.test(g.head));
  ok('no focus rule was gated with a hover', took.length === 0,
    took.map((t) => `${t.line}: ${t.head}`).join(' | '));
}

/* ── The one they reported ─────────────────────────────────────────────── */
ok('the tab fill is gated',
  /@media \(hover: hover\) \{\s*\n\s*\.tab:hover \{/.test(css),
  (css.match(/[^\n]*\.tab:hover[^\n]*/) || [''])[0]);

/* ── And the file still parses ─────────────────────────────────────────── */
{
  let depth = 0;
  let worst = 0;
  for (const ch of bare) {
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth < worst) worst = depth; }
  }
  ok('braces balance over the whole file', depth === 0, `ends at ${depth}`);
  ok('and never close past the top', worst === 0, `reached ${worst}`);
}

/* -- Verdict --------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`hover guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('hover guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`hover guard: ${cases.length - bad} of ${cases.length} cases hold,`
  + ` ${gated.length} hover rules gated`);
process.exit(bad ? 1 : 0);
