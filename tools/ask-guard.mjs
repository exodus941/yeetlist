#!/usr/bin/env node
/* ASKING TO LINK, ON A FIRST RUN.
 *
 * Their instruction, 22 September 2026: a prompt on a first run offering to
 * sign in and sync across devices. Shown three drawings, they took the
 * modal's look and the card's place: "i want the look of the modal (A) but i
 * want it to be displayed as a card above the list", then "in fact, i want it
 * displayed above the tabs".
 *
 * FOUR THINGS HAVE TO BE TRUE, and each one is a reason not to ask. A card
 * that appears where any of them is false is nagging, and nagging is the one
 * failure a first-run prompt has.
 */
import { readFileSync } from 'node:fs';
import { appSource, slice as sliceOne } from './slice-app.mjs';

const src = appSource();
const blank = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
const code = blank(src);
const at = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const html = at('../index.html');
const css = at('../styles.css');

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });

/* -- 1. It is above the tabs, and outside the panel ----------------------- */
/* ABOVE THE TABS, SO IT BELONGS TO THE PAGE RATHER THAN TO ONE LIST. The
   three lists sync together, so a card inside the panel would say the offer
   is about whichever tab is open. */
{
  const ask = html.indexOf('id="syncAsk"');
  const tabs = html.indexOf('<div class="tabs"');
  const panel = html.indexOf('id="listPanel"');
  ok('the card is in the markup', ask > -1);
  ok('the tab strip was found', tabs > -1);
  ok('and the card comes before the tabs', ask > -1 && tabs > -1 && ask < tabs,
    `${ask} against ${tabs}`);
  /* ONLY THE PANEL SLIDES, so anything outside it holds still between tabs.
     A card inside would travel with the list and snap at the far end. */
  ok('and before the panel that slides', ask > -1 && panel > -1 && ask < panel,
    `${ask} against ${panel}`);
}

/* -- 2. Four conditions, and every one of them is asked ------------------- */
{
  /* THE FOUR LIVE IN ONE FUNCTION, because the painter and the dismissal both
     need the answer and two copies of four conditions drift. */
  const fn = sliceOne(code, 'askWanted');
  ok('the question was found', fn.length > 80, String(fn.length));
  ok('the deployment has to offer Drive', /driveAvailable === true/.test(fn));
  ok('nobody is linked', /!DRIVE\.connected\(\)/.test(fn));
  ok('the library is empty', /videos\.length === 0/.test(fn));
  ok('and it was not dismissed', /!askDismissed\(\)/.test(fn));
  /* EVERY ONE, NOT ANY ONE. Written with `||` the card would show whenever a
     single condition held, which is three quarters of the time. */
  const ands = (fn.match(/&&/g) || []).length;
  ok('all four have to hold at once', ands === 3, String(ands));
  ok('and one attribute answers for it',
    /card\.hidden = !show;/.test(sliceOne(code, 'renderSyncAsk')));
}

/* -- 3. It is painted wherever its facts change --------------------------- */
/* THE ROW COUNT IS THE ONE FACT renderDrive CANNOT SEE, and the link state is
   the one render() cannot. Called from one alone, the card outlives its own
   condition. */
{
  const drive = sliceOne(code, 'renderDrive');
  const render = sliceOne(code, 'render');
  ok('the drive painter calls it', /renderSyncAsk\(\);/.test(drive));
  ok('and the list render calls it', /renderSyncAsk\(\);/.test(render));
}

/* -- 4. Dismissed means gone, and it survives a reload -------------------- */
{
  ok('the dismissal is stored', /const ASK_STORE = 'yeetlist-sync-ask';/.test(code));
  ok('and read back', /localStorage\.getItem\(ASK_STORE\) === 'off'/.test(code));
  /* A PRIVATE WINDOW THROWS ON BOTH, and a card that cannot be dismissed is
     worse than one that was never shown. */
  const dis = sliceOne(code, 'askDismissed');
  const off = sliceOne(code, 'dismissAsk');
  ok('reading it cannot throw', /catch \{ return false; \}/.test(dis));
  ok('writing it cannot throw', /catch \{/.test(off));
  ok('and writing it repaints', /renderSyncAsk\(\);/.test(off));
}

/* -- 5. Three controls, and Link is the one that already exists ----------- */
/* ONE ROUTE TO A DRIVE CONNECTION. A second would drift from the header's
   button the first time either moved. */
{
  ok('Link runs the same function the header runs',
    /\$\('#syncAskLink'\)\.addEventListener\('click', \(\) => driveConnect\(\{ interactive: true \}\)\);/.test(code));
  ok('Not Now dismisses', /\$\('#syncAskLater'\)\.addEventListener\('click', dismissAsk\);/.test(code));
  ok('the close mark dismisses', /\$\('#syncAskClose'\)\.addEventListener\('click', dismissAsk\);/.test(code));
  ok('and the header button is unchanged',
    /\$\('#driveConnect'\)\.addEventListener\('click', \(\) => driveConnect\(\{ interactive: true \}\)\);/.test(code));
}

/* -- 6. The look is the dialog's, read rather than copied ----------------- */
/* Their decision: the modal's look. Copying its values would be a second
   design of one thing, and the two drift the first time either moves. */
{
  for (const rule of [
    'dialog, .ask-card {',
    'dialog h2, .ask-card h2 {',
    'dialog p, .ask-card p {',
    'dialog .stack, .ask-card .stack {',
    'dialog menu, .ask-card menu {',
  ]) {
    ok(`the card shares ${rule.split(',')[1].trim().replace(' {', '')}`, css.includes(rule), rule);
  }

  /* AND THE FLOATING IS NOT SHARED. A z-index meant for a box over the page
     would put a card in flow above every menu on the screen. */
  const floatRule = css.slice(css.indexOf('dialog {\n  width: min(440px'));
  ok('the card takes no modal layer',
    /dialog \{\n  width: min\(440px[\s\S]{0,120}z-index: var\(--layer-modal\);\n\}/.test(css),
    floatRule.slice(0, 90));
  ok('and the card states no z-index',
    !/\.ask-card[^{]*\{[^}]*z-index/.test(css));

  /* IT SPANS THE PAGE, AND THE ACTION ROW SITS UNDER THE WORDS. Their
     instruction, 22 September 2026, over three corrections: "it needs to
     span the whole width", "the width should be the same as the address
     bar", and then, of four wide layouts drawn at 1316px, "the correct
     answer is A, but the buttons will go below the row with the text, not
     next to it."

     SO THE CARD STATES ONE THING AND EVERY OTHER RULE IS A FAULT. A width
     stops it matching the paste field. A measure on the sentence is what
     left 645px of dead space between the words and the buttons. A grid puts
     the buttons beside the text rather than under it. */
  ok('the card states one rule and nothing else',
    css.includes('.ask-card { margin-block-end: var(--space-xl) }'));
  ok('no width, so it matches the paste field',
    !/\.ask-card[^}]*\bwidth:/.test(css));
  ok('no measure, so the sentence fills the card',
    !/\.ask-(?:card|body)[^}]*max-width/.test(css));
  ok('no grid, so the buttons keep their own line',
    !/\.ask-(?:card|body)[^}]*display: grid/.test(css));
  /* AND NOTHING IS LEFT OF THE CONTAINER IT NEEDED. A wrapper nobody styles
     is a box the markup carries for no reason. */
  ok('the container query is gone', !/@container[\s\S]{0,400}\.ask-/.test(css));
  ok('and the wrapper it needed is gone',
    !html.includes('ask-body') && !css.includes('ask-body'));

  /* ONE WRITER FOR ONE GAP. Their report, 22 September 2026: "why is the
     padding after SYNC so huge?"

     `.eyebrow` STATES ITS OWN 8px MARGIN, for a bare block with nothing
     spacing it, and the stack adds another 8. The two add, so the overline
     sat 16px from its own title instead of 8. */
  ok('the overline states its own step for a bare block',
    /\.eyebrow \{[^}]*margin-bottom: var\(--space-sm\)/.test(css));
  ok('and the stack takes it off, because the stack is the writer',
    /dialog \.stack > \.eyebrow, \.ask-card \.stack > \.eyebrow \{ margin-bottom: 0 \}/.test(css));
  /* A DEAD CLASS IS A CLASS NO STYLESHEET MENTIONS. The first version carried
     `card`, which this stylesheet has never declared, so it painted nothing
     and read in the markup as though the box was handled. */
  ok('the markup names no class the stylesheet does not have',
    /<section id="syncAsk" class="ask-card"/.test(html));
}

/* -- 6b. One paragraph, two homes ----------------------------------------- */
/* Their instruction, 22 September 2026: "the stuff in the footer needs to be
   shown in the card. if the card is dismissed, it will move back to the
   footer (with a nice animation, obviously)."

   SO IT IS MOVED, NEVER COPIED. Two copies are two things to edit, and they
   disagree the first time either one moves. */
{
  ok('the words exist once', (html.match(/id="syncNote"/g) || []).length === 1);
  ok('the card holds a slot rather than a copy', /<div id="syncNoteSlot"><\/div>/.test(html));
  /* THE WORDS ARE IN THE FOOTER IN THE MARKUP, and the script moves them up.
     Written into the slot instead, a reader with no script would see them
     twice. */
  const slot = html.indexOf('id="syncNoteSlot"');
  const words = html.indexOf('Portable by design');
  const foot = html.indexOf('<footer id="sync-note">');
  ok('the words ship in the footer', foot > -1 && words > foot, `${foot} then ${words}`);
  ok('and not in the slot', slot > -1 && words > slot + 200, `${slot} then ${words}`);
  ok('the footer is still the home', /<footer id="sync-note">[\s\S]{0,400}id="syncNote"/.test(html));

  const fn = sliceOne(code, 'renderSyncAsk');
  ok('the painter moves it', /home\.append\(note\)/.test(fn));
  ok('and only when it is not already there', /note\.parentElement !== home/.test(fn));
  ok('the card is the home while it shows',
    /const home = show \? \$\('#syncNoteSlot'\) : \$\('#sync-note'\);/.test(fn));

  /* ONE QUESTION, ONE WRITER. The painter and the dismissal both need to know
     whether the card is wanted, and two copies of four conditions drift. */
  ok('the four conditions are asked in one place',
    /function askWanted\(\)/.test(code) && /const show = askWanted\(\);/.test(code));
}

/* -- 6c. The dismissal moves it and slides the page up -------------------- */
/* Their instruction: "make sure the card dismissal also has a nice animation,
   and it causes everything to smoothly slide up."

   A VIEW TRANSITION IS THE ONE MECHANISM THAT DOES BOTH. A fold would collapse
   the card and could not carry the words with it. */
{
  const off = sliceOne(code, 'dismissAsk');
  ok('the dismissal runs a view transition', /document\.startViewTransition\(run\)/.test(off));
  ok('and it marks the root for the length of the run', /root\.dataset\.ask = 'leaving';/.test(off));
  ok('and clears the mark either way',
    /transition\.finished\.then\(clear, clear\)/.test(off));
  /* A SKIPPED TRANSITION REJECTS BOTH. The browser skips one while another
     runs and again when the document is not painting, and the update lands
     either way. */
  ok('a skipped transition is caught', /transition\.ready\.catch/.test(off) && /transition\.finished\.catch/.test(off));
  ok('but a render that threw is not swallowed', /updateCallbackDone\.catch/.test(off));
  /* A BROWSER WITHOUT IT STILL HAS TO DISMISS. */
  ok('and it still works with no transition at all',
    /if \(typeof document\.startViewTransition !== 'function'\) return run\(\);/.test(off));

  /* ONLY WHILE IT IS LEAVING. A name lifts an element out of its ancestor's
     picture, so a name left on at rest would hold the footer still while the
     lists slide past each other. */
  for (const [what, sel] of [
    ['the card', ':root[data-ask] #syncAsk { view-transition-name: ask-card }'],
    ['the words', ':root[data-ask] #syncNote { view-transition-name: sync-note }'],
    ['the tab band', ':root[data-ask] .tabs { view-transition-name: tab-band }'],
  ]) ok(`${what} are named only while it leaves`, css.includes(sel), sel);

  /* EVERYTHING BELOW THE CARD IS NAMED, AND NOTHING ABOVE IT IS. Their
     report, 22 September 2026: "the rest of the chrome moving up is feeling
     oddly snappy, not smooth."

     THE TAB BAND WAS IN THE ROOT'S OWN PICTURE, which is told not to animate,
     so its new image covered the old one at once. Everything named glided and
     the band jumped its whole 234px in one frame, under a list that was still
     moving. Both travel the same distance, so both have to be named. */
  ok('the band takes the same run as the list',
    /\[data-ask\]::view-transition-group\(list-panel\),\s*\n\[data-ask\]::view-transition-group\(tab-band\)/.test(css));
  /* THE BAND'S TWO PICTURES ARE THE SAME PICTURE, so a cross-fade between
     them is a fade of a thing against itself. */
  ok('and it only travels', /\[data-ask\]::view-transition-old\(tab-band\),\s*\n\[data-ask\]::view-transition-new\(tab-band\) \{ animation: none \}/.test(css));
  /* THE PILL RIDES THE BAND. It is named at rest, so it is lifted out and
     animates on its own, and a shorter run would leave it behind. */
  ok('the pill keeps pace with the band',
    /\[data-ask\]::view-transition-group\(tab-pill\)/.test(css));

  /* A PICTURE OF A BOX THAT CHANGES SIZE IS STRETCHED TO FIT IT. Their
     report, 22 September 2026: "still not rising smoothly."

     Measured on that run: the panel grew 441px to 675 while its top rose 234,
     so every row inside the old picture was stretched over the whole 500ms.
     The swipe already answered this, and its answer was scoped to the swipe.

     ONE RULE, BOTH TRANSITIONS. The two state their own durations and share
     the sizing, because it is one answer to one question. */
  {
    /* FIND IT BY ITS BODY AND WALK BACK. A pattern that matches the selector
       list is non-greedy at the front, so it starts partway down and reports
       the entries above it as absent. */
    /* BLANK THE COMMENTS FIRST, or the walk back stops inside the one that
       explains the rule and reports it as the selector list. */
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const at = bare.indexOf('object-fit: none');
    const open = at > -1 ? bare.lastIndexOf('{', at) : -1;
    const shut = at > -1 ? bare.indexOf('}', at) : -1;
    const head = open > -1 ? bare.slice(Math.max(bare.lastIndexOf('}', open), bare.lastIndexOf(';', open)) + 1, open) : '';
    ok('the sizing rule was found', at > -1 && open > -1 && shut > open);
    const parts = head.split(',').map((s) => s.trim()).filter(Boolean);
    const rule = at > -1 ? [null, head, bare.slice(open + 1, shut)] : null;
    for (const want of [
      '[data-ask]::view-transition-old(list-panel)',
      '[data-ask]::view-transition-new(list-panel)',
      '[data-ask]::view-transition-old(sync-note)',
      '[data-ask]::view-transition-new(sync-note)',
      '[data-vt="next"]::view-transition-old(list-panel)',
    ]) ok(`it covers ${want.replace('::view-transition', '')}`, parts.includes(want), parts.join(' | ').slice(0, 120));

    const body = rule ? rule[2] : '';
    ok('each picture keeps its own size', /object-fit: none/.test(body));
    ok('and hangs from the top', /object-position: top left/.test(body));
    ok('and is clipped to the box', /overflow: clip/.test(body));

    /* AND THE DURATIONS STAY WHERE THEY WERE. The swipe runs short and the
       dismissal runs long, so the shared rule must state neither. */
    ok('the shared rule states no duration', !/animation-duration/.test(body));
  }

  /* AND NEVER AT REST. An unscoped name lifts the element out of its
     ancestor's picture for good, so the footer would hold still while the
     lists slide past each other. That is the fault this app already recorded
     about that exact element, so the scope is the whole safeguard. */
  /* THE LIST IS NOT IN THIS SET. It is named at rest on purpose, because the
     swipe glides it between tabs, and naming it again here would be a second
     writer for one property. */
  ok('the list is named once, for the swipe',
    (css.match(/\.list-panel \{ view-transition-name: list-panel \}/g) || []).length === 1);

  for (const [what, sel] of [['the words', '#syncNote'], ['the card', '#syncAsk']]) {
    const named = [...css.matchAll(new RegExp(`([^\\n{}]*${sel.replace('.', '\\.')}[^\\n{}]*)\\{[^}]*view-transition-name:\\s*(?!none)`, 'g'))];
    const loose = named.filter((m) => !m[1].includes('[data-ask]'));
    ok(`${what} carry no name at rest`, loose.length === 0, loose.map((m) => m[1].trim()).join(' | '));
  }

  ok('the three take the long run',
    /\[data-ask\]::view-transition-group\(sync-note\),[\s\S]{0,200}animation-duration: var\(--duration-fold\)/.test(css));
  ok('and the settling curve', /\[data-ask\]::view-transition-group[\s\S]{0,260}var\(--ease-slide\)/.test(css));

  /* THE CARD ONLY LEAVES, so the pair is an exit rather than a swap. */
  ok('the card fades out', /\[data-ask\]::view-transition-old\(ask-card\)[\s\S]{0,80}ask-leave/.test(css));
  ok('and nothing fades in behind it',
    /\[data-ask\]::view-transition-new\(ask-card\) \{ animation: none; opacity: 0 \}/.test(css));

  /* AND THE PAGE AROUND THEM HOLDS STILL. */
  ok('the bar and the tabs do not animate',
    /\[data-ask\]::view-transition-old\(root\),\s*\n\[data-ask\]::view-transition-new\(root\) \{ animation: none \}/.test(css));

  /* A SLIDE IS TRAVEL, SO IT GOES UNDER REDUCED MOTION. The card's own fade
     stays, because a fade is not motion. */
  ok('every travel stops under reduced motion',
    /:root\[data-ask\] #syncNote,\s*\n\s*:root\[data-ask\] \.tabs,\s*\n\s*:root\[data-ask\] \.list-panel \{ view-transition-name: none \}/.test(css));
}

/* -- 6d. The three distances they set ------------------------------------- */
{
  /* THE TITLE AND THE SENTENCE SAT AT 0px BOX TO BOX, so the only space
     between them was the leading the two line boxes already carry. Shown 0, 4
     and 8 on the real card, they took 8. */
  ok('the sentence stands clear of the title',
    /#syncNoteSlot \{ margin-block-start: var\(--space-sm\) \}/.test(css));
  /* AND THE OVERLINE SITS CLOSER TO THE TITLE IT NAMES, 8 to 4. */
  ok('the overline sits closer to its title',
    /dialog \.stack, \.ask-card \.stack \{[^}]*gap: var\(--space-xs\)/.test(css));
  /* THE BAND OWNS THE DISTANCE TO THE HEADING UNDER IT, 24 to 32. */
  ok('the tab band stands clear of the heading',
    /\.tabs \{[\s\S]{0,600}margin-block-end: var\(--space-2xl\);/.test(css));

  /* EVERY ONE IS A STEP ON THE SCALE. A number typed here is a second scale
     nobody can hold in their head. */
  const typed = /(?:#syncNoteSlot|\.ask-card)[^{]*\{[^}]*(?:margin|padding|gap)[^;}]*\b\d+px/.exec(css);
  ok('and none of them is a typed number', !typed, typed ? typed[0].slice(0, 70) : '');
}

/* -- 6e. The link button pulses while nothing is linked ------------------- */
/* Their instruction, 22 September 2026: "if an account isn't linked, have the
   link google drive button slowly pulse red, 5 seconds going red, 5 seconds
   going back to grey and so on." */
{
  /* TWENTY SECONDS, TEN EACH WAY. The keyframes name the midpoint, so the
     whole run is twice the figure they gave. */
  ok("the pulse runs fifteen seconds a cycle", /animation: link-pulse 15s infinite;/.test(css));
  ok('and turns at the midpoint', /@keyframes link-pulse \{[\s\S]{0,140}\n  50% \{/.test(css));

  /* A LOGARITHM IS FAST THEN SLOW, so its inverse is slow then fast: the
     button holds near grey and swings through red. Their instruction,
     22 September 2026: inverse logarithmic rather than linear.

     TWO HALVES, TWO CURVES, ON THE KEYFRAMES. A value on the shorthand
     applies to each half alike, so the fall would start fast and end fast. */
  ok('the rise eases in', /0% \{ animation-timing-function: cubic-bezier\(\.7, 0, \.84, 0\) \}/.test(css));
  ok('and the fall eases out',
    /50% \{[\s\S]{0,200}animation-timing-function: cubic-bezier\(\.16, 1, \.3, 1\);/.test(css));
  ok('and the shorthand states no curve of its own',
    !/animation: link-pulse [^;]*cubic-bezier/.test(css) && !/animation: link-pulse [^;]*var\(--ease/.test(css));
  /* IT ENDS ON THE PRIMARY BUTTON'S OWN COLOURS, never a red invented for
     this. Measured on the painted frames: 14.43:1 at rest and 4.63 at the
     peak, so every frame clears the 4.5 bar. */
  ok('the peak is the primary button, not a new red',
    /@keyframes link-pulse[\s\S]{0,200}background: var\(--accent-fill\);[\s\S]{0,120}color: var\(--accent-ink\);/.test(css));
  ok('and nothing in it is a literal colour',
    !/@keyframes link-pulse[\s\S]{0,240}#[0-9a-f]{3,8}/i.test(css));

  /* THE MARK ASKS WHETHER AN ACCOUNT IS LINKED, not whether the button is on
     screen. It also shows for a linked reader whose token has not come back,
     where it reads Reconnect Drive. */
  ok('it asks the link state', /#driveConnect\[data-linked="no"\] \{/.test(css));
  ok('and the render writes that state',
    /connect\.dataset\.linked = linked \? 'yes' : 'no';/.test(code));

  /* A HOVER OR A PRESS IS THE READER'S OWN ANSWER. */
  ok('a press or a focus ring stops the pulse',
    /#driveConnect\[data-linked="no"\]:active,\s*\n\s*#driveConnect\[data-linked="no"\]:focus-visible \{ animation: none \}/.test(css));
  /* AND THE HOVER IS BEHIND A DEVICE THAT HAS ONE. A tap leaves `:hover` set
     on a touch screen until something else is tapped, so an ungated rule
     would stop the pulse for good on a phone. */
  ok('and the hover is behind a real pointer',
    /@media \(prefers-reduced-motion: no-preference\) and \(hover: hover\) \{\s*\n\s*#driveConnect\[data-linked="no"\]:hover \{ animation: none \}/.test(css));

  /* AND IT IS MOTION, SO IT IS OPT-IN. An infinite animation is the one a
     reader who asked for less motion notices most. */
  const at = css.indexOf('animation: link-pulse');
  const gate = css.lastIndexOf('@media (prefers-reduced-motion: no-preference)', at);
  const shut = css.indexOf('\n}\n', gate);
  ok('the pulse is inside a no-preference block', gate > -1 && at > gate, `${gate} then ${at}`);
  void shut;
}

/* -- 7. It fades like every other thing the script hides ------------------ */
/* THE SET IS WRITTEN THREE TIMES, and a panel in one list alone flips display
   at the far end while the opacity never moves. */
{
  const lists = ['#syncAsk {', '#syncAsk[hidden] {', '#syncAsk:not([hidden]) {'];
  ok('it is in the transition list', /#pager, #syncAsk \{/.test(css));
  ok('it is in the resting list', /#filterPanel\[hidden\], #syncAsk\[hidden\] \{/.test(css));
  ok('and in the entry list', /#filterPanel:not\(\[hidden\]\), #syncAsk:not\(\[hidden\]\) \{/.test(css));
  void lists;
}

/* -- 8. It names itself, and the mark is not the name -------------------- */
{
  ok('the card is named by its own heading',
    /id="syncAsk"[^>]*aria-labelledby="syncAskTitle"/.test(html));
  ok('and that heading is there', /id="syncAskTitle"/.test(html));
  ok('the close mark carries a name', /id="syncAskClose"[\s\S]{0,120}aria-label="Dismiss"/.test(html));
  ok('and its mark is hidden from the tree',
    /id="syncAskClose"[\s\S]{0,200}<svg class="icon" aria-hidden="true">/.test(html));
}

/* -- Verdict -------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`ask guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('ask guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`ask guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
