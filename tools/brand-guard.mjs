#!/usr/bin/env node
/* THE IDENTITY IS ONE SET OF NUMBERS, AND EVERY COPY AGREES WITH IT.
 *
 * Their instruction, 25 September 2026: the app gets its own identity. The
 * name is Yeetlist, the accent is #ff0044, and the play button becomes their
 * drawing, shape only.
 *
 * The mark's geometry lives in tools/brand-mark.mjs. The icon makers import
 * it. Four copies cannot import anything, so this reads them: the page's own
 * symbol, the loading screen, the tab icon on both pages, and the Android
 * launcher icon. The accent is read from the stylesheet and asked of every
 * other place that states it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ringPath, dotPath, trianglePath, inMark, CENTRE, RING, DOT } from './brand-mark.mjs';

const root = new URL('..', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });

const ring = ringPath(), dot = dotPath(), tri = trianglePath();
const index = read('index.html');
const privacy = read('privacy.html');
const css = read('styles.css');

/* -- 1. The mark ---------------------------------------------------------- */
{
  const symbol = /<symbol id="i-brand"[^>]*>([\s\S]*?)<\/symbol>/.exec(index)?.[1] || '';
  ok('the page carries the mark', Boolean(symbol));
  for (const [name, d] of [['ring', ring], ['dot', dot], ['triangle', tri]]) {
    ok(`the page's ${name} is the measured one`, symbol.includes(`d="${d}"`));
    ok(`and the loading screen's`, /class="boot-mark"[\s\S]{0,900}/.exec(index)?.[0].includes(`d="${d}"`));
    ok(`and the Android icon's`, read('android/app/src/main/res/drawable/ic_launcher_foreground.xml')
      .includes(`android:pathData="${d}"`));
  }
  /* THE ICON RULE STROKES EVERY SHAPE AND FILLS NONE. An attribute would
     lose to that rule, so each shape states its paint inline. Without it the
     header drew three outlines. */
  ok('each shape paints itself filled', (symbol.match(/style="fill:currentColor;stroke:none"/g) || []).length === 3);
  ok('the header uses the mark', /class="brand-mark"><svg class="icon" aria-hidden="true"><use href="#i-brand"\/>/.test(index));
  ok('and the play button is gone from it', !/brand-mark"><svg[^>]*><use href="#i-play"/.test(index));

  const tab = (html) => decodeURIComponent(/rel="icon" href="data:image\/svg\+xml,([^"]+)"/.exec(html)?.[1] || '');
  for (const [page, html] of [['the app', index], ['the privacy page', privacy]]) {
    const svg = tab(html);
    ok(`${page}'s tab icon draws the mark`, svg.includes(ring) && svg.includes(dot) && svg.includes(tri));
  }

  /* THE SHAPE ITSELF, as their drawing measured. A ring cut on the diagonal,
     a dot in the gap, a triangle at the centre. */
  const onRing = (deg) => inMark(CENTRE + 192 * Math.cos(deg * Math.PI / 180), CENTRE + 192 * Math.sin(deg * Math.PI / 180));
  ok('the ring is cut where the drawing is cut',
    onRing(198) && !onRing(201) && !onRing(249) && onRing(252) && onRing(0) && onRing(90));
  ok('the dot sits on the ring’s middle line', Math.abs(Math.hypot(DOT.x - CENTRE, DOT.y - CENTRE) - (RING.outer + RING.inner) / 2) < 4);
  ok('and in the middle of the gap', Math.abs(Math.atan2(DOT.y - CENTRE, DOT.x - CENTRE) * 180 / Math.PI + 135) < 0.5);
  ok('the triangle is solid at its centre', inMark(270, 256));
  ok('and the space around it is empty', !inMark(190, 256));
}

/* -- 2. The colour --------------------------------------------------------- */
{
  const accent = /--accent:\s*(#[0-9a-f]{6});/i.exec(css)?.[1]?.toLowerCase();
  ok('the accent is theirs', accent === '#ff0044', accent);
  ok('the note export uses it too', read('notes.js').toLowerCase().includes(`--accent: ${accent};`));
  ok('and the Android icon ground', read('android/app/src/main/res/values/colors.xml').toLowerCase()
    .includes(`<color name="accent">${accent}</color>`));
  ok('and both tab icons', [index, privacy].every((h) => decodeURIComponent(h).toLowerCase().includes(`fill='${accent}'`)));
  ok('the old red is gone from the accent', !/--accent:\s*#ff3030/i.test(css));

  /* A FILL THAT CARRIES WORDS ANSWERS 4.5. White on each of the two. */
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const fill = /--accent-fill:\s*(#[0-9a-f]{6});/i.exec(css)?.[1];
  const hover = /--accent-fill-hover:\s*(#[0-9a-f]{6});/i.exec(css)?.[1];
  ok('white words read on the button', fill && contrast('#ffffff', fill) >= 4.5, fill && contrast('#ffffff', fill).toFixed(2));
  ok('and on its hover', hover && contrast('#ffffff', hover) >= 4.5, hover && contrast('#ffffff', hover).toFixed(2));
  ok('and the two can be told apart', fill && hover && contrast(fill, hover) >= 1.2, fill && hover && contrast(fill, hover).toFixed(2));
}

/* -- 3. The name ----------------------------------------------------------- */
{
  const files = execFileSync('git', ['ls-files'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.startsWith('legacy/') && f !== 'tools/brand-guard.mjs')
    .filter((f) => /\.(js|mjs|cjs|html|css|json|webmanifest|md|yml|xml|java|gradle|txt)$/.test(f))
    .filter((f) => existsSync(new URL(f, root)));
  const old = files.filter((f) => read(f).includes('YeeT' + 'list'));
  ok('the old spelling is gone', old.length === 0, old.join(' '));
  ok('the app names itself', /<title>Yeetlist<\/title>/.test(index)
    && JSON.parse(read('manifest.webmanifest')).name === 'Yeetlist');
  ok('and so does the phone', read('android/app/src/main/res/values/strings.xml').includes('<string name="appName">Yeetlist</string>'));
}

let bad = 0;
for (const c of cases) if (!c.pass) { bad += 1; console.log(`brand guard: FAIL ${c.name}${c.note ? ` - ${c.note}` : ''}`); }
if (!cases.length) { console.error('brand guard: no cases ran'); process.exit(1); }
console.log(`brand guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
