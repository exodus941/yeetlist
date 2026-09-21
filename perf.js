/* A FRAME PROFILER FOR THE DEVICE THAT HAS THE FAULT.

   Their report: the folds hitch on a phone, and the containment that took a
   400-row fold from 60.5 fps to 97.9 here only made it "slightly smoother"
   there. So this machine is the wrong instrument. It renders at 1x and a
   Galaxy S23 renders at 3x, which is nine times the pixels to raster per
   frame, so every cost that scales with the screen is invisible in a desktop
   pane. Layer promotion measured WORSE here, twice, which is the same story.

   So the phone runs the matrix instead. This loads only for ?perf, drives the
   real funnel, and times the frames the device actually committed. Nothing
   ships from a guess: whichever row wins here is the change that lands.

   IT IS NOT A BENCHMARK OF THE PHONE. Every row runs on the same device in
   the same session, so only the DIFFERENCES between rows mean anything. */

/* ONE PROFILER, TWO SCENES. Their second report names the notification
   rather than the filter panel: "the notification dismissal is still not
   smooth on phones". Both are folds and they move different amounts of the
   page, so each gets its own driver and its own candidates.

   `?perf` runs the filter fold. `?perf=status` runs the notification. */
const SCENES = {
  fold: {
    title: 'Fold profiler',
    what: 'It folds the filter panel six times per row.',
    /* THE FOLD IS DRIVEN BY ITS OWN CONTROL, never by writing the attribute.
       A probe that sets the end state measures a state change rather than
       the travel the reader complained about. */
    async run(sleep) {
      const funnel = document.querySelector('#filterToggle');
      funnel.click();
      await sleep(700);
      funnel.click();
      await sleep(700);
    },
    cases: [
      ['as shipped', ''],
      ['no list mask', '.table-wrap { -webkit-mask-image: none !important; mask-image: none !important }'],
      ['no containment', '.table-wrap { contain: none !important }'],
      ['no mask, no containment', '.table-wrap { -webkit-mask-image: none !important; mask-image: none !important; contain: none !important }'],
      ['no list shadow or radius', '.table-wrap { border-radius: 0 !important } .card, .add-card { box-shadow: none !important }'],
    ],
  },

  status: {
    title: 'Notification profiler',
    what: 'It shows a message and dismisses it, three times per row.',
    /* THE MESSAGE IS SHOWN AND DISMISSED THE WAY A READER DOES IT. The cross
       is the control, and `say` is the door every message comes through. */
    async run(sleep) {
      window.say?.('Added to your watchlist.');
      await sleep(700);
      document.querySelector('#addStatusDismiss')?.click();
      await sleep(700);
    },
    /* THE NOTIFICATION MOVES THE WHOLE PAGE BELOW IT, which is more than the
       filter fold moves. So the candidates are about what that travel costs
       the things underneath, and about how many properties travel at once.
       Three animate today: the grid track, the margin and the opacity. */
    cases: [
      ['as shipped', ''],
      /* THE ROWS ARE THE COST, and skipping the ones nobody is looking at is
         the only candidate that moved the number here. 130px is the CONTENT
         height of a card, which is its 164px box less 34 of padding and
         borders: `contain-intrinsic-size` states the content size and the
         browser adds the rest. Stated as 164 the page came out 18.7% too
         long. At 130 it is 0.18% short. */
      ['rows skipped off screen', '.card, tbody tr { content-visibility: auto; contain-intrinsic-size: auto 130px }'],
      ['list: layout paint', '.table-wrap { contain: layout paint !important }'],
      ['no margin travel', '.status-line { transition: grid-template-rows var(--duration) var(--ease) !important; margin-block-start: var(--space-md) !important }'],
      ['no clipper fade', '.status-clip { transition: none !important; opacity: 1 !important }'],
      ['rows skipped, no clipper fade', '.card, tbody tr { content-visibility: auto; contain-intrinsic-size: auto 130px } .status-clip { transition: none !important; opacity: 1 !important }'],
    ],
  },
};

const chosen = /[?&]perf=status/.test(location.search) ? SCENES.status : SCENES.fold;
const CASES = chosen.cases;

const sheet = document.createElement('style');
document.head.appendChild(sheet);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Frames the device COMMITTED. A gap is the distance between two of them, so
   the count over 32ms is the number of times the reader saw a hitch. */
async function timeOne() {
  const gaps = [];
  let last = 0;
  let frames = 0;
  let running = true;

  const tick = (t) => {
    if (last) gaps.push(t - last);
    last = t;
    frames += 1;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const start = performance.now();
  await chosen.run(sleep);
  running = false;

  const ms = performance.now() - start;
  gaps.sort((a, b) => a - b);
  return {
    fps: +(frames / (ms / 1000)).toFixed(1),
    p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
    worst: +gaps[gaps.length - 1].toFixed(1),
    hitches: gaps.filter((g) => g > 32).length,
  };
}

/* Three runs a row, because one run of a fold is mostly noise. The rows are
   interleaved rather than run in blocks: a phone throttles as it warms, and
   in blocks that warming lands entirely on the last row. */
async function matrix(report) {
  const runs = CASES.map(() => []);

  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 0; i < CASES.length; i += 1) {
      sheet.textContent = CASES[i][1];
      report(`pass ${pass + 1} of 3 — ${CASES[i][0]}…`);
      await sleep(120);
      runs[i].push(await timeOne());
    }
  }

  sheet.textContent = '';
  return CASES.map(([label], i) => {
    const r = runs[i];
    const mean = (k) => +(r.reduce((a, b) => a + b[k], 0) / r.length).toFixed(1);
    return {
      label,
      fps: mean('fps'),
      p95: mean('p95'),
      hitches: r.reduce((a, b) => a + b.hitches, 0),
      worst: Math.max(...r.map((x) => x.worst)),
    };
  });
}

/* ONE PANEL, AND IT SAYS WHAT IT IS MEASURING. A probe that prints to the
   console is a probe nobody can read on a phone. */
function panel() {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset-inline:8px;bottom:8px;z-index:9999;'
    + 'padding:12px;border:1px solid #666;border-radius:8px;background:#111;color:#eee;'
    + 'font:12px/1.5 ui-monospace,monospace;max-height:70vh;overflow:auto';
  box.innerHTML = '<div style="display:flex;gap:8px;align-items:center">'
    + `<strong style="flex:1">${chosen.title}</strong>`
    + '<button id="perfRun" style="min-height:44px;padding:0 12px">Run</button>'
    + '<button id="perfCopy" style="min-height:44px;padding:0 12px">Copy</button>'
    + '</div><pre id="perfOut" style="margin:8px 0 0;white-space:pre-wrap"></pre>';
  document.body.appendChild(box);

  const out = box.querySelector('#perfOut');
  const say = (t) => { out.textContent = t; };
  let text = '';

  say(`rows: ${document.querySelectorAll('tbody tr').length}`
    + `\ndpr: ${devicePixelRatio}`
    + `\nwidth: ${document.documentElement.clientWidth}`
    + `\n\nPress Run. ${chosen.what}`);

  box.querySelector('#perfRun').addEventListener('click', async () => {
    box.querySelector('#perfRun').disabled = true;
    const rows = await matrix(say);
    const head = `rows ${document.querySelectorAll('tbody tr').length}`
      + ` · dpr ${devicePixelRatio} · ${document.documentElement.clientWidth}px`;
    text = head + '\n' + rows.map((r) => `${r.label}: ${r.fps} fps · p95 ${r.p95}ms`
      + ` · ${r.hitches} hitches · worst ${r.worst}ms`).join('\n');
    say(text);
    box.querySelector('#perfRun').disabled = false;
  });

  box.querySelector('#perfCopy').addEventListener('click', () => {
    navigator.clipboard?.writeText(text || 'nothing measured yet');
  });
}

panel();
