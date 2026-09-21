/* Layout measuring tools. Paste into a browser probe, then call.
 *
 *   sweep()                every row in the page          inter-element
 *   sweep('.dmd')          only inside a region
 *   sweep(null, '.dmd')    everything except a region
 *   probe('.btn')          one element, in detail         intra-element
 *   align('.a', '.b')      two elements against each other
 *
 * Why this exists: aiming a probe at the row you are working on finds problems
 * in that row and nowhere else. A person glancing at the screen sweeps
 * everything at once, which is how an eye keeps beating an instrument that is
 * a hundred times more precise. So sweep first, then probe what it names.
 *
 * Metrical means the geometry agrees. Optical means it looks right, which is
 * not the same thing — a glyph centred by its line box sits visibly low,
 * because the box counts descender space the word does not use.
 */

/* ── Type metrics ───────────────────────────────────────────────────────── */

const _ctx = document.createElement('canvas').getContext('2d')

function _font (el) {
  const cs = getComputedStyle(el)
  _ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily
  return cs
}

/* Visually hidden but still in the layout.
 *
 * A screen-reader label clipped to 1px still returns a rect, and reading it as
 * real text is how this tool once reported an 8.5px baseline fault that did
 * not exist — and how I then "fixed" a working stylesheet and made it eight
 * times worse. Anything a person cannot see is not part of the alignment. */
function _hidden (el) {
  const cs = getComputedStyle(el)
  if (cs.visibility === 'hidden' || cs.opacity === '0') return true
  if (cs.clipPath && cs.clipPath !== 'none' && /inset\(\s*50%/.test(cs.clipPath)) return true
  const r = el.getBoundingClientRect()
  return r.width <= 1 || r.height <= 1
}

/* The part of an element you can actually see, after every clipping ancestor
 * has had its say.
 *
 * Measure the laid-out rect instead and three separate checks lie, which is
 * exactly what happened: a half-scrolled tab reported as covered, a tab
 * scrolled out reported as covered, and a nav folded shut — grid rows at 0,
 * overflow hidden — reported as overflowing by 83px. In all three the element
 * kept a full rect at a position nobody can see.
 *
 * Returns a zero-size box when nothing is visible, so callers can skip. */
function _visibleBox (el) {
  const r = el.getBoundingClientRect()
  let box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  for (let n = el.parentElement; n; n = n.parentElement) {
    const c = getComputedStyle(n)
    if (!/hidden|auto|scroll|clip/.test(c.overflowX + ' ' + c.overflowY)) continue
    const cr = n.getBoundingClientRect()
    box = {
      left: Math.max(box.left, cr.left), right: Math.min(box.right, cr.right),
      top: Math.max(box.top, cr.top), bottom: Math.min(box.bottom, cr.bottom),
    }
  }
  box.width = Math.max(0, box.right - box.left)
  box.height = Math.max(0, box.bottom - box.top)
  return box
}

/* A readable label for a report line.
 *
 * `el.className` is a STRING on an HTML element and an SVGAnimatedString on an
 * SVG one, so the obvious `String(el.className)` printed six findings as
 * "[object SVGAnimatedString]" and made them impossible to act on. A report you
 * cannot trace back to an element is not a report. */
function _name (el, max) {
  const c = el.getAttribute ? el.getAttribute('class') : null
  return (c ? String(c).slice(0, max || 30) : '') || el.tagName.toLowerCase()
}

/* The text node's own box, not the element's. An element box includes padding
   and leading, both of which move independently of the letters.
 *
 * This walked DIRECT children only, and that made the tool lie by silence.
 * Every header button here wraps its label in a span, so `typeMetrics` returned
 * null on all of them, so every baseline and text-centring check on those
 * buttons was skipped and the sweep reported them clean. A check that returns
 * null on a shape it does not recognise is worse than no check — it reads as a
 * pass. It also pushed labelled buttons into the icon-only branch, which is
 * where the 40px "off centre" nonsense came from.
 *
 * Descend instead. Skip hidden subtrees and svg, and hand back the element that
 * OWNS the text, because a wrapper span can set its own font-size and reading
 * the button's would measure a size that is not on screen. */
function _textRect (el) {
  if (_hidden(el)) return null
  const walk = node => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) return { node: n, owner: node }
      if (n.nodeType !== 1) continue
      if (n.tagName === 'svg' || n.tagName === 'SVG') continue
      if (_hidden(n)) continue
      const hit = walk(n)
      if (hit) return hit
    }
    return null
  }
  const hit = walk(el)
  if (!hit) return null
  const r = document.createRange()
  r.selectNode(hit.node)
  const rect = r.getBoundingClientRect()
  return rect.height ? { rect, text: hit.node.textContent.trim(), owner: hit.owner } : null
}

/* Everything the eye actually uses, in page coordinates.
 *
 *   baseline  where the letters sit
 *   capTop    top of a capital, not top of the line box
 *   opticalMid  midway between capTop and baseline — what reads as centred
 *
 * A Range bottom is none of these. It is the text box bottom, so it includes
 * the descender and grows with font size. Two correctly aligned items in
 * different sizes look misaligned when measured that way. */
function typeMetrics (el) {
  const found = _textRect(el)
  if (!found) return null
  /* The owner of the text, not the element asked about. A wrapper span may set
     its own size, and measuring the outer font measures letters nobody sees. */
  const cs = _font(found.owner || el)
  const m = _ctx.measureText(found.text)
  const caps = _ctx.measureText('H')
  const top = found.rect.top
  const baseline = top + m.fontBoundingBoxAscent
  const capTop = baseline - (caps.actualBoundingBoxAscent || m.fontBoundingBoxAscent * 0.72)
  return {
    text: found.text.slice(0, 18),
    fontSize: parseFloat(cs.fontSize),
    baseline: +baseline.toFixed(2),
    capTop: +capTop.toFixed(2),
    opticalMid: +((capTop + baseline) / 2).toFixed(2),
    ascent: +m.fontBoundingBoxAscent.toFixed(2),
    descent: +m.fontBoundingBoxDescent.toFixed(2),
    /* THE INK'S OWN BAND, so a caller can ask whether something is BESIDE
       this run or merely inside the same box. A column stacks its children,
       and a mark above a sentence is not an icon beside a label. */
    inkTop: +found.rect.top.toFixed(2),
    inkBottom: +found.rect.bottom.toFixed(2),
    /* The element, so a caller can ask which pane the run belongs to. Banding
       by vertical overlap alone puts two side-by-side panes on one line, and
       the tool then reports a fault between things nobody would align. */
    el,
  }
}

/* ── Paint ───────────────────────────────────────────────────────────────
 *
 * Layout and paint are different questions, and asking only the first is how a
 * sidebar stayed empty on every desktop for days while every measurement said
 * it was fine. It measured 180 by 239 with five items, inside a closed
 * `details` box 28px tall, and painted none of it.
 *
 * `getBoundingClientRect` answers "was this measured". It says nothing about
 * whether a person can see it. Three things have to agree:
 *
 *   1. It has a box.                       rect
 *   2. The engine renders it.              checkVisibility
 *   3. Nothing sits on top of it.          elementFromPoint
 *
 * The third catches occlusion and clipping that the first two miss, because it
 * asks the same question the browser asks when you click.
 */
function paintOf (el) {
  const r = el.getBoundingClientRect()
  const hasBox = r.width > 0 && r.height > 0
  /* `checkVisibility` covers display:none, visibility:hidden, opacity:0,
     content-visibility, and — the one that caught me — content inside a closed
     details element. Falls back to a manual walk where unsupported. */
  const rendered = typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })
    : (() => {
        for (let n = el; n; n = n.parentElement) {
          const cs = getComputedStyle(n)
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
          if (n.tagName === 'DETAILS' && !n.open && !el.closest('summary')) return false
        }
        return true
      })()

  /* Scrolled out of a strip is not the same as buried under something, and
     calling it "covered" sent me hunting an overlap that did not exist. Four
     tab buttons reported covered with nothing on top of them: they had simply
     scrolled past the edge of the strip that clips them, which is what a
     scrolling strip is for.
   *
   * So ask the clipping question first. If a scrolling ancestor's visible box
   * does not contain this, the hit test below is meaningless — it lands on the
   * clipper, or on nothing at all. */
  let clippedBy = null
  for (let n = el.parentElement; n && !clippedBy; n = n.parentElement) {
    const c = getComputedStyle(n)
    if (!/hidden|auto|scroll|clip/.test(c.overflowX + ' ' + c.overflowY)) continue
    const cr = n.getBoundingClientRect()
    if (r.right < cr.left + 1 || r.left > cr.right - 1 || r.bottom < cr.top + 1 || r.top > cr.bottom - 1)
      clippedBy = _name(n, 24)
  }

  /* Hit-test the centre, and a point inset from each corner in case the centre
     sits in a gap. Only meaningful for something inside the viewport.
   *
   * The trap here cost an hour: "no answer" is not "no". Six colour swatches
   * sat 1.3px above the fold, so the rect intersected the viewport and the
   * guard let them through, but every hit point landed BELOW it.
   * `elementFromPoint` returned null for all three, `.some()` collapsed that to
   * false, and the tool reported six visible swatches as buried. A test that
   * cannot run has to return null, not a verdict. */
  /* `pointer-events: none` means unclickable, not invisible — and hit testing
     is the only tool here that cannot tell the difference. `elementFromPoint`
     will never name such an element, so it always looks buried. A decorative
     mark inside a field is exactly this: painted on top, deliberately not
     clickable, and reported covered forever if this is not asked first. */
  const untestable = getComputedStyle(el).pointerEvents === 'none'

  let overlaidBy = null
  let onTop = null
  if (hasBox && rendered && !clippedBy && !untestable) {
    /* Test the VISIBLE part, not the laid-out part.
     *
     * A partly scrolled tab keeps its full rect at its layout position, and
     * half of that rect can sit outside the scroller under whatever is beside
     * it. The centre of the full rect then lands on a chevron, and the tab is
     * reported covered while every pixel you can actually see is clear. Zero
     * covered once the points are clamped to the visible box, at every scroll
     * position — the earlier reading was 51.6%.
     *
     * `clippedBy` above catches the fully-scrolled-out case. This catches the
     * half-way one, which is the common one. */
    let vis = { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    for (let n = el.parentElement; n; n = n.parentElement) {
      const c = getComputedStyle(n)
      if (!/hidden|auto|scroll|clip/.test(c.overflowX + ' ' + c.overflowY)) continue
      const cr = n.getBoundingClientRect()
      vis = { left: Math.max(vis.left, cr.left), right: Math.min(vis.right, cr.right),
              top: Math.max(vis.top, cr.top), bottom: Math.min(vis.bottom, cr.bottom) }
    }
    const visW = vis.right - vis.left, visH = vis.bottom - vis.top
    const inside = ([x, y]) => x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight
    const pts = (visW > 2 && visH > 2 ? [
      [vis.left + visW / 2, vis.top + visH / 2],
      [vis.left + 2, vis.top + 2],
      [vis.right - 2, vis.bottom - 2],
    ] : []).filter(inside)
    if (pts.length) {
      /* "Something else answers the hit test" is not "you cannot see it".
       *
       * A search mark inside a field is placed under the input, and the input
       * is transparent right over it — you see the mark perfectly, and the hit
       * test names the input because that is what you would click. Reporting it
       * covered sends you looking for an overlap that is doing its job.
       *
       * So when another element answers, ask whether it paints anything. No
       * background colour, no background image, and it hides nothing. */
      const paintsOver = h => {
        for (let n = h; n && n !== document.body; n = n.parentElement) {
          if (n === el || el.contains(n)) return false
          /* ── A SHARED ANCESTOR IS THE GROUND, NOT AN OVERLAY ──
           *
           * This walk used to climb past the box both elements sit inside,
           * and report the first painted thing it met above it.
           *
           * Measured on a line chart: `.chart-points` paints nothing, and
           * neither does `.chart-plot`, `.chart-frame` or `.chart`. Five
           * levels up the card paints, and the walk called that a cover. So
           * the chart's own line was reported buried under its own markers,
           * at two of 156 surface-widths, reproducibly.
           *
           * Ground behind a thing is not on top of it. Stop here. */
          if (n.contains(el)) return false
          const c = getComputedStyle(n)
          const bg = c.backgroundColor || ''
          const opaque = bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)
          if (opaque || (c.backgroundImage && c.backgroundImage !== 'none')) return true
        }
        return false
      }
      /* A scrim covering the page is a modal working, not a layout fault.
         Told apart by what it is: taken out of flow, spread over most of the
         viewport, and stacked above. Report it as such rather than as damage,
         so a real overlap somewhere else still stands out. */
      /* Measured against its OWN containing block, not the window. A modal
         stage inside a preview frame covers 99% of the frame and 12% of the
         screen, and a window-relative test called it a small floating thing
         and reported the page under it as damaged. What makes something a
         scrim is that it fills the box it belongs to. */
      const isOverlay = h => {
        for (let n = h; n && n !== document.body; n = n.parentElement) {
          const c = getComputedStyle(n)
          if (c.position !== 'fixed' && c.position !== 'absolute') continue
          const nr = n.getBoundingClientRect()
          const host = c.position === 'fixed' ? null : n.offsetParent
          const hr = host ? host.getBoundingClientRect() : { width: innerWidth, height: innerHeight }
          const hostArea = hr.width * hr.height
          if (hostArea > 0 && nr.width * nr.height > hostArea * 0.4) return _name(n, 24) || 'overlay'
        }
        return null
      }
      for (const [x, y] of pts) {
        const hit = document.elementFromPoint(x, y)
        if (!hit) continue
        if (hit === el || el.contains(hit) || hit.contains(el)) { onTop = true; break }
        if (!paintsOver(hit)) { onTop = true; break }
        overlaidBy = overlaidBy || isOverlay(hit)
        onTop = false
      }
    }
  }

  /* Invisible on purpose is not the same fault as invisible by accident, and a
     tool that cannot tell them apart cries wolf until nobody reads it.
   *
   * Two patterns are deliberate and both showed up here as false ghosts:
   *   - a lock icon at opacity 0 WITH a transition on opacity. That is an idle
   *     state. It fades in on hover and is doing exactly its job.
   *   - a file input at opacity 0. That is the standard hidden-picker overlay,
   *     clicked through a styled button.
   *
   * Anything else at zero opacity has no story, and that is the real ghost. */
  let hiddenOnPurpose = null
  if (hasBox && !rendered) {
    if (el.tagName === 'INPUT' && el.type === 'file') hiddenOnPurpose = 'file input, clicked through a button'
    else if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') hiddenOnPurpose = 'aria-hidden'
    else {
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n)
        if (c.opacity !== '0') continue
        const fades = /opacity|all/.test(c.transitionProperty || '') || (c.animationName && c.animationName !== 'none')
        if (fades) { hiddenOnPurpose = 'opacity 0 with a transition on it, so this is an idle state that fades in'; break }
      }
    }
  }

  return {
    hasBox,
    rendered,
    onTop,
    /* The failure worth a name: measured but invisible, with nothing in its own
       CSS to explain why. */
    ghost: hasBox && !rendered && !hiddenOnPurpose,
    hiddenOnPurpose,
    scrolledOutOf: clippedBy,
    underOverlay: overlaidBy,
    covered: hasBox && rendered && !clippedBy && !overlaidBy && onTop === false,
    rect: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
  }
}

/* ── INVISIBLE ON PURPOSE IS A STATE, AND THE MARKUP SAYS WHICH ──
 *
 * ONE SCORER, TWO CALLERS. The sweep asks this, and `proveGhosts` below asks
 * it on fixtures. A second implementation drifts, and these two predicates are
 * the ones that cost 13 false ghosts on correct code.
 *
 * A FOLDED MENU IS A STATE. A closed `<details>` keeps its contents laid out:
 * measured 190x36 on each of five nav items, with `checkVisibility` correctly
 * false. Box plus not-rendered IS the ghost definition, so a nav folded behind
 * a burger reported ten of them at every narrow width. Five links and their
 * five `li` wrappers.
 *
 * The `details` element SAYS SO, so read that rather than guessing from the
 * geometry. A summary is still rendered and sits outside the folded part, so
 * it keeps its ghost test.
 *
 * AND A TICK ON AN UNCHECKED BOX IS ALSO A STATE. A checkbox draws both states
 * in one cell and reveals one, so the tick on an unchecked box is
 * `visibility: hidden` on purpose. Three of those reported the moment the pass
 * could see hidden things at all.
 *
 * NARROW ON THE CONTROL'S OWN STATE, NEVER THE CLASS. A tick hidden while its
 * box IS checked is a real fault, and this still reports it. */
function ghostState (el, p) {
  const folded = (() => {
    for (let n = el; n; n = n.parentElement) {
      if (n.tagName === 'DETAILS') return !n.hasAttribute('open') && !el.closest('summary')
    }
    return false
  })()
  const unchosen = (() => {
    /* A WIDE BOX IS NOT A TICK. An ornament is small, and this stops the
       predicate silencing a whole hidden row inside a checkbox's label. */
    if (p.rect && p.rect.w > 24) return false
    let n = el.parentElement
    for (let up = 0; n && up < 3; up++, n = n.parentElement) {
      const inp = n.querySelector && n.querySelector(':scope > input[type="checkbox"], :scope > input[type="radio"]')
      if (inp) return !inp.checked
      const role = n.getAttribute && n.getAttribute('role')
      if (role === 'checkbox' || role === 'radio' || role === 'switch')
        return n.getAttribute('aria-checked') !== 'true'
    }
    return false
  })()
  /* SKIPPED OFF SCREEN IS A DECLARATION, NOT A FAULT. `content-visibility:
     auto` tells the browser not to render a subtree while it is out of
     view, so every element inside one has a box and paints nothing. That is
     the whole point of it, and it is what a long list uses to stop a fold
     repainting a thousand rows.

     THE ANCESTOR MUST ACTUALLY BE OUT OF VIEW. A card on screen renders
     normally, so a genuine ghost inside one still reports. Asking only for
     the property would blind the check for the whole list. */
  const skipped = (() => {
    const vh = innerHeight || document.documentElement.clientHeight;
    const vw = innerWidth || document.documentElement.clientWidth;
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (getComputedStyle(n).contentVisibility !== 'auto') continue
      const b = n.getBoundingClientRect()
      const onScreen = b.bottom > 0 && b.top < vh && b.right > 0 && b.left < vw
      if (!onScreen) return true
    }
    return false
  })()
  return { folded, unchosen, skipped, report: !!p.ghost && !folded && !unchosen && !skipped }
}

/* ── THE GHOST PASS IS PROVEN ON EVERY PAGE, NOT REMEMBERED ──
 *
 * Both predicates above were written to remove false positives, and a check
 * narrowed to remove noise is exactly the check that can go silent. Nothing
 * here re-tested them, so this file was its own only evidence.
 *
 * SEVEN CASES, ONE PER CLAUSE. A deleted clause fails the run rather than
 * quietly widening or narrowing the pass. Proven by mutation: each of the six
 * clauses, broken on its own, flips exactly one case and names it.
 *
 * THE FIXTURES MUST BE ATTACHED AND THEN REMOVED. `checkVisibility` and
 * `getBoundingClientRect` both answer zero on a detached node, so a detached
 * fixture proves nothing. And an instrument left on the page becomes one of
 * the things it measures, so the container goes off-screen and comes straight
 * back out.
 *
 * ONCE PER PAGE, memoised, before the sweep reads anything. Any reflow the
 * fixtures cause is undone before the first measurement. */
let _ghostProof = null
function proveGhosts () {
  if (_ghostProof) return _ghostProof
  const box = document.createElement('div')
  /* Off-screen and still RENDERED, or every case reads as a ghost. */
  box.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px'
  box.innerHTML = [
    /* 1. A real ghost. A box, nothing rendered, and no story in its own CSS. */
    '<p id="g1" style="visibility:hidden;width:160px;height:32px">ghost</p>',
    /* 2. A closed disclosure. Its contents are laid out and hidden ON PURPOSE. */
    '<details id="d2"><summary>menu</summary><ul><li id="g2"><a href="#" style="width:120px;height:24px;display:block">link</a></li></ul></details>',
    /* 3. An OPEN disclosure still reports a genuinely hidden child. Written as
          "inside any details" the folded clause would silence this too. */
    '<details id="d3" open><summary>menu</summary><ul><li><a id="g3" href="#" style="visibility:hidden;width:120px;height:24px;display:block">link</a></li></ul></details>',
    /* 4. A tick on an UNCHECKED box. Hidden on purpose, and small. */
    '<label id="l4"><input type="checkbox"><svg id="g4" width="10" height="10" style="visibility:hidden"></svg>off</label>',
    /* 5. THE NARROWING THE RULE NAMES. The box IS checked and its tick is
          hidden, which is a real fault and must report. */
    '<label id="l5"><input type="checkbox" checked><svg id="g5" width="10" height="10" style="visibility:hidden"></svg>on</label>',
    /* 6. A summary inside a closed disclosure is rendered, so a genuinely
          hidden one is a fault. The folded clause excludes it by name. */
    '<details id="d6"><summary id="g6" style="visibility:hidden;width:80px;height:20px">menu</summary><p>body</p></details>',
    /* 7. A WIDE hidden box inside an unchecked label is not a tick, so it
          reports. Without the width guard the unchosen clause would silence a
          whole hidden row for sitting near a checkbox. */
    '<label id="l7"><input type="checkbox"><p id="g7" style="visibility:hidden;width:200px;height:24px">a whole row</p></label>',
    /* 8. A CARD SKIPPED OFF SCREEN. Its child has a box and renders nothing,
          by declaration, and that is not a fault. The fixture container is
          already off screen, so the ancestor qualifies. */
    '<div id="c8" style="content-visibility:auto;contain-intrinsic-size:auto 100px"><p id="g8" style="width:200px;height:24px">skipped</p></div>',
    /* 9. THE NARROWING. The same property on a card that IS on screen still
          reports a genuinely hidden child, or the clause would silence the
          whole list rather than the part nobody is looking at. */
    '<div id="c9" style="content-visibility:auto;contain-intrinsic-size:auto 100px;position:fixed;left:0;top:0"><p id="g9" style="visibility:hidden;width:200px;height:24px">on screen</p></div>',
  ].join('')
  document.body.appendChild(box)
  const ask = id => {
    const el = box.querySelector('#' + id)
    if (!el) return { missing: true }
    return ghostState(el, paintOf(el))
  }
  const cases = [
    ['a real ghost reports', 'g1', true],
    ['a closed disclosure is quiet', 'g2', false],
    ['an OPEN disclosure still reports a hidden child', 'g3', true],
    ['a tick on an unchecked box is quiet', 'g4', false],
    ['a tick hidden while the box IS checked reports', 'g5', true],
    ['a hidden summary reports, closed or not', 'g6', true],
    ['a wide hidden box beside a checkbox is not a tick', 'g7', true],
    ['a card skipped off screen is quiet', 'g8', false],
    ['a hidden child of an ON SCREEN skippable card reports', 'g9', true],
  ]
  const rows = cases.map(([label, id, want]) => {
    const s = ask(id)
    return { label, want, got: s.missing ? 'FIXTURE MISSING' : s.report, pass: s.report === want }
  })
  box.remove()
  const bad = rows.filter(r => !r.pass)
  _ghostProof = { pass: bad.length === 0, cases: rows.length, failed: bad }
  return _ghostProof
}

/* ── Intra-element: is this one thing right in itself? ──────────────────── */

function probe (sel) {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel
  if (!el) return { error: 'not found: ' + sel }
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()

  /* Paint before anything else. Measuring the alignment of something nobody
     can see is a waste, and reporting it as fine is worse. */
  /* ONE SCORER, EVERY CALLER. This asked `p.ghost` directly while the sweep
     asked `ghostState`, so a clause added to the scorer reached one of them.
     Measured when the row-skipping clause landed: the sweep went quiet and
     this reported 415 findings on the same page. */
  const p = paintOf(el)
  if (ghostState(el, p).report) return { el: _name(el, 34),
    paint: p, clean: false,
    findings: ['GHOST: this has a box of ' + p.rect.w + ' by ' + p.rect.h +
               ' and the engine renders none of it. Fix that before measuring anything else.'] }
  const pad = n => parseFloat(cs['padding' + n]) || 0
  const bor = n => parseFloat(cs['border' + n + 'Width']) || 0

  const out = { el: _name(el, 34),
                box: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
                findings: [] }

  /* Padding symmetry. Asymmetry is a decision, so it has to be a deliberate
     one — this only reports it, it does not judge.
   *
   * Vertical asymmetry is the exception, and the reason is not tolerance. A
   * line box is not symmetric about the cap-to-baseline band, so symmetric
   * padding puts the letters off centre — the correction for that IS unequal
   * padding, and this file's own header rows now carry 17 over 15 for exactly
   * that reason. Flagging it reports the fix and calls it the fault.
   *
   * So the vertical verdict is deferred until the text has been measured a few
   * lines below, and then judged on the RESULT: unequal padding with centred
   * text is a correction that worked, unequal padding with off-centre text is
   * a defect. The means is never the question. The end is. */
  out.padding = { top: pad('Top'), right: pad('Right'), bottom: pad('Bottom'), left: pad('Left') }
  /* Horizontally, a control with text on one side and an icon on the other
     SHOULD be unequal. An arrow or a mark reads lighter than letters, so the
     side it sits on wants less room, and equal padding there is the defect.
     Only a control with the same kind of content on both edges owes symmetry. */
  const mixedEdges = !!el.querySelector('svg') && !!(el.textContent || '').trim()
  /* A control with a mark and NO text owes nothing to symmetry either. Its
     padding is not framing letters, it is placing the mark — a tab-strip
     chevron parks its arrow at the outer edge of a 40px hit area and says so
     in its padding, which this then read as a fault twice per strip. Read the
     intent before calling it a defect. */
  const markOnly = !!el.querySelector('svg') && !(el.textContent || '').trim()
  if (!mixedEdges && !markOnly && pad('Left') !== pad('Right')) out.findings.push(
    'horizontal padding differs: ' + pad('Left') + ' vs ' + pad('Right'))
  const padAsymmetry = Math.abs(pad('Top') - pad('Bottom'))

  /* Text inside its own box, metrically and optically.
     Metrical centring puts the line box in the middle. Optical centring puts
     the letters in the middle, which is 1-2px higher, because the line box
     reserves descender space that most words never use. */
  const tm = typeMetrics(el)
  if (tm) {
    const inner = { top: r.top + bor('Top') + pad('Top'), bottom: r.bottom - bor('Bottom') - pad('Bottom') }
    const boxMid = (inner.top + inner.bottom) / 2
    out.text = tm
    /* Report the two gaps, not the offset from centre.
     *
     * An offset of 1 is a gap difference of 2, because moving the text toward
     * one edge takes it away from the other. The person looking at the screen
     * measures the gaps — 10 above, 8 below — and correctly calls that a 2px
     * problem, while a tool reporting "1px off centre" sounds like half a
     * problem and reads as a disagreement. It was never a disagreement. Give
     * the number they can check with a ruler.
     *
     * Ink, not boxes: cap-top to the top edge, baseline to the bottom edge.
     * That is the black the eye actually weighs. */
    const above = tm.capTop - r.top
    const below = r.bottom - tm.baseline
    out.textCentring = {
      spaceAboveCap: +above.toFixed(2),
      spaceBelowBaseline: +below.toFixed(2),
      gapDifference: +(above - below).toFixed(2),
      offsetFromCentre: +(tm.opticalMid - boxMid).toFixed(2),
      /* 1.5, not 1. Three buttons with byte-identical computed styles measured
         -1.01, -1.00 and -0.99, and a threshold of exactly 1 called the first
         a defect and the other two fine. A verdict that flips on floating-point
         noise between identical elements is worse than no verdict.
         1.5 in gap difference is 0.75px of actual offset. Below that nothing is
         visible in a screenshot, and the 2px the naked eye catches still fires. */
      reads: Math.abs(above - below) <= 1.5 ? 'centred'
           : above > below ? 'sits LOW' : 'sits HIGH',
    }
    if (Math.abs(above - below) > 1.5) out.findings.push(
      'text ' + out.textCentring.reads + ': ' + above.toFixed(1) + 'px above the cap, ' +
      below.toFixed(1) + 'px below the baseline, a ' + Math.abs(above - below).toFixed(1) + 'px difference')
    /* The deferred vertical-padding verdict, now that the result is known.
       Unequal padding that lands the text centred is the correction doing its
       job. Unequal padding that leaves it off centre is reported by the line
       above already, and naming the padding as well only tells them twice. */
    if (padAsymmetry > 0 && Math.abs(above - below) > 1.5) out.findings.push(
      'vertical padding differs: ' + pad('Top') + ' vs ' + pad('Bottom') +
      ', and the text is off centre with it')
  } else if (padAsymmetry > 1) {
    /* No text to judge the padding by, so fall back to reporting the asymmetry
       itself. Above one pixel, because one is the size of an optical nudge. */
    out.findings.push('vertical padding differs: ' + pad('Top') + ' vs ' + pad('Bottom'))
  }

  /* An icon inside a control, judged against the right reference.
   *
   * There are two cases and they take different measurements. Read them as one
   * and the tool lies: it reported six header buttons 40 to 65px "off centre"
   * when every one of them was correct. A leading icon is SUPPOSED to sit left
   * of the box centre. The box centre was never its reference.
   *
   *   icon-only  → the box centre, both axes. Nothing else is in there.
   *   icon+label → the LABEL's optical mid, vertical only. An icon beside text
   *                aligns to the text, and horizontal position is the gap's
   *                job, not the centre's.
   *
   * Geometric centring of an asymmetric glyph is still not optical centring,
   * but a square button should be geometrically centred before anyone argues
   * about the rest. */
  const svg = el.querySelector('svg')
  if (svg) {
    const s = svg.getBoundingClientRect()
    const mid = (s.top + s.bottom) / 2
    const label = typeMetrics(el)
    /* BESIDE, NOT MERELY INSIDE. The reference for a mark is its label only
       when the two share a row, and sharing a row means the painted boxes
       overlap vertically. A COLUMN stacks them, and `align-items: center`
       says nothing about direction: it centres on the cross axis, which a
       column reads as horizontal.

       Measured on a loading screen: a 48px mark above a bar above a line of
       text reported the mark 71px above "the optical mid" of a sentence it
       was never beside. Correct code, and the finding buried the sweep. */
    const beside = label && s.bottom > label.inkTop && s.top < label.inkBottom
    if (label && !beside) {
      out.icon = { dy: null, w: +s.width.toFixed(1), ref: 'stacked, not beside its text' }
    } else if (label) {
      const dy = mid - label.opticalMid
      out.icon = { dy: +dy.toFixed(2), w: +s.width.toFixed(1), ref: 'label optical mid' }
      if (Math.abs(dy) > 0.75) out.findings.push(
        'icon sits ' + Math.abs(dy).toFixed(1) + 'px ' + (dy > 0 ? 'below' : 'above') +
        ' the optical mid of "' + label.text + '"')
    } else {
      const dx = ((s.left + s.right) / 2) - ((r.left + r.right) / 2)
      const dy = mid - ((r.top + r.bottom) / 2)
      /* Read the author's intent before calling it a defect. A tab-strip
         chevron is a 40px hit area with a 12px mark parked at the outer edge,
         on purpose, so tabs slide under it. Its CSS says so twice — a
         `justify-content` that is not centre, and padding that is not
         symmetric. Flagging that is the same class of mistake as flagging a
         leading icon: measuring against a reference the author never chose. */
      const jc = cs.justifyContent
      const padL = parseFloat(cs.paddingLeft) || 0
      const padR = parseFloat(cs.paddingRight) || 0
      const declared = (jc && jc !== 'center' && jc !== 'normal' && jc !== 'space-around' &&
                        jc !== 'space-evenly') || Math.abs(padL - padR) > 0.5
      out.icon = { dx: +dx.toFixed(2), dy: +dy.toFixed(2), w: +s.width.toFixed(1),
                   ref: 'box centre', horizontalIntent: declared ? 'declared off-centre' : 'centre' }
      if (Math.abs(dy) > 0.75 || (!declared && Math.abs(dx) > 0.75)) out.findings.push(
        'icon off centre by ' + dx.toFixed(1) + ',' + dy.toFixed(1))
      if (declared) out.icon.dx = undefined
    }
  }

  out.clean = out.findings.length === 0
  return out
}

/* ── Two elements against each other ─────────────────────────────────────── */

function align (a, b) {
  const A = typeof a === 'string' ? document.querySelector(a) : a
  const B = typeof b === 'string' ? document.querySelector(b) : b
  if (!A || !B) return { error: 'not found' }
  const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect()
  const ta = typeMetrics(A), tb = typeMetrics(B)
  const out = {
    heights: [Math.round(ra.height), Math.round(rb.height)],
    tops: [+ra.top.toFixed(1), +rb.top.toFixed(1)],
    lefts: [+ra.left.toFixed(1), +rb.left.toFixed(1)],
    findings: [],
  }
  if (Math.round(ra.height) !== Math.round(rb.height)) out.findings.push(
    'heights differ: ' + Math.round(ra.height) + ' vs ' + Math.round(rb.height))
  if (Math.abs(ra.top - rb.top) > 0.75) out.findings.push(
    'tops differ by ' + (ra.top - rb.top).toFixed(2))
  if (ta && tb) {
    out.baselines = [ta.baseline, tb.baseline]
    const d = Math.abs(ta.baseline - tb.baseline)
    out.baselineGap = +d.toFixed(2)
    /* Two boxes of equal height, each centring its own label, land within
       0.3635 * the font-size difference. Anything past that is a real fault
       rather than the cost of mixing sizes. */
    const allowed = 0.3635 * Math.abs(ta.fontSize - tb.fontSize) + 0.5
    if (d > allowed) out.findings.push(
      'baselines ' + d.toFixed(2) + 'px apart, more than the ' + allowed.toFixed(2) + ' two sizes explain')
  }
  out.clean = out.findings.length === 0
  return out
}

/* ── Inter-element: sweep the whole page ─────────────────────────────────── */

/* ── Motion ──────────────────────────────────────────────────────────────
 *
 * A hover that changes colour instantly, in a system that publishes a duration
 * scale, has demonstrated nothing. This finds them by reading the stylesheet
 * rather than the element: for every `:hover` rule, check that the properties
 * it changes are named in the base rule's `transition`.
 *
 * Reading the CSSOM rather than hovering, because a synthetic hover does not
 * fire `:hover` and a pane that is not compositing reports the end state
 * anyway. The rules are the truth here.
 */
function motion (within = null) {
  const scope = within || ''
  const problems = []
  const transitioned = new Map()   // selector -> Set of properties

  const walk = list => { for (const r of list) {
    if (r.cssRules) { walk(r.cssRules); continue }
    if (!r.selectorText || !r.style) continue
    const t = r.style.transitionProperty
    if (t && t !== 'none') {
      for (const sel of r.selectorText.split(',')) {
        const key = sel.trim()
        if (!transitioned.has(key)) transitioned.set(key, new Set())
        for (const p of t.split(',')) transitioned.get(key).add(p.trim())
      }
    }
  } }
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules } catch { continue }
    walk(rules)
  }

  const hoverWalk = list => { for (const r of list) {
    if (r.cssRules) { hoverWalk(r.cssRules); continue }
    if (!r.selectorText || !/:hover|\.is-hover|:focus-visible/.test(r.selectorText)) continue
    if (scope && !r.selectorText.includes(scope)) continue
    /* What the hover changes. */
    const changed = [...r.style].filter(p =>
      /^(background|color|border|box-shadow|opacity|outline|transform|filter)/.test(p))
    if (!changed.length) continue
    /* The base selector is the hover selector with the state stripped. */
    const base = r.selectorText.split(',')[0].trim()
      .replace(/:hover|\.is-hover|:focus-visible/g, '').trim()
    const declared = transitioned.get(base) || new Set()
    const covered = p => declared.has('all') ||
      [...declared].some(d => p === d || p.startsWith(d) || d.startsWith(p.split('-')[0]))
    const missing = changed.filter(p => !covered(p))
    if (missing.length) problems.push({ selector: r.selectorText.slice(0, 46), base, missing })
  } }
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules } catch { continue }
    hoverWalk(rules)
  }

  /* Declared is not the same as perceptible. A 125ms colour fade is present,
     running, and over before the eye resolves it — the check passes and the
     interface still feels dead. Colour wants 200-250ms. Movement wants less,
     because slowing a panel that slides makes it feel sticky. */
  const tooQuick = []
  const durWalk = list => { for (const r of list) {
    if (r.cssRules) { durWalk(r.cssRules); continue }
    if (!r.selectorText || !r.style) continue
    if (scope && !r.selectorText.includes(scope)) continue
    const props = (r.style.transitionProperty || '').split(',').map(s => s.trim()).filter(Boolean)
    const durs = (r.style.transitionDuration || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!props.length || !durs.length) continue
    props.forEach((p, i) => {
      if (!/^(background|color|border-color|box-shadow|opacity|filter)/.test(p)) return
      const raw = durs[i % durs.length]
      /* Resolve the token against the root so a var() is not skipped. */
      const v = raw.startsWith('var(')
        ? getComputedStyle(document.documentElement).getPropertyValue(raw.slice(4, raw.indexOf(','))).trim() || raw
        : raw
      const ms = v.endsWith('ms') ? parseFloat(v) : v.endsWith('s') ? parseFloat(v) * 1000 : NaN
      if (!isNaN(ms) && ms > 0 && ms < 180)
        tooQuick.push({ selector: r.selectorText.slice(0, 42), property: p, ms })
    })
  } }
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules } catch { continue }
    durWalk(rules)
  }

  return {
    clean: problems.length === 0 && tooQuick.length === 0,
    snappingCount: problems.length,
    snapping: problems.slice(0, 8),
    tooQuickCount: tooQuick.length,
    tooQuick: tooQuick.slice(0, 8),
  }
}

/* Wait for the page to stop moving before measuring it.
 *
 * A surface swap crossfades: the old screen fades out on top of the new one
 * fading in. Sweep during that and thirteen elements report as covered, because
 * for those 300ms they genuinely are. Every one of those findings evaporates a
 * moment later, and chasing them is chasing nothing.
 *
 * Await every running animation, with a ceiling — an infinite spinner would
 * otherwise hang the measurement forever. A short wait afterwards, so layout
 * has settled before the first rect is read.
 *
 *   await settle(); const s = sweep('.dmd-frame')
 *
 * ── NEVER WAIT ON AN ANIMATION FRAME HERE ──
 *
 * This ended with `requestAnimationFrame(() => requestAnimationFrame(r))`, and
 * the `maxMs` race covered only the animations before it. A background tab runs
 * NO animation frames, so that promise never resolves and the whole sweep
 * hangs. It is indistinguishable from a crash.
 *
 * The rule about it was written down and this file broke it, which is what a
 * check is for. Found on 9 September 2026 by asserting the rule over the tool
 * rather than reading the tool. Two frames at 60Hz is about 32ms, so a timer
 * waits the same and still fires in the background.
 *
 * AND DROP THE LOOPING ANIMATIONS RATHER THAN RACING THEM. An infinite
 * animation's `finished` never settles, so one spinner puts the whole wait on
 * the ceiling every time. The ceiling then stops being a failsafe and becomes
 * the normal cost. */
/* ── AND A TIMER IS NOT ENOUGH EITHER, BECAUSE THE CLOCK ITSELF CAN STOP ──
 *
 * The rule above is about the WAIT. This is about the thing being waited for.
 * A hidden or frozen tab stops the document timeline, so no animation ever
 * reaches its end and every `finished` promise is unreachable. The ceiling
 * then fires on every single call, which is the case it says it is a failsafe
 * for.
 *
 * Measured on 10 September 2026: the clock advanced 0ms across 976ms of wall
 * clock, while 156 transitions all reported a running state and a currentTime
 * of 0. A 100ms interval fired 6 times in 25 seconds.
 *
 * THE WORST PART IS THAT A FROZEN PAGE IS MAXIMALLY AT REST. A rect-stability
 * check takes two samples, finds them identical, and reports rested on the
 * first comparison. So the strongest false pass available comes from the one
 * condition that invalidates every animation reading.
 *
 * ASK THE CLOCK, NEVER THE VISIBILITY FLAG. `visibilityState` read hidden
 * while the host reported the pane displayed, so the two disagree. A page that
 * is visible and merely throttled fails in the same way.
 *
 * Return false rather than throwing. Geometry is still true in a hidden tab,
 * so a caller measuring rectangles is entitled to carry on knowing this. */
async function clockRuns () {
  const at = () => (document.timeline && document.timeline.currentTime) || 0
  const t0 = at()
  await new Promise(r => setTimeout(r, 150))
  return at() > t0
}

async function settle (maxMs = 1500) {
  if (!(await clockRuns())) {
    console.error('settle: the document runs no animation frames, so its clock is stopped.'
      + ' Nothing can settle, and a cross-fade can leave two surfaces mounted, which measures the'
      + ' one LEAVING. Geometry is still valid. Bring the tab to the foreground and run again.')
    return false
  }
  const anims = typeof document.getAnimations === 'function'
    ? document.getAnimations().filter(a => {
      if (a.playState !== 'running' || !a.effect) return false
      const it = a.effect.getComputedTiming().iterations
      return (it || 1) !== Infinity
    })
    : []
  const done = Promise.all(anims.map(a => a.finished.catch(() => {})))
  const cap = new Promise(r => setTimeout(r, maxMs))
  await Promise.race([done, cap])
  await new Promise(r => setTimeout(r, 32))
  return true
}

function sweep (within = null, exclude = null) {
  /* An element, or a selector. Accepting an element is not a convenience.
   *
   * `sweep('.dmd')` took the FIRST match, and this app has four `.dmd` nodes —
   * the hosted preview plus three component samples. The first is not the
   * preview. Every "all clean" run through that selector had measured a
   * different surface from the one on screen, and reported it as a pass.
   *
   * So a caller that already holds the right element passes the element, and a
   * caller that passes an ambiguous selector is told so in the result rather
   * than being allowed to trust it. */
  let root, ambiguous = null
  if (within && typeof within !== 'string') root = within
  else if (within) {
    const hits = document.querySelectorAll(within)
    root = hits[0]
    if (hits.length > 1) ambiguous = within + ' matched ' + hits.length + ' elements; measured the first'
  } else root = document.body
  if (!root) return { error: 'no root for ' + within }
  const skip = el => exclude && el.closest(exclude)
  /* Having a box is not the same as being on screen, and every row check below
     compares things the eye can weigh against each other. A file input at
     opacity 0 kept a 18px box in a row of 36px buttons and got reported as a
     broken fence for as long as this only asked about the box. Nobody can see
     it. It is not in the row. */
  const seen = el => {
    const r = el.getBoundingClientRect()
    if (!(r.width > 0 && r.height > 0)) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.opacity === '0') return false
    for (let n = el.parentElement; n; n = n.parentElement)
      if (getComputedStyle(n).opacity === '0') return false
    return true
  }
  const all = [...root.querySelectorAll('*')].filter(el => !skip(el) && seen(el))
  const isRow = el => {
    const cs = getComputedStyle(el)
    return cs.display === 'flex' && !cs.flexDirection.startsWith('column') && el.children.length >= 2
  }
  const name = el => _name(el, 30)

  /* ── Did this element DECLARE an auto margin? ──
     `getComputedStyle` cannot answer. It reports the USED value, so a flex
     child holding `margin-left: auto` reads back as `0px` once the browser has
     resolved the slack into it. Measured, and it is why a rectangle-based
     check could never tell slack from a gap.

     So read the declaration in the two places it can live: the inline style,
     and any stylesheet rule that matches. A cross-origin sheet throws on
     `.cssRules`, so each one is guarded and skipped.

     Resolve it to a SET of elements once, never per comparison. The first
     version asked `el.matches(sel)` for every selector, for every adjacent
     pair, in every row — and the full eleven-surface run stopped finishing
     inside thirty seconds. A check that makes the tool unusable costs more
     than the false positive it removes. One `querySelectorAll` over the joined
     selector list gives the same answer as a lookup. */
  const _autoSets = new Map()
  const autoSet = (prop) => {
    let set = _autoSets.get(prop)
    if (set) return set
    const sels = []
    for (const sheet of document.styleSheets) {
      let list
      try { list = sheet.cssRules } catch { continue }
      if (!list) continue
      for (const rule of list) {
        if (!rule.style || !rule.selectorText) continue
        const v = rule.style.getPropertyValue(prop) || rule.style.getPropertyValue('margin')
        if (/\bauto\b/.test(v)) sels.push(rule.selectorText)
      }
    }
    set = new Set()
    if (sels.length) {
      /* One bad selector must not lose the rest, so fall back per selector. */
      try { document.querySelectorAll(sels.join(',')).forEach(e => set.add(e)) }
      catch {
        for (const s of sels) {
          try { document.querySelectorAll(s).forEach(e => set.add(e)) } catch { /* skip */ }
        }
      }
    }
    _autoSets.set(prop, set)
    return set
  }
  const declaresAuto = (el, prop) => {
    const inline = el.style.getPropertyValue(prop) || el.style.getPropertyValue('margin')
    if (/\bauto\b/.test(inline)) return true
    return autoSet(prop).has(el)
  }
  /* ── A DECLARATION SET IS NOT A CASCADE, AND THE DIFFERENCE FAULTED CORRECT
         CODE ──
   *
   * The set above answers "does any matching rule say auto". That is a
   * different question from "is an auto margin in force", and the gap between
   * them is silent. A responsive block setting `margin-left: 0` on the same
   * element still left it in the set, so the check that reads this reported an
   * auto margin two hundred lines after it had been overridden, and printed a
   * reason that named a margin nothing was using.
   *
   * Resolve it properly: among the rules that declare this property AND match
   * this element, the winner is the one with the highest specificity, and the
   * last of those in document order. That is the cascade for one origin with
   * no `!important` and no layers, which is what a stylesheet in this app is.
   *
   * `!important` still wins outright, so it is ranked above everything.
   *
   * SPECIFICITY IS COUNTED ON THE MATCHING COMPOUND, never on the whole list.
   * A rule written `.a, .b .c { }` has two selectors with different weights,
   * and the one that matched is the one that counts. */
  const _spec = (sel) => {
    /* Blank what the functional pseudo-classes hold, then add the weight of
       their argument back. `:not`, `:is` and `:has` take the weight of their
       most specific argument; `:where` takes none. */
    let a = 0, b = 0, c = 0
    let s = sel
    for (const fn of ['not', 'is', 'has', 'where']) {
      const re = new RegExp(':' + fn + '\\(', 'g')
      let m
      while ((m = re.exec(s))) {
        let depth = 1, i = m.index + m[0].length
        const from = i
        while (i < s.length && depth) { if (s[i] === '(') depth++; else if (s[i] === ')') depth--; i++ }
        const inner = s.slice(from, i - 1)
        if (fn !== 'where') {
          const w = inner.split(',').map(_spec).sort((x, y) =>
            (y.a - x.a) || (y.b - x.b) || (y.c - x.c))[0]
          if (w) { a += w.a; b += w.b; c += w.c }
        }
        s = s.slice(0, m.index) + ' '.repeat(i - m.index) + s.slice(i)
        re.lastIndex = m.index + 1
      }
    }
    a += (s.match(/#[\w-]+/g) || []).length
    b += (s.match(/\.[\w-]+/g) || []).length
      + (s.match(/\[[^\]]*\]/g) || []).length
      + (s.match(/:[\w-]+/g) || []).filter(x => !/^::/.test(x)).length
    c += (s.replace(/[.#[][^\s>+~,]*/g, ' ').match(/\b[a-zA-Z][\w-]*\b/g) || []).length
    return { a, b, c }
  }

  /* Cached per property, because resolving it walks every sheet. */
  const _winners = new Map()
  const _winnerRules = (prop) => {
    let rules = _winners.get(prop)
    if (rules) return rules
    rules = []
    let order = 0
    for (const sheet of document.styleSheets) {
      let list
      try { list = sheet.cssRules } catch { continue }
      if (!list) continue
      const walk = (items) => {
        for (const rule of items) {
          if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules); continue }
          if (!rule.style || !rule.selectorText) continue
          const v = rule.style.getPropertyValue(prop) || rule.style.getPropertyValue('margin')
          if (!v) continue
          const bang = rule.style.getPropertyPriority(prop) === 'important'
            || rule.style.getPropertyPriority('margin') === 'important'
          for (const one of rule.selectorText.split(',')) {
            rules.push({ sel: one.trim(), auto: /\bauto\b/.test(v), bang, order: order++ })
          }
        }
      }
      walk(list)
    }
    /* Pre-resolve each selector to its element set, once. Asking `matches` per
       element per selector took an eleven-surface run past thirty seconds. */
    for (const r of rules) {
      r.set = new Set()
      try { document.querySelectorAll(r.sel).forEach(e => r.set.add(e)) } catch { /* skip */ }
      const w = _spec(r.sel)
      r.w = w
    }
    _winners.set(prop, rules)
    return rules
  }

  /* IS AN AUTO MARGIN IN FORCE. Inline beats every stylesheet rule that is not
     `!important`, so it is asked first and answered outright. */
  const autoInForce = (el, prop) => {
    const inline = el.style.getPropertyValue(prop) || el.style.getPropertyValue('margin')
    if (inline) return /\bauto\b/.test(inline)
    let best = null
    for (const r of _winnerRules(prop)) {
      if (!r.set.has(el)) continue
      if (!best) { best = r; continue }
      const better = (r.bang !== best.bang) ? r.bang
        : (r.w.a !== best.w.a) ? r.w.a > best.w.a
        : (r.w.b !== best.w.b) ? r.w.b > best.w.b
        : (r.w.c !== best.w.c) ? r.w.c > best.w.c
        : r.order > best.order
      if (better) best = r
    }
    return !!best && best.auto
  }


  /* A CONTROL IS ONE OBJECT, NOT A GROUP OF ITEMS. Hoisted, because two checks
     ask it now and a second copy drifts. Ask INTERACTIVITY first, which is a
     property, then fall back to the control classes for the inert samples a
     preview renders as spans. */
  const isControlEl = c =>
    c.matches('button, input, select, textarea, a[href], summary, [role="button"],'
      + ' [role="checkbox"], [role="radio"], [role="tab"], [role="switch"], [tabindex]')
    || c.matches('.btn, .badge, .chip, .seg, .seg-on, .nav-item, .tab, .avatar, .swatch')

  /* THE GHOST PREDICATES ARE PROVEN BEFORE ANYTHING IS MEASURED. Both were
     written to remove false positives, so both can go silent. The fixtures
     attach off-screen and come back out before the first read. */
  const ghostProof = proveGhosts()

  const out = { baselines: [], heights: [], tops: [], edges: [], gaps: [], overflow: [], contentSpill: [], scrollers: [], smallTargets: [], textOffCentre: [], iconOffCentre: [], other: [], ghosts: [], covered: [] }

  /* Paint first, because a layout fault in something nobody can see is not the
     problem you have. Only content worth seeing: text, controls, images.
   *
   * ── THE GHOST PASS NEEDS ITS OWN LIST ──
   *
   * This looped over `all`, and `all` is filtered by `seen()`, which throws
   * out anything at `visibility: hidden` or `opacity: 0`. Those are the two
   * commonest ghosts, so the one check whose job is to find invisible things
   * could never see them. Proven by injection: a `<p>` with a 160x32 box at
   * `visibility: hidden` returned `paintOf().ghost === true` and the sweep
   * reported zero.
   *
   * So the report was structurally capable of only false positives. Every
   * ghost it ever printed came from a cause `seen()` does not screen, and the
   * one that kept arriving was a folded menu, which is correct code.
   *
   * `seen()` is right for the ROW checks: a hidden file input must not join a
   * height comparison. It is wrong here. Two lists, one per question. */
  const PAINT_SEL = 'button, a, input, select, textarea, img, svg, .btn, .nav-item, .badge, .card, li, td, th, h1, h2, h3, h4, h5, h6, p, label, summary'
  for (const el of [...root.querySelectorAll(PAINT_SEL)].filter(el => !skip(el))) {
    const p = paintOf(el)
    const { folded, unchosen, skipped } = ghostState(el, p)
    if (p.ghost && !folded && !unchosen && !skipped) out.ghosts.push({
      el: name(el), text: (el.textContent || '').trim().slice(0, 20),
      rect: p.rect, why: 'has a box but the engine renders nothing',
    })
    /* "Something is on top of this" is only a question about a thing that
       paints. An element the engine renders nothing for is a ghost, and
       reporting it as buried as well would name one fault twice. */
    else if (p.covered && seen(el)) out.covered.push({
      el: name(el), text: (el.textContent || '').trim().slice(0, 20), rect: p.rect,
    })
  }

  for (const el of all) {
    /* ── TWO STACKED SIBLINGS TOUCHING, WITH NOTHING BETWEEN THEM ──
     *
     * The rule has been written down twice and never checked. A section label
     * sat 0.00px above the list it names on a generated rail, and they found
     * it in a screenshot while every alignment check was green. It then
     * happened again: three containers on one dashboard, six gaps at 0.00,
     * caught by eye and not by this file.
     *
     * A BARE BLOCK OWNS NO GAP. A flex or grid parent with a `row-gap` spaces
     * its whole group; `display: block` spaces nothing, so the distance has to
     * come from a margin somebody remembered.
     *
     * The question is whether anything SEPARATES the two, not whether they
     * touch. Three things legitimately separate siblings at zero distance, and
     * each is a declaration rather than a guess:
     *
     *   a border on either facing edge      a ruled list, a table
     *   a fill that differs from the parent  a striped row, a filled panel
     *   a padding either one carries        a box whose own inset spaces it
     *
     * A MARGIN NEEDS NO EXCLUSION. A distance somebody chose is a distance
     * greater than zero, so a stated margin cannot produce a 0px gap. Asking
     * whether the zero was DECLARED needs the rule set, and the case it would
     * cover — the byline rule — states margins on the children and therefore
     * never reaches zero anyway.
     *
     * Table internals are excluded outright: rows and cells touch by
     * construction and their separation is the table's own business. */
    const stack = [...el.children].filter(seen)
    const cs0 = getComputedStyle(el)
    const rowGap = parseFloat(cs0.rowGap) || 0
    const isTablePart = e => /^(TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|CAPTION|COLGROUP|COL)$/.test(e.tagName)
    if (stack.length >= 2 && rowGap < 0.5 && !isTablePart(el)) {
      const fill = e => {
        const b = getComputedStyle(e).backgroundColor
        return b && b !== 'rgba(0, 0, 0, 0)' ? b : null
      }
      const parentFill = fill(el)
      for (let i = 1; i < stack.length; i++) {
        const a = stack[i - 1], b = stack[i]
        if (isTablePart(a) || isTablePart(b)) continue
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
        /* Stacked, not side by side: b starts below a, and they share a column. */
        if (rb.top < ra.bottom - 0.5) continue
        if (rb.left > ra.right - 0.5 || ra.left > rb.right - 0.5) continue
        const d = rb.top - ra.bottom
        if (d > 0.5) continue
        const sa = getComputedStyle(a), sb = getComputedStyle(b)
        if (sa.position === 'absolute' || sb.position === 'absolute') continue
        /* A ROW DELEGATES ITS PAINT TO ITS CELLS, so asking the row alone
         * calls a correct comparison table a fault.
         *
         * Measured: a plan comparison of six `.plan-row` children in a grid
         * reported four findings at 0.00px. Every row is separated, and the
         * separator is a 1px background-image on each CELL — which is the
         * prescribed mechanism, because a border spans the whole cell
         * including the marked column's accent edge and chips it once per
         * row. The row itself carries no border, no fill and no padding, so
         * all three exemptions missed and the check faulted the fix.
         *
         * So ask whether anything paints the facing edge, one level down. A
         * border on a cell, or a background-image on it, is a rule between
         * the two rows. `background-image` covers the gradient-hairline
         * technique, which nothing else here can see. */
        /* LOOK DOWN ONLY INTO A ROW OF CELLS, never into a stack.
         *
         * Reading every element's children would trade this miss for a worse
         * one: a card's first child is often a wrapper holding a padded
         * control, and the padding exemption would then approve the very
         * shape this check exists to find. The original fault — six pairs
         * touching at 0.00px inside a card — has to keep reporting.
         *
         * A ruled row's children sit SIDE BY SIDE, which is what makes them
         * cells. A card's children are stacked. Ask the geometry of the first
         * two rather than the display value, so a grid, a flex row and a
         * table-like div all answer the same way. */
        const cellsOf = el => {
          const k = [...el.children]
          if (k.length < 2) return []
          const r0 = k[0].getBoundingClientRect(), r1 = k[1].getBoundingClientRect()
          if (!r0.width || !r1.width) return []
          return r1.left >= r0.right - 0.5 ? k : []
        }
        /* AND A SINGLE-CHILD WRAPPER CHAIN DELEGATES THE SAME WAY, WHICH IS
         * NOT A STACK.
         *
         * A disclosure animates its height with a 0fr-to-1fr grid row, so the
         * panel is a grid wrapper holding a clipper holding the padded body.
         * The rule belongs to that body. Three levels down, and the check read
         * only the top box and a row of cells.
         *
         * Measured 17 September 2026 in the Components panel: a group header
         * at 53px above an opened panel at 88px, reported as touching at
         * 0.00px with nothing between them. The divider was live at the same
         * y, 783.2px wide, in rgb(33, 38, 42).
         *
         * A chain is safe where a stack is not, because it holds ONE child at
         * each level. There is no second block whose own inset could stand in
         * for the missing distance, which is the fault this check exists for.
         * So descend only while the child is the sole element child AND is
         * flush against the parent's facing edge. Bounded at 4 levels. */
        const chainFrom = (el, side) => {
          const out = [el]
          let cur = el
          for (let i = 0; i < 4; i++) {
            const k = [...cur.children]
            if (k.length !== 1) break
            const kr = k[0].getBoundingClientRect(), cr = cur.getBoundingClientRect()
            const flush = side === 'Top'
              ? Math.abs(kr.top - cr.top) < 0.6
              : Math.abs(kr.bottom - cr.bottom) < 0.6
            if (!flush) break
            cur = k[0]
            out.push(cur)
          }
          return out
        }
        const paints = (el, side) => {
          for (const link of chainFrom(el, side)) {
            if (parseFloat(getComputedStyle(link)['border' + side + 'Width']) > 0) return true
            for (const cell of cellsOf(link)) {
              const cds = getComputedStyle(cell)
              if (parseFloat(cds['border' + side + 'Width']) > 0) return true
              if (cds.backgroundImage && cds.backgroundImage !== 'none') return true
            }
          }
          return false
        }
        /* ── A DIVIDER CAN BE AN ELEMENT, NOT ONLY A BORDER PROPERTY ──
         *
         * A bar growing from a zero line sits ON that line, and the line is a
         * 1px element between the two halves. Both pairs then touch, which is
         * the design: the rule IS the separation and it is the thing they are
         * touching. Six findings on one chart, all of them correct code.
         *
         * Asked as a property. A box with no content height that paints a
         * border or a fill is a rule, whatever it is called. `.divider`,
         * `.chart-zero` and an `<hr>` all answer the same way, and a name
         * list would have found whichever of the three somebody remembered.
         */
        const isRule = el2 => {
          const r = el2.getBoundingClientRect()
          if (r.height > 2.5) return false
          const cs2 = getComputedStyle(el2)
          const paintsEdge = ['BorderTopWidth', 'BorderBottomWidth']
            .some(k => parseFloat(cs2['border' + k.slice(6)]) > 0)
          const fill = cs2.backgroundColor && cs2.backgroundColor !== 'rgba(0, 0, 0, 0)'
          const img = cs2.backgroundImage && cs2.backgroundImage !== 'none'
          return paintsEdge || fill || img
        }
        if (isRule(a) || isRule(b)) continue
        /* A rule between them IS the separation. */
        if (paints(a, 'Bottom') || paints(b, 'Top')) continue
        /* A fill of its own separates a block from its neighbour. */
        if ((fill(a) && fill(a) !== parentFill) || (fill(b) && fill(b) !== parentFill)) continue
        /* A box whose own inset does the spacing is not touching its
           neighbour's content, only its border box. Its CELLS may carry that
           inset instead, for the same reason the divider does. */
        const inset = (el, side) => {
          if (parseFloat(getComputedStyle(el)['padding' + side]) > 0.5) return true
          for (const cell of cellsOf(el))
            if (parseFloat(getComputedStyle(cell)['padding' + side]) > 0.5) return true
          return false
        }
        if (inset(a, 'Bottom') || inset(b, 'Top')) continue
        /* ── A RUN OF PRESSABLE ROWS TOUCHES ON PURPOSE ──
         *
         * A menu item is a full-width target, so a gap between two of them
         * is dead space a reader can click into and the hover fill has to
         * cover the whole row. Measured on one project menu: five buttons,
         * 44px tall, `padding: 0`, `line-height: 44px`, four findings, all
         * of them correct code.
         *
         * ASKING WHETHER THE CONTENT IS CLEAR OF THE EDGE DOES NOT WORK,
         * and it is the obvious fix. It reserves 17px on a menu item and
         * 2.7px on the label fault this check exists for. But a nav ITEM is
         * a 44px control too, so a label flush against one gives 2.7 plus
         * 17, and every threshold on the pair then skips the fault.
         *
         * So ask what the PAIR IS. Both interactive, which is a property
         * rather than a class. The same kind of element. And three or more
         * in the container, because a run is a list: two stacked buttons in
         * a card are an action row and still answer for their gap. */
        const pressable = el2 => {
          if (el2.matches('button, a[href], input, select, textarea, summary')) return true
          const r2 = el2.getAttribute('role')
          if (r2 && /^(button|menuitem|menuitemcheckbox|menuitemradio|option|tab|link)$/.test(r2)) return true
          return el2.hasAttribute('onclick') || el2.tabIndex >= 0
        }
        if (pressable(a) && pressable(b) && a.tagName === b.tagName) {
          const run = [...el.children].filter(k => k.tagName === a.tagName && pressable(k)).length
          if (run >= 3) continue
        }
        /* ── A CAPTION TOUCHING ITS OWN HEADING IS A GROUP ──
         *
         * Zero is the prescribed distance for an overline above a heading
         * and for a caption below one. A gap there splits the label off the
         * title, which is the fault a uniform card gap produces.
         *
         * So this cannot be answered by asking whether a gap is DECLARED:
         * an absent gap and a chosen zero read the same, and declaring
         * `row-gap: 0` changed nothing here. Ask the TYPE HIERARCHY instead.
         *
         * Two conditions, because either alone fires on correct prose. One
         * run is subordinate TYPE, by size or by weight. And the subordinate
         * one is the quieter COLOUR. Two paragraphs at one size and one
         * colour are not a group, and they still report.
         *
         * Measured on a watchlist title cell: a 14px/650 title in --text
         * above a 12px/400 caption in --text-muted, four instances, all
         * correct code. */
        const type = el2 => {
          const cs2 = getComputedStyle(el2)
          return { size: parseFloat(cs2.fontSize) || 0, weight: parseFloat(cs2.fontWeight) || 400, colour: cs2.color }
        }
        const ta = type(a), tb = type(b)
        const subordinate = ta.size !== tb.size || Math.abs(ta.weight - tb.weight) >= 150
        if (subordinate && ta.colour !== tb.colour) continue
        out.gaps.push({
          row: name(el),
          finding: 'two stacked children touch at ' + d.toFixed(2)
            + 'px with nothing between them, and the parent states no row-gap. '
            + name(a) + ' then ' + name(b) + '. A bare block owns no gap.',
        })
      }
    }
    /* ── A CONTROL HOLDS ONE MARK SIZE ──
     *
     * A control is a LEAF, so its marks are ornament rather than siblings in
     * a layout. Two of them at two sizes is one control speaking twice.
     *
     * I sized one chevron wrongly twice, from two neighbours: 10px from a
     * picker in a panel, then 12px from the menus beside it in the same bar.
     * The button own folder mark is 14px, which is the published size.
     *
     * Measured across every surface: 182 controls hold nought or one mark,
     * one holds two, and it reads 14 and 14. The 10px version gives 4.
     *
     * TWO EXEMPTIONS. An avatar is not a mark, because it publishes its own
     * size and its own gap. A specimen row exists to show three sizes.
     */
    if (isControlEl(el) && !el.closest('[data-specimen], .specimen, .sizes')) {
      const marks = [...el.querySelectorAll('svg')]
        .filter(m => !m.closest('.avatar') && seen(m))
      if (marks.length >= 2) {
        const sizes = marks.map(m => {
          const r = m.getBoundingClientRect()
          return Math.max(r.width, r.height)
        })
        /* ROUND ONCE, AT THE END. Subtract in floats. */
        const spread = Math.max(...sizes) - Math.min(...sizes)
        /* WHOLE PIXELS. Half a pixel is invisible, and a lower bar fires on
           sub-pixel rounding. */
        if (spread >= 1) {
          out.other.push({
            row: name(el),
            finding: name(el) + ' holds ' + marks.length + ' marks at '
              + sizes.map(v => v.toFixed(2)).join(', ') + 'px, a spread of '
              + spread.toFixed(2) + 'px. A mark takes its size from its OWN control, never from a neighbour. The published size is one value at every control size, so one control cannot carry two. Read the marks the control already has before adding one.',
          })
        }
      }
    }
    /* Baselines across a row. */
    /* ── AN ACTION STANDS CLEAR OF THE TEXT THAT EXPLAINS IT ──
     *
     * 16px, and it is a step above the card's own rhythm. Under that a
     * button reads as one more line of the paragraph rather than as
     * something you press.
     *
     * This tool had no opinion about it, so it reported a Record surface
     * clean while a button sat 12px under its own sentence. They found it.
     *
     * MEASURE TO THE BUTTON, NEVER TO ITS ROW. The 16px lives inside the
     * action row as padding, so measuring to the row's border box reads 8
     * or 12 on correct code. My first probe did that, called every correct
     * case a fault, and I concluded the rule was uncheckable.
     *
     * FOUR GUARDS, each a case this is not about. Four words, so a
     * one-word label above a field is not an explanation. The text block
     * holds no control, or this is a control row. The button sits below
     * the text. And a TRANSFORMED row is placed by another rule: the
     * actions beside a page heading carry a translate that centres them on
     * its cap band, measured at 12px from the subtitle and correct.
     */
    {
      const CLEAR = 16
      const kids = [...el.children].filter(seen)
      for (let i = 1; i < kids.length; i++) {
        const prev = kids[i - 1], row = kids[i]
        /* AN ACTION, NOT ANY CONTROL. A checkbox after a paragraph is a
           form field and a nav item is a destination. Both reported here
           before this line, and the rule is about neither. */
        const isAct = e => e.matches('button, a[href], [role="button"], .btn')
          && !e.matches('.nav-item, .tab, [role="tab"], input, select, textarea')
        const btn = isAct(row) ? row : [...row.querySelectorAll('*')].find(isAct)
        if (!btn) continue
        if (isControlEl(prev) || [...prev.querySelectorAll('*')].some(isControlEl)) continue
        const words = (prev.textContent || '').trim().split(/\s+/).filter(Boolean)
        if (words.length < 4) continue
        /* ── AN EXPLANATION IS PROSE, AND THE MARKUP SAYS SO ──
           A word count cannot tell a sentence that explains an action from a
           readout in a pager bar. Measured at a 296px pane: four findings,
           and two were a readout span and a specimen span. */
        if (!(prev.matches('p') || prev.querySelector('p'))) continue
        const pr = prev.getBoundingClientRect(), br = btn.getBoundingClientRect()
        if (!pr.height || !br.height) continue
        if (br.top < pr.bottom - 0.5) continue
        if (getComputedStyle(row).transform !== 'none') continue
        /* AN OUT-OF-FLOW SIBLING SETS NO GAP. The Gallery tooltip specimen
           is an absolutely positioned span floating over its own trigger,
           measured 9.28px from the button and chosen by nobody. */
        if (/absolute|fixed/.test(getComputedStyle(prev).position)) continue
        const clear = br.top - pr.bottom
        if (clear >= CLEAR - 0.5) continue
        out.gaps.push({
          row: name(el),
          finding: name(btn) + ' sits ' + clear.toFixed(2) + 'px below the text that explains it, and the floor is '
            + CLEAR + 'px. At the container\'s own step a control reads as one more line of the paragraph. Put the difference in the action row\'s own padding.',
        })
      }
    }
    if (isRow(el)) {
      /* Only text that shares a line. Two lines of a wrapped paragraph have
         different baselines by definition, and comparing them reported an
         18px "violation" on a perfectly good toast. Group by the tallest
         line-height in the row, then judge within each band. */
      /* Single-line items only.
       *
       * A baseline belongs to a line, so only something that IS one line can
       * be judged against one. A two-line message in a toast has two, and
       * `typeMetrics` hands back the first — so the Restore button beside it
       * got measured against line one and reported 8.5px out, when the row was
       * correctly centred on the block as a whole. That is the rule already:
       * an item beside a multi-line block centres on the block, it does not
       * chase a baseline. The tool has to know it too.
       *
       * Lines counted from the box against its own line height. */
      const oneLine = el2 => {
        const c = getComputedStyle(el2)
        const lh = parseFloat(c.lineHeight) || parseFloat(c.fontSize) * 1.2
        const b = el2.getBoundingClientRect()
        const inner = b.height - (parseFloat(c.paddingTop) || 0) - (parseFloat(c.paddingBottom) || 0) -
                      (parseFloat(c.borderTopWidth) || 0) - (parseFloat(c.borderBottomWidth) || 0)
        return !(lh > 0 && inner > lh * 1.5)
      }
      const tms = [...el.querySelectorAll('*')].filter(oneLine).map(typeMetrics).filter(Boolean)
      /* 1.15, not 1.6. A band as wide as a line-height swallows the next line,
         so two real lines of a wrapped message read as one row 18.75px out of
         alignment. Anything further apart than the cap-to-baseline distance is
         a different line, not a fault.
       *
       * Proximity was the wrong question anyway. Two texts are on the same line
       * when the ink they lay down OVERLAPS vertically — that is what "same
       * line" means, and it needs no tuned constant. A 39px page heading and
       * the 15px buttons wrapped below it were being read as one row 44px out
       * of alignment, and a caption 13.84px above a label squeaked inside a
       * 14.72px band and got called a fault. Cap-top to baseline for each, and
       * ask whether the two ranges meet. Nothing to tune, nothing to drift. */
      /* A hairline touch is not the same line.
       *
       * Bare overlap put a toast's Restore button on the same line as the first
       * line of its own two-line message: bands meeting by 0.1px, reported 8.5px
       * out. The row centres the button on the WHOLE block, which is correct for
       * a multi-line neighbour, so the button's baseline naturally lands between
       * line one and line two and brushes both.
       *
       * Require a real share of the smaller band. A quarter is comfortably below
       * anything genuinely on one line, where the bands sit almost on top of
       * each other, and comfortably above the brush. */
      /* Two panes side by side are not one row.
       *
       * Vertical overlap is the right question inside a column and the wrong
       * one across a split. An editor pane and a preview pane sit at the same
       * height by construction, so a card heading in the left pane banded with
       * a stat tile in the right one and the tool reported a 5px baseline fault
       * between two things nobody would ever align. It fired on a screen that
       * was correct, which is a defect in the check.
       *
       * A pane is the nearest ancestor that is a child of a row-direction flex
       * container. Items under different panes never share a line. */
      /* ── Which pane a run belongs to ──
       *
       * Two side-by-side panes overlap vertically by construction, so a card
       * heading in a left pane banded with a stat tile in a right one and the
       * tool reported a 6px fault between two things nobody would align. It
       * fired on a correct screen, which is a defect in the check.
       *
       * Two earlier attempts BLINDED it. The first treated every flex-row
       * child as a pane boundary; the second required both children to be
       * tall. With a real fault injected into a title bar, both came back
       * clean, so both were reverted and the noise was left in.
       *
       * Why the first one failed: a title bar IS a flex row, so its own two
       * groups became separate panes and a fault between them stopped being
       * seen. The boundary is not "a flex row". It is a flex row that says its
       * children are NOT on one line — `align-items` anything but `baseline`.
       * A title bar declares `baseline` and partitions nothing, so an injected
       * fault there still fires. A split declares `stretch` and partitions its
       * panes, so the noise goes.
       *
       * This reads the property that decides the behaviour, rather than
       * guessing from geometry. That is the difference from both failures. */
      const paneKey = (node, root) => {
        const parts = []
        let child = node, parent = node.parentElement
        while (parent && child !== root) {
          const cs = getComputedStyle(parent)
          if (/flex/.test(cs.display) && !/column/.test(cs.flexDirection) && cs.alignItems !== 'baseline') {
            parts.push([...parent.children].indexOf(child))
          }
          child = parent
          parent = parent.parentElement
        }
        return parts.join('/')
      }
      for (const t of tms) t.pane = paneKey(t.el, el)
      const overlaps = (a, b) => {
        const top = Math.max(a.capTop, b.capTop)
        const bottom = Math.min(a.baseline, b.baseline)
        const shared = bottom - top
        if (shared <= 0) return false
        const smaller = Math.min(a.baseline - a.capTop, b.baseline - b.capTop)
        return smaller > 0 && shared / smaller > 0.25
      }
      const lines = []
      for (const t of tms) {
        const home = lines.find(l => l.some(o => o.pane === t.pane && overlaps(o, t)))
        if (home) home.push(t); else lines.push([t])
      }
      for (const line of lines) {
        if (line.length < 2) continue
        const ys = line.map(t => t.baseline)
        const spread = Math.max(...ys) - Math.min(...ys)
        const sizes = line.map(t => t.fontSize)
        const allowed = 0.3635 * (Math.max(...sizes) - Math.min(...sizes)) + 0.75
        if (spread > allowed) out.baselines.push({
          row: name(el), spread: +spread.toFixed(2), allowed: +allowed.toFixed(2),
          items: line.map(t => t.text + '@' + t.baseline + '/' + t.fontSize).slice(0, 5),
        })
      }
      /* Controls in a row share a height — but only the ones actually in the
         same row. A wrapping flex row is several rows, and comparing across the
         wrap reported four state specimens as 44px out of alignment when the
         fourth had simply gone to the next line. Same rule as the text above:
         two boxes are on one line when they overlap vertically. */
      /* What counts as an item in this row is a QUESTION, not a tag list.
       *
       * This used to name seven selectors, and the brand squircle in the app's
       * own title bar is a plain div. It sat in a row of buttons at a different
       * height, the eye caught it instantly, and the check had no opinion —
       * because a div was not on the list. A list of tags can only ever find
       * the cases somebody already thought of.
       *
       * The real question is whether a thing READS as an item in the row, and
       * the honest test for that is whether it draws a box: a background, a
       * border, or a radius it could only have for a shape. Controls stay in
       * by name, because a ghost button paints nothing and still belongs. */
      const drawsABox = c => {
        /* A hairline is a rule, not a member of the row.
         *
         * A 1 by 18px painted span sits between a tab strip and the control
         * beside it. It draws a box by every test below, so the height check
         * compared it against a 42px tab and reported the pair as mismatched —
         * while their centres agreed to the pixel, 71 against 71. A divider is
         * furniture. It marks where the row is divided and never joins it. */
        const r = c.getBoundingClientRect()
        if (Math.min(r.width, r.height) <= 2) return false

        const cs = getComputedStyle(c)
        const bg = cs.backgroundColor || ''
        const painted = bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)
        const bordered = ['Top', 'Right', 'Bottom', 'Left']
          .some(s => (parseFloat(cs['border' + s + 'Width']) || 0) > 0 && cs['border' + s + 'Style'] !== 'none')
        return painted || bordered || (cs.backgroundImage && cs.backgroundImage !== 'none')
      }
      const allCtrls = [...el.children].filter(c => seen(c) &&
        (c.matches('button, input, select, textarea, label, .btn, .seg-box, .chip, .badge, .avatar, .swatch')
         || drawsABox(c)))
      const bands = []
      for (const c of allCtrls) {
        const cr = c.getBoundingClientRect()
        const home = bands.find(b => b.some(o => {
          const or = o.getBoundingClientRect()
          return or.top < cr.bottom && cr.top < or.bottom
        }))
        if (home) home.push(c); else bands.push([c])
      }
      /* ── What a height mismatch is a mismatch WITH ──
       *
       * "Everything in this row is one height" is not the rule and never was.
       * A 32px avatar beside a 24px badge got reported as a broken fence. They
       * are two different components doing two different jobs, sharing a
       * baseline, and the project's own rule says a baseline row holding boxes
       * of different heights MUST have different heights. The check demanded
       * the row break the rule it was obeying.
       *
       * The rule is: things of ONE KIND answer to each other. Two buttons. A
       * button and the field beside it — both controls, and a button beside a
       * field matches the field box. An avatar and a badge are not one kind and
       * never were.
       *
       * A specimen row is exempt whatever its kinds. The Gallery prints the
       * button scale — 28, 36, 44 — side by side on purpose, and a sheet whose
       * job is to show three sizes cannot be faulted for showing three sizes.
       * `.row-label` is the marker it already carries. */
      /* Controls are one kind together, because a button beside a field matches
         the field box. Every other component answers only to itself: two
         avatars in a row share a height, and an avatar owes a badge nothing. */
      const KIND = [
        [/^(button|input|select|textarea)$/i, 'control'],
        [/\bbtn\b|\bseg-box\b/, 'control'],
        [/\bavatar\b/, 'avatar'],
        [/\bbadge\b/, 'badge'],
        [/\bchip\b/, 'chip'],
        [/\bswatch\b/, 'swatch'],
      ]
      const kindOf = c => {
        const cls = typeof c.className === 'string' ? c.className : ''
        for (const [re, k] of KIND) if (re.test(c.tagName) || re.test(cls)) return k
        return 'box'
      }
      /* Asked of the ROW, not of the band. A `.row-label` caption paints
         nothing, so it never joins the band, and testing the band for it
         skipped nothing at all. */
      const isSpecimenRow = [...el.children].some(c =>
        typeof c.className === 'string' && /\brow-label\b/.test(c.className))
      /* ── A DATA SERIES IS NOT A CONTROL ROW, AND ITS SIZES ARE THE DATA ──
       *
       * A column chart's bars differ in height by definition. A bar sitting
       * lower than its neighbour is a smaller number, not a misalignment.
       * Measured on one charts surface: six correct bars faulted per chart,
       * four charts deep, at every width, for both height and top. 24
       * findings, every one of them the data.
       *
       * ASK THE PROPERTY, NEVER A CLASS. A design decision lives in a
       * stylesheet. A datum arrives ON the element, because the size came
       * from a value at render time. So a row whose every child states its
       * own size inline is a series.
       *
       * APPLIED PER KIND, not per row, or it trades this miss for a worse
       * one. A row of BUTTONS hand-sized inline is the fault the inline-value
       * guards exist for, and it has to keep reporting. Only the
       * unrecognised `box` kind is exempted, which is what a bar is.
       */
      const statesOwnSize = c => !!(c.style && (c.style.height || c.style.width
        || c.style.blockSize || c.style.inlineSize))

      /* ── A CONTROL THAT CARRIES A TARGET OVERHANG HAS GIVEN UP ITS BOX ──
       *
       * The touch floor is a REACH, not a size. Written as a height it becomes
       * layout, and the drawn control then sits half the difference inside
       * whatever edge its container establishes. The repair is to size the
       * control to its own MARK and put the reach on an absolutely positioned
       * ::after at a negative inset, which costs no layout.
       *
       * So such a control is 14px tall beside a 44px field on purpose, and the
       * row-height check demanded the opposite of the rule that produced it.
       * It fired on a search field's clear button: a 14px box beside a 42px
       * label, reported as "a control row is one stated height".
       *
       * Read the PROPERTY, never a class: an ::after that is out of flow and
       * reaches outside its host is a target, and nothing else is. */
      const carriesOverhang = (c) => {
        try {
          const a = getComputedStyle(c, '::after')
          if (!a || a.content === 'none' || a.position !== 'absolute') return false
          return ['top', 'right', 'bottom', 'left']
            .some(side => parseFloat(a[side]) < -0.01)
        } catch { return false }
      }

      for (const band of bands) {
        if (isSpecimenRow) continue
        const ctrls = band.filter(c => !carriesOverhang(c))
        if (ctrls.length < 2) continue
        for (const kind of new Set(ctrls.map(kindOf))) {
          const same = ctrls.filter(c => kindOf(c) === kind)
          if (same.length < 2) continue
          if (kind === 'box' && same.every(statesOwnSize)) continue   /* a data series */
          const hs = same.map(c => Math.round(c.getBoundingClientRect().height))
          if (new Set(hs).size > 1) out.heights.push({ row: name(el), kind, heights: hs })
        }
        /* Same height is not the same position.
           Three 28px buttons where one sits a pixel higher reads as a smaller
           button, and a height check calls that row perfect. It happens the
           moment one sibling stops being a baseline participant — an
           inline-flex among inline-blocks, for instance.

           But a row that aligns on the BASELINE and holds boxes of different
           heights MUST have different tops. That is the arithmetic of baseline
           alignment, not a fault in it — a 28px and a 44px button sharing a
           baseline sit 4px apart at the top and that is the correct answer.
           Reporting it demanded the row break the rule it was obeying. So:
           where the text baselines already agree, the tops have nothing to
           answer for. */
        /* The same exemption. Bottom-aligned bars of different heights MUST
           have different tops, and that arrives looking like a fault. */
        if (ctrls.every(c => kindOf(c) === 'box') && ctrls.every(statesOwnSize)) continue
        const lineBaselines = ctrls.map(typeMetrics).filter(Boolean).map(t => t.baseline)
        const baselinesAgree = lineBaselines.length === ctrls.length && lineBaselines.length > 1 &&
          (Math.max(...lineBaselines) - Math.min(...lineBaselines)) <= 0.75
        const tops = ctrls.map(c => +c.getBoundingClientRect().top.toFixed(1))
        const spread = Math.max(...tops) - Math.min(...tops)
        /* ── NAME THE CAUSE, BECAUSE THE SYMPTOM SENDS YOU THE WRONG WAY ──
         *
         * A centred row holding two box heights MUST give two tops, and the
         * difference is exactly half the height difference. That is arithmetic,
         * not a fault — but it arrives looking like a misalignment. One 1px
         * offset in a generated build cost a separate investigation before the
         * heights were compared: a segmented control at 34 beside a select at
         * 36, both centred, 1px apart.
         *
         * So when the heights differ and the spread matches half that
         * difference, report the HEIGHTS. The row is not misaligned; it is
         * holding two heights, and that is the thing to fix. */
        const hs = ctrls.map(c => +c.getBoundingClientRect().height.toFixed(1))
        const hSpread = Math.max(...hs) - Math.min(...hs)
        /* ASK THE CENTRES, NEVER THE PARENT'S DECLARATION.
         *
         * This read `align-items` on the row. A CHILD may declare its own
         * `align-self: center` inside a baseline row, which is the correct
         * repair for a checkbox beside a text button. The parent then says
         * baseline, the exemption misses, and the check reports the very fix
         * that produced the geometry.
         *
         * Measured 17 September 2026 on a Components group header: a 16px
         * checkbox beside a 21px button, tops 2.50px apart, centre to centre
         * 0.00px, and half the height difference exactly 2.50px. Forcing the
         * row to `center` returned the same five numbers.
         *
         * Agreeing centres are the fact, whatever wrote them. Two boxes of
         * different heights on one centre MUST have different tops, so a
         * finding there asks the row to break its own alignment. And where the
         * centres agree AND the heights match, the spread is zero, so this
         * cannot silence a real offset. */
        const mids = ctrls.map(c => { const r = c.getBoundingClientRect(); return r.top + r.height / 2 })
        const midSpread = Math.max(...mids) - Math.min(...mids)
        const onOneCentre = ctrls.length > 1 && midSpread <= 0.6
        const explained = onOneCentre && hSpread > 0.5 && Math.abs(spread - hSpread / 2) < 0.6
        /* A row on one centre has nothing to answer for. The HEIGHTS are the
           finding, and the heights check above already reports them, so a tops
           finding here is the same fault counted twice. */
        if (spread > 0.5 && !baselinesAgree && !explained) out.tops.push({
          row: name(el), spread: +spread.toFixed(1),
          items: ctrls.map((c, i) => ({
            text: (c.textContent || '').trim().slice(0, 12) || 'icon-only',
            top: tops[i], height: hs[i], display: getComputedStyle(c).display,
          })),
        })
      }
      /* Gap rhythm. Several different gaps in one row usually means one of
         them was typed rather than chosen.

         SLACK IS NOT A GAP. Read the declaration, never the geometry. A row
         that pushes a group right with `margin-left: auto` has one distance in
         it that no one chose: it is whatever is left over, and it changes with
         the window. Measured on one header at 375px, the three distances were
         44, 8 and 16 — and the 44 was the slack the layout was told to put
         there. Faulting it faults the correct fix for "alignment is stated,
         never inherited".

         A container declaring `space-between` or its relatives hands every gap
         to the browser for the same reason, so it has no rhythm to check. */
      const kids = [...el.children].filter(seen)
      if (kids.length >= 3 && !/^space-/.test(getComputedStyle(el).justifyContent)) {
        const gaps = []
        for (let i = 1; i < kids.length; i++) {
          /* An auto margin on either side of this pair means the distance is
             leftover space. `getComputedStyle` resolves an auto margin to a
             pixel value, so it cannot answer this — ask the declaration. */
          if (declaresAuto(kids[i], 'margin-left') || declaresAuto(kids[i - 1], 'margin-right')) continue
          const g = kids[i].getBoundingClientRect().left - kids[i - 1].getBoundingClientRect().right
          if (g > -1) gaps.push(Math.round(g))
        }
        const distinct = [...new Set(gaps.filter(g => g >= 0))]
        if (distinct.length > 2) out.gaps.push({ row: name(el), gaps })
      }


      /* ── PROXIMITY IS A RATIO ──
       *
       * The gap inside a group against the gap between groups. Under three to
       * one the reader has to think about which things belong together, and
       * two groups start reading as one.
       *
       * This was written down and enforced by nothing, so the tool passed a
       * Shell surface clean while two tab strips sat 8px apart with 4px
       * between the tabs inside each — 2:1, and it read as one strip of seven
       * tabs. Their eye caught it. Every alignment check had no opinion,
       * because nothing here is misaligned.
       *
       * Compare the CONTAINER's gap to its children's own gaps, not gaps
       * within one row. The failure is nested by nature: a group's inner
       * rhythm against the distance to the next group. */
      /* ── A CONTROL IS ONE OBJECT, NOT A GROUP OF ITEMS ──
       *
       * This was the check's own worst false positive, and it took a header the
       * user had spaced by hand. A button holding an icon and a label is a flex
       * box with two children, so it matched "a group", and the check then
       * compared a BUTTON'S ICON-GAP against the distance to its neighbour. On
       * one header the groups it found were a words div and five buttons, and it
       * reported 8px against 8px at 1.0:1 — asking why a button's icon sits as
       * far from its label as the button sits from the next button. Those are
       * not the same kind of distance and there is no ratio between them.
       *
       * It cost more than noise. It stood as an open decision about changing two
       * gaps the user had stated deliberately, and both were already correct.
       *
       * A control's children are ORNAMENT — a mark, a label, a chevron. They
       * are not siblings in a layout, so the control is a leaf here whatever its
       * display. Ask INTERACTIVITY first, which is a property, and fall back to
       * the control classes for the inert samples a preview renders as spans.
       *
       * Measured on the fix: two false positives gone, four real findings kept
       * — 2.0:1 and 1.5:1 on Record, 1.5:1 on Shell, 2.0:1 on the Gallery. */
      const isControl = c =>
        c.matches('button, input, select, textarea, a[href], summary, [role="button"],'
          + ' [role="checkbox"], [role="radio"], [role="tab"], [role="switch"], [tabindex]')
        || c.matches('.btn, .badge, .chip, .seg, .seg-on, .nav-item, .tab, .avatar, .swatch')
      const groups = [...el.children].filter(seen).filter(c => {
        if (isControl(c)) return false
        const cs = getComputedStyle(c)
        if (!cs.display.includes('flex')) return false
        const kids = [...c.children].filter(seen)
        if (kids.length < 2) return false
        /* ── A READOUT IS ONE OBJECT, THE WAY A CONTROL IS ──
         *
         * A status mark beside its own words is a mark and a label, not two
         * things a reader scans separately. It is the rule this file already
         * states about a button: a control's children are ORNAMENT, so the
         * control is a leaf whatever its display.
         *
         * Measured on one header: a dot and the words "Reading Drive…" in a
         * flex span, beside a pair of buttons in another, reported 8px
         * against 8px at 1.0:1 on correct markup. The dot has no meaning
         * apart from the words, and the two are 8px apart because they are
         * one readout.
         *
         * ASK THE TWO PROPERTIES, NEVER THE CLASS. It holds nothing anybody
         * can press, and all of its ink comes from ONE child. A words column
         * of a heading and a caption has text in two children and stays a
         * group. A row of two labels does too. */
        const pressable = c.querySelector('button, a[href], input, select, textarea, [role="button"], [tabindex]')
        if (!pressable) {
          const inked = kids.filter((k) => k.textContent.trim()).length
          if (inked <= 1) return false
        }
        return true
      })
      if (groups.length >= 2) {
        /* MEASURE the distance between groups, never the declared gap.
         *
         * A margin on a flex child ADDS to its container's gap, so the two are
         * not the same number. Reading `column-gap` alone faulted a header at
         * 1:1 where the painted distance was 16 against 8 — the group carried
         * `margin-right: calc(16px - 8px)` and the check could not see it.
         * The same lesson as an auto margin: the declaration is not the whole
         * distance, so take it off the rectangles. */
        const parentCs = getComputedStyle(el)
        const spreads = /^space-(between|around|evenly)$/.test(parentCs.justifyContent)
        const declaredGap = parseFloat(parentCs.columnGap) || 0
        const outers = []
        for (let i = 1; i < groups.length; i++) {
          const a = groups[i - 1], b = groups[i]
          /* Slack is not a gap. An auto margin's leftover space is whatever is
             left over, and it changes with the window. */
          if (declaresAuto(b, 'margin-left') || declaresAuto(a, 'margin-right')) continue
          /* ── AND `space-between` IS THE SAME SLACK UNDER THE PARENT'S NAME ──
           *
           * An auto margin and a distributing `justify-content` do one thing:
           * they hand the leftover width to the space between the groups. So
           * the painted distance is the window, never a decision, and it moves
           * with every resize.
           *
           * Measured on one header at 375: 164px brand, 166px actions, 13px
           * left over, reported at 1.6:1 against an 8px inside gap. The same
           * header at a wider window reported nothing. Three characters more
           * in a version string was the whole difference.
           *
           * THE DISTRIBUTOR ONLY DECIDES IT WHEN THERE IS SLACK TO GIVE. A
           * full row paints exactly the declared gap, and that number IS the
           * author's, so it stays in the check. Compare the two rather than
           * exempting the container outright. */
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
          if (spreads && rb.left - ra.right > declaredGap + 0.5) continue
          if (rb.top - ra.top > 2) continue          // a wrapped line, not a gap
          const d = rb.left - ra.right
          if (d > -1) outers.push(d)
        }
        const outer = outers.length ? Math.min(...outers) : 0
        /* ── A COLUMN DECLARES A columnGap THAT PAINTS NOTHING ──
         *
         * The outer distance above is HORIZONTAL, off the rectangles. So the
         * inner one has to be horizontal too. `gap: 16px` sets both axes, and
         * a column flex box then reports 16px on an axis its children never
         * sit along.
         *
         * Measured on two Shell panes: declared columnGap 16px, painted
         * horizontal gaps NONE, painted vertical gaps 16px. Three surfaces
         * reported this at 1280 and all three were correct code. Before the
         * gutters moved from 48 to 32 the same arithmetic gave exactly 3.0
         * and passed by a hair, so it had always been reading an inert
         * number.
         *
         * A column that WRAPS does form columns, so it stays in. */
        const inners = groups
          .filter(g => { const cs = getComputedStyle(g); return !(cs.flexDirection.startsWith('column') && cs.flexWrap === 'nowrap') })
          .map(g => parseFloat(getComputedStyle(g).columnGap) || 0).filter(n => n > 0)
        /* ── TWO TO ONE IS THE BAR ──
         *
         * This read three for as long as the check existed. The rule was
         * lowered to two on 9 September 2026, against a measurement: of 25
         * proximity groups in one system, 13 sat at six to one or more and
         * only two cases turned on the bar. Both were content beside its own
         * context, at 32 between and 16 inside, which reads as related
         * rather than as separate.
         *
         * ONE BAR FOR THE WHOLE RULE. A second figure here is how two
         * versions of one rule end up disagreeing, and this check was
         * reporting "wants 3:1" against shipped code sitting at exactly 2.0. */
        if (outer > 0 && inners.length) {
          const inner = Math.max(...inners)
          const ratio = outer / inner
          if (ratio < 2) {
            out.other.push({
              el: name(el),
              finding: `groups read as one: ${Math.round(outer)}px between them, ${inner}px inside them `
                + `(${ratio.toFixed(1)}:1, wants 2:1)`,
            })
          }
        }
      }

      /* ── ORPHAN: A WRAPPED LINE THAT DOES NOT START AT THE LEFT EDGE ──
       *
       * A row that wraps puts its overflow on a new line, and that line begins
       * where the container's content begins. When it does not, something is
       * holding it over and nothing said so — the shape behind two real faults
       * here. A menu button stopped 168px short of the edge at one width, and an
       * action group packed left with 226px of empty bar beside it. Neither is
       * misaligned by any other check, because nothing is out of line with
       * anything: the whole line is in the wrong place.
       *
       * Every exemption below is a DECLARATION, because the geometric version of
       * this check already faulted every centred card in the app.
       *
       * `justify-content` decides where a line starts, so anything other than
       * the values that promise the left edge is the container's own decision.
       * An auto margin is leftover space by definition. And the content box, not
       * the border box — a row with 12px of padding reported a child that filled
       * its line as 24px short of it. */
      const jc = getComputedStyle(el).justifyContent
      const dir = getComputedStyle(el).flexDirection
      if (/^(flex-start|start|normal|left)$/.test(jc) && dir === 'row') {
        const kids = [...el.children].filter(seen)
          .filter(c => !/absolute|fixed/.test(getComputedStyle(c).position))
        /* Band by vertical OVERLAP, never by a distinct top. A button whose icon
           sits above its label has two tops and one line, and counting tops
           reported 28 wrapped rows on a page where almost none had wrapped. */
        const bands = []
        for (const c of kids) {
          const r = c.getBoundingClientRect()
          if (!r.height) continue
          const band = bands.find(b => Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 0)
          if (band) { band.top = Math.min(band.top, r.top); band.bottom = Math.max(band.bottom, r.bottom); band.items.push(c) }
          else bands.push({ top: r.top, bottom: r.bottom, items: [c] })
        }
        if (bands.length >= 2) {
          const cs = getComputedStyle(el)
          const box = el.getBoundingClientRect()
          const contentLeft = box.left + parseFloat(cs.borderLeftWidth || 0) + parseFloat(cs.paddingLeft || 0)
          bands.sort((a, b) => a.top - b.top)
          for (const band of bands.slice(1)) {
            const first = band.items.sort((a, b) =>
              a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0]
            if (declaresAuto(first, 'margin-left')) continue
            const short = first.getBoundingClientRect().left - contentLeft
            if (short > 1) out.other.push({
              el: name(el),
              finding: `wrapped line starts ${Math.round(short)}px in from the left edge, `
                + `and no auto margin says why — "${(first.textContent || '').trim().slice(0, 18) || 'icon-only'}"`,
            })
          }
        }
      }


      /* ── DEAD SPACE: ONE GAP FAR LARGER THAN THE ROW'S OWN RHYTHM ──
       *
       * A hole nobody chose. The gap check above reports a row holding several
       * DIFFERENT gaps; this asks a narrower question — whether one of them
       * dwarfs the rest — because a row of 8, 8, 8, 40 reads as two groups while
       * a row of 8, 8, 12 merely reads as untidy.
       *
       * Slack is excluded twice over: a pair either side of an auto margin is
       * skipped, and a container handing every gap to the browser with
       * `space-*` has no rhythm to compare against. Four gaps at minimum, so a
       * median means something — with three, the largest IS a third of the data
       * and any row with one deliberate group separator faults. */
      const dsKids = [...el.children].filter(seen)
      if (dsKids.length >= 5 && !/^space-/.test(getComputedStyle(el).justifyContent)) {
        const gs = []
        for (let i = 1; i < dsKids.length; i++) {
          if (declaresAuto(dsKids[i], 'margin-left') || declaresAuto(dsKids[i - 1], 'margin-right')) continue
          const a = dsKids[i - 1].getBoundingClientRect(), b = dsKids[i].getBoundingClientRect()
          if (b.top - a.top > 2) continue               // a wrapped line, not a gap
          const g = b.left - a.right
          if (g > -1) gs.push({ g: Math.round(g), after: dsKids[i - 1] })
        }
        if (gs.length >= 4) {
          const sorted = gs.map(x => x.g).sort((a, b) => a - b)
          const mid = sorted.length % 2
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          /* Four times the median, and at least 24px of actual hole. A ratio
             alone fires on a tidy row of 2px gaps with one 8px group break,
             which is a rhythm rather than a hole. */
          for (const { g, after } of gs) {
            if (mid > 0 && g >= mid * 4 && g - mid >= 24) out.other.push({
              el: name(el),
              finding: `dead space: one gap of ${g}px against a median of ${mid}px in the same row, `
                + `after "${(after.textContent || '').trim().slice(0, 18) || 'icon-only'}" — no auto margin accounts for it`,
            })
          }
        }
      }
    }

    /* Left edges of a stack should agree — where the stack asked for that.
     *
     * Read the DECLARATION, never the geometry. A column that declares
     * `align-items: center` has already decided its children sit on their own
     * centres, so three children of three widths MUST have three different
     * left edges. That is the declaration working, not a stack that drifted.
     * Faulting it fires on every centred empty state, every centred dialog and
     * every centred hero — and a check that fires on correct code trains you to
     * skim the table, which is the same failure as never running it.
     *
     * `stretch` and `flex-start` are the values that promise one left edge, so
     * they are the only ones asked. A child that opts out with its own
     * `align-self` is excluded for the same reason: it said so. */
    const cs = getComputedStyle(el)
    const EDGE_ALIGNED = new Set(['stretch', 'flex-start', 'start', 'normal', 'baseline'])
    if (cs.display === 'flex' && cs.flexDirection.startsWith('column')
        && EDGE_ALIGNED.has(cs.alignItems) && el.children.length >= 3) {
      const ls = [...el.children].filter(seen)
        .filter(c => {
          const self = getComputedStyle(c).alignSelf
          return self === 'auto' || EDGE_ALIGNED.has(self)
        })
        .map(c => Math.round(c.getBoundingClientRect().left))
      if (new Set(ls).size > 1) out.edges.push({ stack: name(el), lefts: [...new Set(ls)] })
    }

    /* Everything `probe` found, not just the part I happened to read.
     *
     * This block used to call `probe`, take `textCentring`, and drop the rest
     * on the floor. The icon offset was computed on every sweep and never
     * reported, so every icon in every button sat 2.55px low for as long as
     * the tool existed. A check you do not read is not a check. */
    /* ── A TAG LIST FINDS THE CASES SOMEBODY ALREADY THOUGHT OF ──
     *
     * This read `button, .btn, .badge, .seg, .seg-on`. A search field is none
     * of those, so its leading mark was never probed: it sat 4.16px off its own
     * label's optical mid for as long as the field existed, and eleven surfaces
     * came back clean every single time. They found it in a screenshot, which
     * is how every hole in this file has been found.
     *
     * Worse than a miss. The mark was centred on the field's BOX, which is the
     * fault, and the icon-only branch measures exactly that. Had the element
     * reached the probe under the old rule, the tool would have approved it.
     *
     * So ask the QUESTION rather than listing the answers: does this element
     * hold a mark beside its OWN label? That covers a field, a chip, a row, a
     * menu item, and whatever gets built next.
     *
     * Two guards, or it fires on containers. An element holding a nested button
     * or link is a GROUP of controls, and its first mark and its first text
     * then belong to different children. And the mark has to be its own child,
     * not something four levels down. */
    const isControl = el.matches('button, .btn, .badge, .seg, .seg-on')
    /* A CONTROL IS ONE OBJECT, NOT A GROUP OF ITEMS. A form field group holds a
       label, an input and a note, so its first mark and its first text belong
       to different children: measured, it reported a mark 72.35px off a label
       three rows above it. Anything containing another control is a container.
       A field's own label is not one — its children are a mark and a word. */
    const marksItsOwnLabel = () => {
      if (isControl) return true
      if (el.querySelector('button, a[href], [role="button"], .btn, input, select, textarea, label')) return false
      /* The wrapper clause exists for a mark inside a span. It must not match a
         whole labelled ROW, or the row's parent reports the row's mark as well
         and one fault prints twice: a card and the heading inside it both read
         0.89. A wrapper around a mark carries no words of its own. */
      const ownMark = [...el.children].some(c =>
        /^svg$/i.test(c.tagName) ||
        (c.children.length === 1 && /^svg$/i.test(c.firstElementChild.tagName) &&
         !(c.textContent || '').trim()))
      return ownMark && Boolean(_textRect(el))
    }
    if (marksItsOwnLabel()) {
      const p = probe(el)
      /* 1.5, matching probe. These two thresholds drifted apart and the sweep
         reported four buttons whose own probe called them centred. */
      /* A CONTROL WITH TWO STACKED LINES IS NOT A CONTROL WITH A LABEL.
       *
       * This asks whether a label sits optically centred in its box, which is
       * the right question for a button and the wrong one for a card: a heading
       * with a note under it is MEANT to start at the top. Five choice cards
       * reported "sits HIGH" by 54px, and the remedy would have been to centre a
       * two-line block on one of its lines.
       *
       * The tell is a block-level child carrying its own text. A button’s label
       * in a span is inline; a stacked card states `display: block` on each. */
      const stacked = [...el.children].filter(c => {
        if (!(c.textContent || '').trim()) return false
        return /block|flex|grid/.test(getComputedStyle(c).display)
      }).length > 1
      /* ── AND COUNT THE LINES, BECAUSE `stacked` ONLY SEES ONE LEVEL ──
       *
       * `stacked` asks whether a DIRECT child is a block carrying text. A
       * choice card puts its name and its description inside ONE inline span,
       * so the stacking sits a level deeper and the guard found none. The
       * check then judged the FIRST line of a three-line block against the
       * whole box: measured 9px above and 40 below on a 64px card whose label
       * block was 46px tall at top 9, which is 9 above and 9 below. Centred
       * exactly, reported as "sits HIGH" by 31px.
       *
       * The property is how many lines the text occupies. One line can be
       * judged against a box. More than one is a block, and a block centres on
       * itself. This subsumes `stacked` rather than replacing it: that one is
       * cheap, documented, and catches the same shape from the other side.
       *
       * Rounded, because the rects of one line differ by hundredths. */
      /* ── COUNT LINES OF TEXT, NOT RECTS OF EVERYTHING ──
       *
       * This selected the whole control's contents, so the MARK contributed a
       * rect of its own. An icon offset from the label — which is the fault
       * this number is used to gate — then produced a second distinct top and
       * the control was called two lines. The guard built on it suppressed the
       * finding it exists to allow. Proven: an injected icon 9px off its
       * single-line label read `dy -8.5` from `probe()` and nothing at all
       * from `sweep()`.
       *
       * Walk the TEXT nodes. A mark has none, so it cannot vote. */
      let textLines = 1
      try {
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        const tops = new Set()
        for (let node = walk.nextNode(); node; node = walk.nextNode()) {
          if (!(node.nodeValue || '').trim()) continue
          const rng = document.createRange()
          rng.selectNodeContents(node)
          for (const r of rng.getClientRects())
            if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top))
        }
        if (tops.size) textLines = tops.size
      } catch { /* a node a Range will not take: fall through as one line */ }

      /* TEXT CENTRING IS A QUESTION ABOUT A BOX WITH A STATED HEIGHT, and it
         stays on the control list. Widening the icon question dragged it along,
         and it then asked whether a flex ROW's label was centred in the row:
         three `.with-icon` rows reported "sits HIGH" by up to 6px, and the
         remedy would have been to centre a heading on a row it does not own. */
      if (isControl && !stacked && textLines === 1 && p.textCentring && Math.abs(p.textCentring.gapDifference) > 1.5)
        out.textOffCentre.push({ el: name(el), reads: p.textCentring.reads, gapDifference: p.textCentring.gapDifference, above: p.textCentring.spaceAboveCap, below: p.textCentring.spaceBelowBaseline })
      /* `dx` only exists for the icon-only case now. Testing it unconditionally
         was what flooded the report with correct leading icons. */
      /* ── A MULTI-LINE LABEL HAS NO CAP CENTRE TO SHARE ──
       *
       * `typeMetrics` returns the FIRST line's optical mid, so a mark beside a
       * two-line block is measured against a line it was never aligned to. Two
       * mode-choice cards in this app's own chrome read -35 and -34px, and the
       * only remedy would have been to move a correctly centred icon.
       *
       * `textOffCentre` already carried this guard and this did not, which is
       * the same fault in a sibling check. Scope it to the case where the
       * label IS the reference: an icon-only control has no label at all and
       * is measured against its own box, so it keeps its test. */
      const labelRef = p.icon && p.icon.ref === 'label optical mid'
      if (p.icon && !(labelRef && textLines > 1) &&
          (Math.abs(p.icon.dy) > 0.75 || Math.abs(p.icon.dx || 0) > 0.75))
        out.iconOffCentre.push({ el: name(el), text: (el.textContent || '').trim().slice(0, 14) || 'icon-only',
                                 ref: p.icon.ref, dx: p.icon.dx, dy: p.icon.dy })
      /* Anything else probe complains about, surfaced rather than swallowed. */
      for (const f of p.findings || []) {
        if (/^icon|^text/.test(f)) continue
        out.other.push({ el: name(el), finding: f })
      }
    }

    /* ── TWO ICONS IN ONE ROW RENDER AT ONE STROKE WEIGHT ──
     *
     * They pointed at two buttons and asked what was going on with the icons.
     * Every existing check passed: the boxes were the right size, the gap was
     * the token, and the marks centred to 0.17px. All of those measure POSITION
     * and BOX. Nothing measured INK, so nothing had an opinion about how heavy
     * a glyph paints.
     *
     * The chrome held TWELVE stroke widths, invented one at a time: 1, 1.4, 1.5,
     * 1.6, 1.8, 1.9, 2, 2.1, 2.2, 2.4, 2.5, 2.6. Rendered, that came out as seven
     * different on-screen weights between 0.97px and 1.28px.
     *
     * THE ON-SCREEN WEIGHT IS WHAT THE EYE READS, and it is not the stroke
     * attribute. An SVG scales its stroke with its viewBox, so one token renders
     * differently at every size: 1.75 gives 1.02px in a 14px box and 1.17px in a
     * 16px box. Same declaration, heavier icon.
     *
     * SPAN IS DELIBERATELY NOT CHECKED. Lucide draws a plus at 58% of its box and
     * a download at 75%, on purpose, because a bold simple shape reads large. I
     * reported that spread as a defect before verifying it against the library,
     * and redrawing to a uniform box would have destroyed the optical balance the
     * payload promises. The library's business is the library's.
     *
     * Weight is ours, and two marks side by side at different weights is a fault
     * in any set. */
    if (/flex|grid|block/.test(cs.display)) {
      /* ── A TICK INSIDE A CHECKBOX IS NOT AN ICON IN THE ROW ──
       *
       * The reader sees the BOX; the mark inside it is ornament, and a small
       * tick is drawn heavier on purpose or it reads faint. This reported five
       * 2px ticks against fourteen 1px icons on one build, three times over,
       * and the only remedy would have been to thin a tick inside its own box.
       * That is the exemption the centring checks already grant.
       *
       * Narrow on the ROLE, never on "inside a control". A row of buttons each
       * holding an icon is the case this check exists for, so exempting every
       * mark inside anything interactive would blind it completely. Only a
       * state indicator on a checkbox, radio or switch is exempt. */
      const isStateMark = s => {
        let n = s.parentElement
        for (let up = 0; n && up < 3 && n !== el; up++, n = n.parentElement) {
          const role = n.getAttribute && n.getAttribute('role')
          if (role === 'checkbox' || role === 'radio' || role === 'switch') return true
          if (n.classList && (n.classList.contains('checkbox') ||
            n.classList.contains('switch') || n.classList.contains('radio'))) return true
          if (n.querySelector && n.querySelector(':scope > input[type="checkbox"], :scope > input[type="radio"]')) return true
        }
        return false
      }
      /* ── "ONE ROW" MEANS ONE LEVEL, NOT ANY DEPTH ──
       *
       * `:scope > * svg` is a DESCENDANT selector, so it matched marks at any
       * depth beneath a direct child. Every ancestor then reported the whole
       * page's icons as though they sat in one row: `BODY` printed nine
       * distinct weights, and 68 findings came from 3 real spreads seen from
       * 32 nested vantage points.
       *
       * A mark in a row is either the row's own child or the ornament of one
       * of its children. That is one level, and `> * > svg` says so. */
      const marks = [...el.querySelectorAll(':scope > svg, :scope > * > svg')]
        .filter(s => { const r = s.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
        .filter(s => !isStateMark(s))
        .map(s => {
          const r = s.getBoundingClientRect()
          const cs = getComputedStyle(s)
          const sw = parseFloat(cs.strokeWidth)
          if (!sw) return null
          /* `non-scaling-stroke` takes the stroke OUT of the viewBox transform,
             so the declared width is already the painted width. Multiplying by
             the scale here reported a fault on the very fix that removed it. */
          if (cs.vectorEffect === 'non-scaling-stroke') {
            return { el: s, px: +sw.toFixed(2), box: +r.width.toFixed(1) }
          }
          const vb = (s.getAttribute('viewBox') || '').split(/\s+/).map(Number)
          if (vb.length !== 4 || !vb[2]) return null
          return { el: s, px: +(sw * (r.width / vb[2])).toFixed(2), box: +r.width.toFixed(1) }
        })
        .filter(Boolean)
      if (marks.length > 1) {
        const weights = [...new Set(marks.map(m => m.px))]
        /* 0.1px is where the eye starts to read one mark as heavier than its
           neighbour. Below that it is rounding, and a check that fires on
           rounding is the noise this file spends most of its length avoiding. */
        const spread = Math.max(...weights) - Math.min(...weights)
        if (spread > 0.1) out.other.push({
          el: name(el),
          finding: `icons in one row paint at ${weights.length} different stroke weights: `
            + weights.sort((a, b) => a - b).join('px, ') + 'px. '
            + 'An SVG scales its stroke with its box, so one token is not one weight.',
        })
      }
    }

    /* ── A mark beside a heading sits on the heading's CAP CENTRE ──
     *
     * The hole they found: a burger beside a page title, 2.81px above the cap
     * centre, and the sweep had no opinion. Every existing check missed it for
     * a different reason. The baseline check reads text runs, and a burger has
     * no text. The heights check compares controls, and a heading is not one.
     * `iconOffCentre` only looks INSIDE a control. Nothing asked the question a
     * reader asks first: does that mark sit level with the word beside it.
     *
     * Why a heading and not any label: `align-items: center` centres on the
     * BOX, and a heading's box is much taller than its cap band, so the error
     * grows with the type size. At body size it is a fraction of a pixel.
     *
     * Scoped on the declaration, so it cannot fire on a row that never claimed
     * to align these two: the container must centre its items, and it must
     * hold exactly one heading and at least one painted, textless element. */
    if (/flex|grid/.test(cs.display) && cs.alignItems === 'center') {
      const kids = [...el.children].filter(seen)
      const heads = kids.filter(k => /^H[1-6]$/.test(k.tagName) && (k.textContent || '').trim())
      /* ── Measure the INK, never the wrapper ──
       *
       * The first version took the child's border box and reported 1.19px on a
       * fault the eye reads as 2.81. A burger is three spans inside a summary
       * inside a `details`, and the wrapper was 48px tall because the summary
       * still carried a bottom margin — so the wrapper's centre sat near the
       * cap centre while the bars nobody could mistake sat well above it.
       *
       * A reader looks at what is painted. So does this: the union of every
       * painted descendant, which for a burger is the three bars and for an
       * `svg` is the svg. */
      const paintedOf = n => {
        const c = getComputedStyle(n)
        const bg = c.backgroundColor || ''
        if (bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) return true
        if (c.backgroundImage && c.backgroundImage !== 'none') return true
        if (['Top', 'Right', 'Bottom', 'Left'].some(s => (parseFloat(c['border' + s + 'Width']) || 0) > 0 && c['border' + s + 'Style'] !== 'none')) return true
        return n.tagName === 'svg' || n.tagName === 'IMG'
      }
      const inkBox = k => {
        let top = Infinity, bottom = -Infinity
        for (const n of [k, ...k.querySelectorAll('*')]) {
          if (!paintedOf(n)) continue
          const r = n.getBoundingClientRect()
          if (!(r.width > 0 && r.height > 0)) continue
          top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom)
        }
        return bottom > top ? { top, bottom } : null
      }
      const marks = kids.filter(k => !(k.textContent || '').trim() && inkBox(k))
      /* One line, or the reference is wrong.
         A cap centre belongs to a line. A heading that wraps has two, and an
         item beside a multi-line block centres on the BLOCK — which is what a
         56px two-line `h3` beside a 20px icon was already doing correctly when
         the first version reported it 14px out. The tool knows this rule for
         baselines and has to know it here too. */
      const oneLine = el2 => {
        const c = getComputedStyle(el2)
        const lh = parseFloat(c.lineHeight) || parseFloat(c.fontSize) * 1.2
        const b = el2.getBoundingClientRect()
        const inner = b.height - (parseFloat(c.paddingTop) || 0) - (parseFloat(c.paddingBottom) || 0)
        return !(lh > 0 && inner > lh * 1.5)
      }
      if (heads.length === 1 && marks.length && oneLine(heads[0])) {
        const tm = typeMetrics(heads[0])
        /* ── A COLUMN IS NOT A ROW, AND `align-items: center` SAYS NOTHING
         * ABOUT WHICH ──
         *
         * That property centres on the CROSS axis, so a centred column carries
         * it exactly as a centred row does. Every empty state is such a
         * column: a mark above a heading above a sentence above an action.
         *
         * Measured 19 September 2026 on one empty state at 375px. The mark sat
         * at y 500 and the heading at 532, so the two share no band, and the
         * check reported the mark 31px above a cap centre it was never beside.
         * `flex-direction` read `column`.
         *
         * The gate is the INK, not the direction. Two things are on one row
         * when their painted boxes overlap vertically. That is the rule the
         * banding already uses, and it also excludes a wrapped row. */
        const hb = inkBox(heads[0]) || heads[0].getBoundingClientRect()
        const onOneRow = (mk) => {
          const b = inkBox(mk)
          return b && b.bottom > hb.top && hb.bottom > b.top
        }
        if (tm) {
          const capCentre = (tm.capTop + tm.baseline) / 2
          for (const mk of marks) {
            if (!onOneRow(mk)) continue
            const b = inkBox(mk)
            const dy = +(((b.top + b.bottom) / 2) - capCentre).toFixed(2)
            /* 1.5px, the same floor the text-centring check uses. Below that
               nobody resolves it and a tighter number reports rounding. */
            if (Math.abs(dy) > 1.5) out.iconOffCentre.push({
              el: name(mk), text: 'mark beside ' + heads[0].tagName.toLowerCase(),
              ref: 'cap centre of "' + tm.text + '"', dy,
            })
          }
        }
      }
    }

    /* ── A control with a mark and no words is SQUARE ──
     *
     * Their rule. A rectangle reads as a button whose label failed to load.
     *
     * This is the general condition, and it has to live here rather than in
     * CSS: a selector cannot ask whether a child is rendered. A label hidden by
     * a media query leaves the markup unchanged, so `.icon-only` was never
     * added and the menu button shipped at 46x28 and 70x44.
     *
     * "No words" means no VISIBLE text, not an empty element — the label is
     * still in the DOM with `display: none`. So the test walks the descendants
     * and asks what the engine renders.
     *
     * A control is anything you press. Scoped that way rather than to `.btn`,
     * because the one that broke this was a `summary`. */
    if (el.matches('button, summary, a.btn, .btn, [role="button"]')) {
      const shows = n => {
        for (let p = n; p && p !== el.parentElement; p = p.parentElement) {
          const c = getComputedStyle(p)
          if (c.display === 'none' || c.visibility === 'hidden') return false
        }
        return true
      }
      let words = ''
      for (const n of el.querySelectorAll('*')) {
        for (const kid of n.childNodes) {
          if (kid.nodeType === 3 && kid.textContent.trim() && shows(n)) words += kid.textContent.trim()
        }
      }
      for (const kid of el.childNodes) {
        if (kid.nodeType === 3 && kid.textContent.trim()) words += kid.textContent.trim()
      }
      /* A zero-width space is a baseline strut, not a word. */
      words = words.replace(/[​‌‍﻿]/g, '').trim()
      const r = el.getBoundingClientRect()
      /* ── ICON-ONLY MEANS THERE IS AN ICON ──
       *
       * The rule reads "a pressable thing WITH A MARK, no visible words and
       * two different sides", because an oblong reads as a button whose label
       * failed to load. The code checked only the words and the sides, so it
       * faulted every control that paints its own content: 55 palette
       * swatches at 63x40 and 5 seed swatches at 129x64, none of which holds
       * a mark, all of which are rectangles on purpose. 60 findings out of
       * 62, burying the 2 that were real.
       *
       * A swatch IS its colour. There is no glyph whose squareness could be
       * the question. Ask for the mark. */
      const hasMark = !!el.querySelector('svg, img, .icon, .dot')
      if (hasMark && !words && r.width > 0 && r.height > 0 && Math.abs(r.width - r.height) > 1) {
        out.other.push({
          el: name(el),
          finding: 'icon-only control is not square: ' +
            Math.round(r.width) + 'x' + Math.round(r.height) +
            ' (' + (r.width / r.height).toFixed(2) + ':1)',
        })
      }
    }

    /* Scrollbars are a cost, so each one has to be justified. */
    const sx = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1
    const sy = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1
    if (sx || sy) out.scrollers.push({ el: name(el), axis: sx && sy ? 'both' : sx ? 'x' : 'y' })

    /* ── A THING DRESSED AS A CONTROL THAT THE ENGINE CANNOT OPERATE ──
     *
     * Sixteen checkboxes across eleven surfaces were `<span>` elements: no
     * `input`, no `role`, no `aria-checked`, no `tabindex`, and five of them
     * inside a `<label>` that held no control and carried no `for`. Nothing
     * reported it. The a11y audit reads the document's DECLARED component sizes
     * and never asks the DOM, so a whole class of instance had no check at all.
     *
     * It also makes every target measurement on them meaningless rather than
     * merely wrong. The published minimum was 44px and the boxes measured 16, so
     * the obvious repair is padding — and padding a span to 44px passes the check
     * while demonstrating nothing. Ask whether the thing IS a control before
     * measuring its target.
     *
     * Matched on the CLASS, because that is the claim being made: an element
     * carrying `.checkbox` or `.switch` says it is one. Then ask the engine two
     * questions it can answer — can this be focused, and does it have a name. A
     * real `input` satisfies both by existing. */
    if (el.matches('.checkbox, .switch, .radio, [class*="toggle"]')) {
      const native = el.matches('input, select, textarea, button')
      const role = el.getAttribute('role')
      const focusable = native || el.tabIndex >= 0
      /* A sibling input inside the same label is the standard arrangement: the
         drawn box is decoration and the real control sits beside it.
         SIBLINGS, or the label's own descendants — never `parentElement`
         plus `querySelector`. That searches the parent's whole subtree, so for a
         box whose parent is the surface it found one of eleven real inputs
         elsewhere on the screen, called it the partner, and reported an inert
         span as merely unnamed. The injected fault came back with the wrong
         message, and an assertion counting findings rather than reading them
         called that a pass. */
      const CTRL = 'input, [role="checkbox"], [role="switch"], [role="radio"]'
      const lab = el.closest('label')
      const partner = lab
        ? lab.querySelector(CTRL)
        : [...(el.parentElement?.children || [])].find(c => c !== el && c.matches(CTRL))
      const named = !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
        || partner?.getAttribute('aria-label') || partner?.getAttribute('aria-labelledby')
        || (el.closest('label') && el.closest('label').textContent.trim()))
      if (!partner && !focusable && !role) out.other.push({
        el: name(el),
        finding: 'dressed as a control and the engine cannot operate it: no input, '
          + 'no role, no tabindex. A target measured on this means nothing.',
      })
      else if (!named) out.other.push({
        el: name(el),
        finding: 'operable but unnamed: nothing announces what this selects. '
          + 'A positional label still owes an accessible name.',
      })
    }

    /* ── AN OVERLAY THAT NEVER DECLARES ITSELF A DIALOG ──
     *
     * The operable check above matched two classes, `.checkbox` and `.switch`,
     * so it was blind to every other kind of control-shaped thing. One preview
     * surface existed to demonstrate an overlay and carried ZERO `aria-*`
     * attributes and no `role` at all. A keyboard reader met a card in a page,
     * and the page behind it stayed reachable.
     *
     * Matched on the CLASS, for the same reason as the checkbox above: the class
     * is the claim. An element carrying `modal`, `dialog`, `drawer` or `sheet`
     * says it is an overlay, and then three questions have answers.
     *
     * `popover` is deliberately absent from the MODAL list. A popover is not
     * modal, so demanding `aria-modal` of one would fault correct code. */
    const OVERLAY = '[class*="modal"], [class*="dialog"], [class*="drawer"], [class*="sheet"], [role="dialog"], [role="alertdialog"]'
    /* ── A NAME LIST FAULTS WHATEVER SHARES A WORD ──
     *
     * `[class*="sheet"]` matched a dashboard's main content wrapper, called
     * `.sheet` because it is the page's paper. It sits in normal flow and
     * covers nothing, and the check demanded it declare itself a dialog. That
     * is the tag-list failure inverted: the list approves what nobody thought
     * of AND faults what merely shares a word.
     *
     * An overlay is a thing that paints OVER the page, and CSS says so. Ask
     * the declaration. A `<dialog>` and anything already claiming a dialog
     * role are in by their own statement; everything else has to be taken out
     * of flow before its name counts for anything. */
    const overPage = el.tagName === 'DIALOG' ||
      el.matches('[role="dialog"], [role="alertdialog"]') ||
      cs.position === 'fixed' || cs.position === 'absolute' || cs.position === 'sticky'
    if (el.matches(OVERLAY) && overPage) {
      /* A closed or empty overlay is not a fault. It is a state. */
      const paints = el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
      const holdsContent = el.textContent.trim().length > 0 || el.querySelector('input, button, a, img, svg')
      if (paints && holdsContent) {
        /* The role may be on this element or on the panel inside it: a scrim
           holding a card is the usual shape, and the card is the dialog. */
        const dlg = el.matches('[role="dialog"], [role="alertdialog"], dialog') ? el
          : el.querySelector('[role="dialog"], [role="alertdialog"], dialog')
        if (!dlg) out.other.push({
          el: name(el),
          finding: 'dressed as an overlay and never declares itself a dialog: no '
            + 'role="dialog", no <dialog>. The page behind it stays reachable.',
        })
        /* REPORT ON THE ELEMENT THAT OWNS THE ANSWER, or one fault arrives twice.
         *
         * A scrim holding a card matches by class, and the card inside matches by
         * role, so both were asked whether the DIALOG was named and both said no.
         * The same missing attribute, reported against two elements, and only one
         * of them can carry the fix. The outer box owns one question — is there a
         * dialog in here at all. Everything else belongs to the dialog itself,
         * which this loop reaches on its own. */
        else if (dlg === el) {
          const label = el.getAttribute('aria-label')
          const by = el.getAttribute('aria-labelledby')
          const target = by && by.split(/\s+/).map(id => el.ownerDocument.getElementById(id))
            .find(n => n?.textContent?.trim())
          if (!label?.trim() && !target) out.other.push({
            el: name(el),
            finding: 'a dialog with no accessible name: nothing announces what it '
              + 'is for. Point aria-labelledby at its own heading.',
          })
          /* `aria-modal` only where something says the thing IS modal, on the
             dialog or on the overlay around it. A popover is not modal. */
          const MODALISH = '[class*="modal"], [class*="drawer"], [class*="sheet"]'
          if ((el.matches(MODALISH) || el.closest(MODALISH))
            && el.getAttribute('aria-modal') !== 'true') out.other.push({
            el: name(el),
            finding: 'a modal overlay without aria-modal="true": assistive '
              + 'technology keeps reading the page underneath it.',
          })
        }
      }
    }

    /* ── AN INVALID FIELD THAT DOES NOT POINT AT ITS OWN MESSAGE ──
     *
     * The Form surface already drew inline validation correctly. The wiring a
     * screen reader needs is the half a picture cannot show, so it was absent:
     * one `aria-invalid` across ten surfaces and no `aria-describedby` anywhere.
     *
     * Matched on the DECLARATION rather than on a class. An element saying
     * `aria-invalid="true"` has claimed there is something wrong with it, and
     * the reader is owed the reason. */
    if (el.getAttribute('aria-invalid') === 'true') {
      const by = el.getAttribute('aria-describedby')
      const found = by && by.split(/\s+/).some(id => el.ownerDocument.getElementById(id)?.textContent?.trim())
      if (!found) out.other.push({
        el: name(el),
        finding: 'invalid and silent: aria-invalid with no aria-describedby '
          + 'reaching a message. The reader is told something is wrong and not what.',
      })
    }

    /* ── A PAGER THAT CHANGES THE PAGE AND SAYS NOTHING ──
     *
     * The first version of this matched `[class*="pager"], [class*="pagination"]`
     * and found nothing, on a surface that has a pager. That is the class-list
     * failure again, and it also had the component wrong: it asked for
     * `aria-current="page"` on numbered page buttons, and this system
     * deliberately has none. A run of page numbers cannot state its own width,
     * so it was reduced to two arrows and a count. The check was demanding an
     * attribute for elements the design does not contain.
     *
     * So match the DECLARATION. A control labelled "next page" or "previous
     * page" is a pager step, whatever its class. Fire once, on the first such
     * button in its parent, because a pager has two of them. */
    const pageStep = /\b(next|previous|prev)\s+page\b/i
    if (pageStep.test(el.getAttribute('aria-label') || '')
      && el.getBoundingClientRect().width > 0) {
      const sibs = [...(el.parentElement?.children || [])]
        .filter(c => pageStep.test(c.getAttribute('aria-label') || ''))
      if (sibs[0] === el) {
        /* `disabled` takes the control out of the tab order, so a keyboard
           reader cannot find it to learn it is the first page. `aria-disabled`
           keeps it reachable and still announces the state. */
        const gone = sibs.filter(c => c.hasAttribute('disabled') && c.getAttribute('aria-disabled') !== 'true')
        if (gone.length) out.other.push({
          el: name(gone[0]),
          finding: 'a pager step removed from the tab order: `disabled` hides it, '
            + 'so nobody navigating by keyboard learns which end they are at. '
            + 'Use aria-disabled and keep it reachable.',
        })
        /* The count sentence is what says where you are. If it never announces,
           a page change swaps every row in silence.
         *
         * WALK ANCESTORS, never a selector list. The first version asked
         * `el.closest('nav, .card, [class*="row"]')` and searched that box and
         * its parent. Then I wrapped the two arrows in a `<nav>` to fix a
         * different finding, `closest` matched the new nav instead of the row,
         * and the check lost sight of a live region that had not moved. A scope
         * defined by whichever selector matches first flips whenever the markup
         * it audits is edited. Four levels, bounded, no list. */
        let live = null
        for (let n = el.parentElement, i = 0; n && i < 4 && !live; n = n.parentElement, i++) {
          live = n.querySelector('[role="status"], [aria-live]')
        }
        if (!live) out.other.push({
          el: name(el),
          finding: 'a pager with no live region: the range beside it changes and '
            + 'nothing announces it. Give the count role="status".',
        })
        const nav = el.closest('nav')
        if (!nav?.getAttribute('aria-label') && !nav?.getAttribute('aria-labelledby')) out.other.push({
          el: name(el),
          finding: 'a pager that is not a named landmark: put the steps in a <nav> '
            + 'and name it, so it can be jumped to.',
        })
      }
    }

    /* ── CLIP: CONTENT CUT OFF WITH NO WAY TO REACH IT ──
     *
     * The most expensive layout fault this project has had, and nothing checked
     * it. At a 790px window a pane's action row held 519px of controls that all
     * refused to shrink, and the parent cut off 149px of the app with no
     * scrollbar — no error, no console message, no overflow at the root, and
     * every other measurement reporting a healthy screen.
     *
     * This is not `contentSpill`, which asks whether a CONTROL holds its own
     * label, and it is not the scroller notice, which reports a box that DOES
     * scroll. The question here is whether something is unreachable.
     *
     * Three conditions, and all three are declarations rather than guesses: the
     * box clips on this axis, it does not scroll on this axis, and a child in
     * normal flow crosses its padding box. Out-of-flow children are excluded —
     * an absolutely placed decoration outside its parent is a technique, not a
     * casualty — and so is anything painting nothing. */
    const clipsX = /hidden|clip/.test(cs.overflowX), clipsY = /hidden|clip/.test(cs.overflowY)
    if (clipsX || clipsY) {
      /* Text asked to truncate is clipped ON PURPOSE, and its own box reports
         the overflow. `text-overflow` says so, and so does a line clamp. */
      const truncates = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none'
      /* A BOX COLLAPSED TO NOTHING IS A CLOSED DISCLOSURE, NOT LOST CONTENT.
 *
 * A disclosure closes by clipping its own height to zero, so for one frame
 * it is a clipping box holding mounted children. This check then reported
 * "68px down is cut off" on a fold nobody had opened.
 *
 * The reading is wrong on its own terms. This check exists for content the
 * reader cannot see AND cannot reach; a zero-height box shows nothing at
 * all, so there is no half-visible thing to hunt for. An empty container is
 * the ghost check’s question, and it asks it.
 *
 * It also cannot be waited out. The primitive unmounts its children on a
 * `setTimeout` after the transition, and `getAnimations` never reports a
 * timeout — so a settled reading still lands inside the collapse. */
      const collapsed = el.clientHeight < 1 || el.clientWidth < 1
      /* A SUBTREE MARKED aria-hidden CARRIES NO CONTENT TO REACH. This check
       * is about content a reader cannot get to, and that attribute says the
       * reader was never offered it. A star rating draws its value by laying
       * a filled copy of the five marks over the outlines and clipping it to
       * the value, so the clip IS the reading. Three findings on one correct
       * control, each naming an icon that is a duplicate of the one painted
       * under it.
       *
       * Read the attribute, never a class: it is the declaration that a
       * layer is decoration, and it is what the accessibility tree obeys. */
      const decorative = el.closest('[aria-hidden="true"]') !== null
      if (!truncates && !collapsed && !decorative) {
        const box = el.getBoundingClientRect()
        const padL = box.left + parseFloat(cs.borderLeftWidth || 0)
        const padT = box.top + parseFloat(cs.borderTopWidth || 0)
        const padR = padL + el.clientWidth, padB = padT + el.clientHeight
        let cutX = 0, cutY = 0, victim = null
        for (const c of el.children) {
          if (!seen(c)) continue
          const ccs = getComputedStyle(c)
          if (/absolute|fixed/.test(ccs.position)) continue
          if (parseFloat(ccs.opacity) === 0 || ccs.visibility === 'hidden') continue
          const cr = c.getBoundingClientRect()
          if (!cr.width || !cr.height) continue
          const ox = Math.max(cr.right - padR, padL - cr.left)
          const oy = Math.max(cr.bottom - padB, padT - cr.top)
          if (clipsX && !sx && ox > cutX) { cutX = ox; victim = c }
          if (clipsY && !sy && oy > cutY) { cutY = oy; victim = c }
        }
        if (cutX > 1 || cutY > 1) out.other.push({
          el: name(el),
          finding: `CLIPPED with no way to reach it: `
            + [cutX > 1 ? Math.round(cutX) + 'px across' : null,
               cutY > 1 ? Math.round(cutY) + 'px down' : null].filter(Boolean).join(' and ')
            + ` is cut off — "${(victim?.textContent || '').trim().slice(0, 22) || name(victim)}"`,
        })
      }
    }

    /* Touch targets, judged against the pointer that is actually there.
     *
     * 40px is a finger. A mouse is not a finger, and applying the finger rule
     * to a 1994px desktop reported 25 perfectly good 36px buttons and buried
     * the real findings under them. A rule that fires everywhere tells you
     * nothing about anywhere.
     *
     * Ask the POINTER, and only the pointer. Coarse: 40. Mouse: 24, the point
     * below which a click starts needing aim.
     *
     * This used to fall back to `innerWidth < 768`, and that clause is what
     * made the rule fire everywhere all over again. A narrow WINDOW on a
     * desktop is not a finger. Resizing a browser to 375px to check a layout
     * flipped the floor to 40 and reported 13 perfectly good 24px mouse
     * targets — and I took that to the user as a design decision they needed
     * to make, about controls that were already correct.
     *
     * A width tells you how much room there is. It never tells you what is
     * doing the pointing. */
    /* ── ASK INTERACTIVITY, NOT A TAG LIST ──
     *
     * This named seven shapes and approved everything else. A `select` was not
     * among them, so a dropdown at 38.26px beside a 44px tab was invisible to
     * this check on every run it ever made. Proven by injection: the fault
     * reported zero here and the render verifier reported it.
     *
     * A target is a thing a person aims a finger at, and the platform says
     * which things those are. `tabindex="-1"` is excluded: that is programmatic
     * focus, not a tab stop, and a heading given one is not a target. A LABEL
     * is excluded too, because the wrap rule below already measures it from the
     * input's side, and both would report one control twice.
     *
     * The class fallback stays for the inert samples a preview renders as
     * spans: they carry the component's class and none of its behaviour. */
    const INTERACTIVE = 'button, select, textarea, input, a[href], summary,'
      + ' [tabindex]:not([tabindex="-1"]), [role=button], [role=tab], [role=switch],'
      + ' [role=checkbox], [role=radio], [role=menuitem], [role=option], [role=link]'
    /* ── `.chip` IS A READOUT, AND IT COST 11 OF 13 FINDINGS ──
     *
     * The class fallback is for a sample that carries a CONTROL's class and
     * none of its behaviour. A chip is not a control anywhere in this system.
     * It is a count, a ratio or a tag: "74 entries", "1/1", "12/12". Nothing
     * presses one, and a removable tag carries its own button for the cross.
     *
     * Measured 17 September 2026 in the Components panel: 13 target findings,
     * 11 of them chips. Every one a `<span>` with no role, no tabindex and no
     * handler. 10 sat inside the disclosure button that takes the press. The
     * 2 real findings were buried under them.
     *
     * A chip is 19 to 21px tall by design, so it can never clear a 24px
     * floor. A check that cannot pass on correct code is a check that only
     * produces noise. */
    const SAMPLE = '.btn, .nav-item, .tab, .select-trigger, .checkbox, .switch'
    /* AND A SAMPLE CLASS INSIDE A REAL CONTROL IS ORNAMENT.
     *
     * A control is a LEAF, so whatever it holds is a mark, a label or a
     * chevron rather than a target of its own. The partner rule above says
     * the same thing about a sibling. This says it about a descendant, which
     * a subtree search cannot answer and `closest` can. */
    const ornamentOfControl = !el.matches(INTERACTIVE)
      && el.parentElement && el.parentElement.closest(INTERACTIVE)
    if (!ornamentOfControl && (el.matches(INTERACTIVE) || el.matches(SAMPLE))) {
      const coarse = !!(matchMedia && matchMedia('(pointer: coarse)').matches)
      /* THE MOUSE FLOOR WAS A LITERAL HERE, and the document it measures
         now publishes it. A number the tool holds and the document does
         not is a number nobody can change and a builder will invent.
         Falls back to 24, which is WCAG 2.5.8 at AA. */
      /* READ IT OFF THE ELEMENT, never off the root. An exported build sets
         its tokens on `:root`; an editor hosting a preview sets them on the
         preview scope. A custom property inherits, so the control itself
         answers in both. Asking the root read EMPTY inside a hosted preview,
         which silently restored the literal this change removes. */
      /* AND THE FINGER FLOOR WAS STILL A LITERAL, TWO LINES UNDER THE COMMENT
         SAYING SO. The mouse half was moved to the token and 40 stayed typed
         here, while the document publishes 44 and the render check enforces
         44. So this instrument would have passed a 40px control that the
         other one fails. Read both off the element. */
      const cs = getComputedStyle(el)
      const declaredPointer = parseFloat(cs.getPropertyValue('--target-min-pointer')) || null
      const declaredTouch = parseFloat(cs.getPropertyValue('--target-min')) || null
      const floor = coarse ? (declaredTouch || 44) : (declaredPointer || 24)
      /* A checkbox wrapped in a label is not a 15px target. The label is the
         target — clicking anywhere on it toggles the box — so that is what
         gets measured. Reporting the input sends you shrinking a box that was
         never the thing being aimed at.

         THIS WAS A TAG LIST AND IT APPROVED EVERYTHING NOBODY THOUGHT OF.
         It read `input[type=checkbox], input[type=radio]`, so a text field
         wrapped in a label was measured as itself. Measured on one watchlist:
         a search field inside a 44px label reported 42, and three tag fields
         inside their own labels reported 28. Every one of them is pressed by
         the label around it.

         Ask the DOM instead. `label.control` is the platform's own answer to
         "does this label drive this control", and it covers every labellable
         element there will ever be. */
      const labelled = el.closest('label')
      const wrap = labelled && labelled.control === el ? labelled : null

      /* ── A DRAWN BOX IS NOT A TARGET WHEN A TRANSPARENT CONTROL COVERS IT ──
       *
       * The pattern this system ships: the box is drawn at 16 and the switch
       * track at 24, both deliberately, and a transparent input stretched over
       * the host is what a finger presses. Both halves defeated this check.
       * The ornament is small, so widening the matcher reported 23 correct
       * controls at once. And the real target is `opacity: 0`, so the paint
       * filter above had already dropped it — one filter serving two questions.
       *
       * A PARTNER CONTROL IS A SIBLING, never anything a subtree search can
       * reach. An earlier check asked `parentElement.querySelector` and found
       * one of eleven unrelated inputs elsewhere on the screen.
       *
       * So an ornament defers to its partner and a partner speaks for itself,
       * which reports each control once. */
      const invisible = n => { const s = getComputedStyle(n)
        return s.opacity === '0' || s.visibility === 'hidden' }
      const partnerOf = n => {
        const kin = n.parentElement ? n.parentElement.children : []
        for (const sib of kin) {
          if (sib === n) continue
          if (!sib.matches('input, select, button, textarea')) continue
          if (!invisible(sib)) continue
          return sib
        }
        return null
      }
      /* A transparent control IS the target, so it never defers. Its ornament
         hands the measurement to it, and this branch would report it twice. */
      const partner = invisible(el) ? null : partnerOf(el)
      if (invisible(el) && !el.matches('input, select, button, textarea')) continue
      /* ── A TRANSPARENT CONTROL THAT TAKES NO POINTER IS NOT A TARGET ──
       *
       * The branch above keeps a transparent input, because a control
       * stretched over its host IS the thing a finger presses. A HIDDEN
       * PICKER is the opposite shape and reads identically: a file input at
       * `opacity: 0` with a visible button driving it.
       *
       * The discriminator is a declaration. A stretched control takes pointer
       * events; a hidden picker sets `pointer-events: none` and is opened by
       * script. Nothing a pointer cannot reach is a target.
       *
       * Measured 17 September 2026 across this chrome: 4 findings, all one
       * file input. It declares `width: 1px; height: 1px` inline and Chrome
       * lays its box out at 26 x 18 regardless, so the number reported was
       * not even the one in the markup. */
      if (invisible(el) && getComputedStyle(el).pointerEvents === 'none') continue
      const target = wrap || partner || el
      /* BOTH AXES. This measured the height alone, so the fault that arrived
         today was invisible to it: an icon-only button 28 wide by 44 tall,
         because a stated width defeated its own aspect ratio while the touch
         promotion raised the height. A target is a region a finger has to
         land in, and it is as small as its smaller side. */
      /* ── AN OVERHANG IS NOT A HEIGHT ──
       *
       * A control reaches the floor with an absolutely positioned pseudo
       * element at a negative inset. That costs no layout, which is the whole
       * point: the drawn box stays small on purpose and the target is bigger
       * than the rectangle. Measured on one watchlist: a 28px tag field whose
       * label overhangs by 8px each side hit-tests at 44.5px.
       *
       * Read the DECLARATION, not the geometry. A hit test needs the element
       * on screen, and scrolling to it would mutate the page the tool is
       * measuring.
       *
       * The inset only means this when the pseudo's containing block IS the
       * target, so the target has to be positioned itself. Against any other
       * containing block the number describes a different box. */
      const overhangOf = (node) => {
        const zero = { top: 0, right: 0, bottom: 0, left: 0 }
        if (getComputedStyle(node).position === 'static') return zero
        const out2 = { ...zero }
        for (const pseudo of ['::after', '::before']) {
          const ps = getComputedStyle(node, pseudo)
          if (!ps || ps.content === 'none' || !/absolute|fixed/.test(ps.position)) continue
          const neg = v => { const n = parseFloat(v); return Number.isFinite(n) && n < 0 ? -n : 0 }
          out2.top = Math.max(out2.top, neg(ps.top))
          out2.bottom = Math.max(out2.bottom, neg(ps.bottom))
          out2.left = Math.max(out2.left, neg(ps.left))
          out2.right = Math.max(out2.right, neg(ps.right))
        }
        return out2
      }

      /* ── AND THE REACH MAY SIT ON A WRAPPER, WHICH IS NOT OPTIONAL ──
       *
       * A pseudo-element does not generate on a default-appearance checkbox,
       * so the only place its reach can live is the element around it. That
       * wrapper then IS the target, the same way a `label` is when it drives
       * the control.
       *
       * Measured 17 September 2026: a 16px checkbox inside a `span` carrying
       * an `::after` at a -4px inset. The check read the input's own pseudo,
       * found none, and reported 16 x 16 against a 24px floor while the
       * target measured 24 x 24.
       *
       * Bounded to the PARENT, and it must be a wrapper rather than a row:
       * the reach has to cover the element it wraps, so the parent's own box
       * may not be bigger than the floor on either axis. A `space-between`
       * row holding a 44px overhang is the fault that shape produces, and it
       * spanned a label at the far end of the row. */
      const reachWrapper = (node) => {
        const p = node.parentElement
        if (!p) return null
        const pr = p.getBoundingClientRect(), nr = node.getBoundingClientRect()
        const o = overhangOf(p)
        if (!(o.top || o.bottom || o.left || o.right)) return null
        if (pr.width > nr.width + 2 || pr.height > nr.height + 2) return null
        return p
      }

      /* ── A TARGET INLINE IN A SENTENCE IS EXEMPT ──
       *
       * 2.5.8 excepts a target whose position is determined by the flow of
       * text. A link inside a paragraph cannot take a 24px box without
       * opening the line it sits in, and padding it would change the leading
       * of the prose around it. Ask the property: it computes to `inline`,
       * and its container holds text that is not the link. */
      const inlineInProse = () => {
        if (!el.matches('a[href]')) return false
        if (!/^inline$/.test(getComputedStyle(el).display) ) return false
        const host = el.parentElement
        if (!host) return false
        return host.textContent.trim().length > el.textContent.trim().length
      }

      /* The wrapper is resolved here rather than beside `wrap`, because it
         needs `overhangOf`, which is declared below that line. */
      const sleeve = wrap || partner ? null : reachWrapper(el)
      const measuredOn = sleeve || target
      const box = measuredOn.getBoundingClientRect()
      const over = overhangOf(measuredOn)
      const h = box.height + over.top + over.bottom
      const w = box.width + over.left + over.right
      const reached = over.top || over.bottom || over.left || over.right
      if ((h < floor || w < floor) && !inlineInProse()) out.smallTargets.push({ el: name(measuredOn),
                                             w: Math.round(w), h: Math.round(h), floor,
                                             axis: h < floor && w < floor ? 'both' : (h < floor ? 'height' : 'width'),
                                             for: coarse ? 'touch' : 'mouse',
                                             measured: wrap ? (reached ? 'the label around it, plus its overhang' : 'the label around it')
                                                            : sleeve ? 'the wrapper carrying its reach'
                                                            : (reached ? 'itself, plus its overhang' : 'itself') })
    }
  }


  /* ── AN AUTO MARGIN ON A GROWING BOX MOVES THE BOX, NOT THE CONTENT ──
   *
   * They caught this in a screenshot while every check here reported clean.
   * A header's action group carried `margin-inline-start: auto` AND a
   * `flex: 1 1 auto` it inherited from a class it shares with a selection bar.
   * So the box grew to fill the row, the auto margin resolved to 0px, and the
   * buttons packed at the box's own start edge.
   *
   * Measured on the dashboard: the group's box ran 1331 to 1941 and touched the
   * row's end, so a box-based check saw a group flush against it. Its buttons
   * sat 610px short of that edge.
   *
   * ASK THE CONTENT, NEVER THE BOX. The whole point of an auto margin is to
   * move what is INSIDE it, so the box reaching the end proves nothing. This is
   * the ink-versus-wrapper rule pointed at a container.
   *
   * A growing box is not a fault on its own. A search field is meant to fill
   * its row. It is a fault only when the same box ALSO has an auto margin in
   * force, because those two instructions contradict each other.
   *
   * ── AND "IN FORCE" IS NOT "DECLARED SOMEWHERE" ──
   *
   * The first version asked `declaresAuto`, which answers whether ANY matching
   * rule says auto. A responsive block setting the margin to 0 left the element
   * in that set, so this faulted correct code and printed a reason naming a
   * margin nothing was using. `autoInForce` resolves the cascade instead.
   *
   * The check below it asks a different question — a row that took a line and
   * left it empty — and the two cannot double-report: a box whose auto margin
   * is in force is by definition not the box that spans its whole line. */
  for (const el of all) {
    const acs = getComputedStyle(el)
    if (!acs.display.includes('flex') || acs.flexDirection !== 'row') continue
    if (parseFloat(acs.flexGrow) <= 0) continue
    if (!autoInForce(el, 'margin-left') && !autoInForce(el, 'margin-right')) continue
    const abox = el.getBoundingClientRect()
    const contentRight = abox.right - parseFloat(acs.borderRightWidth || 0) - parseFloat(acs.paddingRight || 0)
    /* Flatten a dissolved wrapper BEFORE filtering for paint, never after.
       `display: contents` generates no box, so a visibility filter drops the
       wrapper and everything inside it with it. The first version of this
       filtered first and reported nothing on an injected fault, because both
       children were dissolved pair wrappers. That is the `display: contents`
       blind spot inside the check written to avoid it. */
    const aInk = []
    for (const c of el.children) {
      if (getComputedStyle(c).display === 'contents') { aInk.push(...c.children); continue }
      aInk.push(c)
    }
    const aPaint = aInk.filter(seen).filter(c => !/absolute|fixed/.test(getComputedStyle(c).position))
    if (!aPaint.length) continue
    const short = contentRight - Math.max(...aPaint.map(c => c.getBoundingClientRect().right))
    if (short > 1) out.other.push({
      el: name(el),
      finding: 'has an auto margin AND grows, so the box reached the row\'s end while its '
        + 'content stopped ' + Math.round(short) + 'px short of it. An auto margin on a '
        + 'growing box resolves to zero and moves nothing. Give the box flex-grow 0, or put '
        + 'the auto margin on the thing that has to shift',
    })
  }

  /* ── A ROW TOLD TO TAKE THE LINE MUST USE THE LINE ──
   *
   * They found this in a screenshot while every check here reported clean.
   * Their words: "they are supposed to span the entire width!"
   *
   * The first version asked about the MECHANISM. It matched an auto margin on a
   * growing box, which was the shape of the one instance in front of me. A
   * mechanism question is always wrong in both directions, and this one was
   * wrong in both directions at once.
   *
   * It FAULTED correct code. `declaresAuto` reads the declaration set and never
   * resolves the cascade, so a responsive rule setting margin-left to 0 still
   * counted as an auto margin. The printed reason named a margin overridden two
   * hundred lines earlier.
   *
   * It also MISSED the other half. It sat inside `isRow`, which needs two
   * children, so a header holding one control never reached it. Measured at
   * 768px: one surface left 433px empty with the wrong reason, and its
   * neighbour left 498px empty and reported nothing.
   *
   * Ask the FAULT instead. Three parts, no mechanism in any of them:
   *
   *   1. The box was TOLD to take the line. An auto margin, a 100% basis or a
   *      positive grow. One instruction in three spellings.
   *   2. It took it, so its width is the parent's content box.
   *   3. Its content leaves more of that line empty than full.
   *
   * A hole larger than the content is not a judgement about taste. It says the
   * instruction bought nothing, and the element asked for it itself.
   *
   * Every child must be a CONTROL, or this is prose, and left-aligned prose is
   * correct. That guard is what keeps it off headings and paragraphs. */
  for (const el of all) {
    const lcs = getComputedStyle(el)
    if (!lcs.display.includes('flex') || lcs.flexDirection !== 'row') continue
    const parent = el.parentElement
    if (!parent) continue

    /* FLATTEN A DISSOLVED WRAPPER FIRST, never after filtering for paint.
       `display: contents` generates no box, so a visibility filter drops the
       wrapper and everything inside it. The pair-wrap pattern DEPENDS on that
       shape, so it is the structure correct code produces. */
    const lInk = []
    for (const c of el.children) {
      if (getComputedStyle(c).display === 'contents') { lInk.push(...c.children); continue }
      lInk.push(c)
    }
    const lPaint = lInk.filter(seen)
      .filter(c => !/absolute|fixed/.test(getComputedStyle(c).position))
    if (!lPaint.length) continue
    if (!lPaint.every(isControlEl)) continue

    /* 1. THE INSTRUCTION. */
    const told = declaresAuto(el, 'margin-left') || declaresAuto(el, 'margin-right')
      || lcs.flexBasis === '100%' || parseFloat(lcs.flexGrow) > 0
    if (!told) continue

    /* 2. IT TOOK THE LINE. Against the parent CONTENT box, never its border
       box: a parent with 24px of padding otherwise reports a child that fills
       its line as 48px short of it. */
    const pcs = getComputedStyle(parent)
    const pbox = parent.getBoundingClientRect()
    const lineL = pbox.left + parseFloat(pcs.paddingLeft || 0) + parseFloat(pcs.borderLeftWidth || 0)
    const lineR = pbox.right - parseFloat(pcs.paddingRight || 0) - parseFloat(pcs.borderRightWidth || 0)
    const lineW = lineR - lineL
    const lbox = el.getBoundingClientRect()
    if (lineW <= 0 || lbox.width < lineW * 0.95) continue

    /* 3. THE HOLE. Measured against the element's CONTENT box, so its own
       padding is not counted as emptiness. Take the union of what paints, and
       round ONCE at the end — four values rounded separately manufacture whole
       pixels out of tenths. */
    const cL = lbox.left + parseFloat(lcs.paddingLeft || 0) + parseFloat(lcs.borderLeftWidth || 0)
    const cR = lbox.right - parseFloat(lcs.paddingRight || 0) - parseFloat(lcs.borderRightWidth || 0)
    const inkL = Math.min(...lPaint.map(c => c.getBoundingClientRect().left))
    const inkR = Math.max(...lPaint.map(c => c.getBoundingClientRect().right))
    const filled = inkR - inkL
    const hole = (cR - cL) - filled
    if (hole <= filled) continue

    const side = (inkL - cL) > (cR - inkR) ? 'start' : 'end'
    out.other.push({
      el: name(el),
      finding: 'asked for the whole line and left it empty. '
        + lPaint.length + ' control(s), ' + Math.round(lbox.width) + 'px taken, '
        + Math.round(filled) + 'px filled, ' + Math.round(hole)
        + 'px empty at the ' + side
        + '. A row alone on its line covers that line: pair the controls, or let '
        + 'the last labelled one absorb the slack',
    })
  }


  /* A control's own content fits inside it.
   *
   * This is the check that was missing when it mattered. A CSS rule squashed
   * "Reset to defaults" into a 36px box holding 121px of label, and the sweep
   * said the screen was clean — because the only overflow question it asked
   * was whether anything stuck out of the ROOT, and an 87px spill inside a
   * button never reaches the root.
   *
   * Controls only, plus anything that clips. On an `overflow: visible`
   * container a child may stick out on purpose, and asking there would report
   * every decoration. On a button it is always a fault. */
  for (const el of all) {
    const cs2 = getComputedStyle(el)
    const scrolls = /auto|scroll/.test(cs2.overflowX + ' ' + cs2.overflowY)
    if (scrolls) continue
    const control = el.matches('button, .btn, .badge, .chip, .seg, .seg-on, input, select, .nav-item, summary, label, a')
    const clips = /hidden|clip/.test(cs2.overflowX + ' ' + cs2.overflowY)
    if (!control && !clips) continue
    if (!(el.textContent || '').trim()) continue
    /* A screen-reader label is a 1x1 clipped box holding a whole word, which
       is a spill by the arithmetic and correct by design. `_hidden` already
       knows that shape. */
    if (_hidden(el)) continue
    /* ── MEASURE WHAT PAINTS, NOT WHAT SCROLLS ──
     *
     * `scrollWidth`/`scrollHeight` answered a different question than this check
     * asks, in two ways, and both were found the same afternoon.
     *
     * It counts a child that paints NOTHING. Enlarging a hit area means
     * stretching a transparent input past the box it belongs to — the standard
     * way to give a 16px checkbox a 44px target without moving anything. Six
     * correct controls across four surfaces were faulted for exactly that
     * overhang, 8px down each.
     *
     * It also counts one direction only. Content that overflows ABOVE the box
     * never appears in `scrollHeight`, so a centred label crushed into a short
     * box spills both ways and the arithmetic sees about half of it.
     *
     * Subtracting the overhang was tried first and it was a BLINDFOLD: the real
     * spill was 6px, the overhang was 8, and one cancelled the other. The
     * injected fault came back clean. So do not adjust the wrong number —
     * measure the right one. Take the union of what actually paints and compare
     * it to the padding box.
     *
     * Direct text counts, and it is the case this check exists for: a 121px
     * label crushed into a 36px button is a TEXT NODE with no child element at
     * all. A Range gives it a rectangle. */
    const pad = el.getBoundingClientRect()
    const padTop = pad.top + el.clientTop, padLeft = pad.left + el.clientLeft
    const padBottom = padTop + el.clientHeight, padRight = padLeft + el.clientWidth
    let inkTop = Infinity, inkLeft = Infinity, inkBottom = -Infinity, inkRight = -Infinity
    const take = r => {
      if (!r || (!r.width && !r.height)) return
      inkTop = Math.min(inkTop, r.top); inkLeft = Math.min(inkLeft, r.left)
      inkBottom = Math.max(inkBottom, r.bottom); inkRight = Math.max(inkRight, r.right)
    }
    for (const c of el.children) {
      const ccs = getComputedStyle(c)
      /* Out of flow AND painting nothing. Either alone is not enough: an
         absolutely placed icon that paints is content, and an opacity-0 child
         still in flow occupies space the box has to hold. */
      if (/absolute|fixed/.test(ccs.position)
          && (parseFloat(ccs.opacity) === 0 || ccs.visibility === 'hidden')) continue
      take(c.getBoundingClientRect())
    }
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue
      const rng = el.ownerDocument.createRange()
      rng.selectNodeContents(n)
      take(rng.getBoundingClientRect())
    }
    if (inkBottom === -Infinity) continue          // nothing paints, nothing to spill
    /* A COLLAPSED BOX SHOWS NOTHING, so nothing is spilling out of it. A
       disclosure closes by clipping its height to zero, and for one frame it is
       a zero-height box holding mounted children. Reported as a 68px spill on a
       fold nobody had opened. The same exemption as the clipped-content check,
       for the same reason, and it cannot be waited out: the primitive unmounts
       on a timeout, which `getAnimations` never reports. */
    if (el.clientHeight < 1 || el.clientWidth < 1) continue
    /* ── TEXT ASKED TO TRUNCATE IS CLIPPED ON PURPOSE ──
     *
     * `text-overflow: ellipsis` is a DECLARATION that the ink runs past the
     * box and that the box will cut it. The reader sees the ellipsis, which
     * is the affordance saying so. A Range still reports the unclipped
     * geometry, so the ink measures wider than the box by design.
     *
     * Measured on one watchlist: three video titles reported 52, 117 and
     * 318px of spill while every one rendered a correct ellipsis, and the
     * element declared overflow:hidden with text-overflow:ellipsis.
     *
     * Narrowed to the INLINE axis, because text-overflow acts on that axis
     * alone. A label crushed into a short box still spills upward and
     * downward, and that is the fault this check exists for. */
    const spillCs = getComputedStyle(el)
    const truncating = spillCs.textOverflow === 'ellipsis'
      && spillCs.overflowX !== 'visible'
    const overX = truncating ? 0 : Math.max(inkRight - padRight, padLeft - inkLeft)
    const overY = Math.max(inkBottom - padBottom, padTop - inkTop)
    if (overX > 1 || overY > 1) out.contentSpill.push({
      el: name(el), text: (el.textContent || '').trim().slice(0, 18),
      /* `spills` names the AXIS and the amount, because the overflow can now be
         upward or leftward and "spillsDown: 8" would be a lie about direction.
         The old pair of keys could only ever say right and down. */
      spillsX: overX > 1 ? Math.round(overX) : 0,
      spillsY: overY > 1 ? Math.round(overY) : 0,
      where: [inkTop < padTop - 1 ? 'above' : null, inkBottom > padBottom + 1 ? 'below' : null,
              inkLeft < padLeft - 1 ? 'left' : null, inkRight > padRight + 1 ? 'right' : null]
        .filter(Boolean).join('+'),
      box: Math.round(el.clientWidth) + 'x' + Math.round(el.clientHeight),
      /* The union of what PAINTS, so the number is actionable — `scrollHeight`
         counted a transparent overhang and missed everything above the box. */
      ink: Math.round(inkRight - inkLeft) + 'x' + Math.round(inkBottom - inkTop),
    })
  }

  /* Nothing sticks out of the root — judged on what is visible.
     A folded nav keeps full-size rects while clipped to nothing, and reported
     its call to action 83px past the frame. Nobody could see any of it. */
  const box = root.getBoundingClientRect()
  for (const el of all) {
    const vis = _visibleBox(el)
    if (vis.width < 1 || vis.height < 1) continue
    const over = vis.right - box.right
    if (over > 1 && !el.closest('.table-scroll, .matrix, [data-scrolls]'))
      out.overflow.push({ el: name(el), over: Math.round(over) })
  }

  const counts = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]))
  /* Ghosts count double in spirit: a layout fault is ugly, an invisible
     element is missing. They are listed first for the same reason. */
  const total = counts.ghosts + counts.covered + counts.baselines + counts.heights + counts.tops
    + counts.edges + counts.overflow + counts.contentSpill + counts.textOffCentre
    + counts.iconOffCentre + counts.other
  /* ── A LIST THAT TRUNCATES MUST SAY SO ──
   *
   * Every category below is sliced, and for a long time nothing said so. The
   * summary read `other: 68` while the array held 6, so 62 findings were
   * invisible to any caller reading the list — which is how a chrome sweep
   * came within one sentence of being reported as six findings when it had
   * sixty-eight. A report that claims a completeness it does not have is
   * worse than a long one.
   *
   * The same fault was fixed once in the multi-surface report and left here,
   * which is the instance-not-class failure in my own instrument. */
  const omitted = Object.entries(counts)
    .map(([k, n]) => {
      const cap = { tops: 5, baselines: 5, heights: 5, edges: 5, gaps: 4, overflow: 5,
        textOffCentre: 5, scrollers: 5, smallTargets: 5 }[k] || 6
      return n > cap ? k + ': ' + (n - cap) + ' more not listed' : null
    })
    .filter(Boolean)
  return {
    /* A RUN WHOSE OWN PREDICATES FAILED IS NOT CLEAN. The ghost pass is
       narrowed by two state questions, and a narrowing that stops matching
       goes quiet rather than loud. So a failed proof withdraws the verdict
       instead of sitting beside it, where a caller reading `clean` would
       never see it. */
    clean: total === 0 && ghostProof.pass,
    /* Present only when a fixture disagreed with the pass, so a clean run
       says nothing about it. */
    ...(ghostProof.pass ? {} : { ghostPassBroken: ghostProof.failed }),
    /* Present only when the selector was ambiguous. A caller that ignores it
       is measuring a surface it did not choose. */
    ...(ambiguous ? { ambiguous } : {}),
    ...(omitted.length ? { truncated: omitted } : {}),
    /* ── AND THE CALLER STILL NEEDS TO SEE WHAT WAS CUT ──
     *
     * The notice above says how many are missing. It does not say what they
     * are. Reading the sliced window cost three wrong conclusions in one
     * session, including "the check does not fire" about a check that fires:
     * the finding sat at position seven. A grouped tally is complete AND
     * short, which a longer list would not be.
     *
     * EVERY SLICED CATEGORY, NOT JUST `other`. Written for `other` alone and
     * left there, so a charts surface reported 4 gaps of 27 with a notice
     * saying 23 were missing and no way to see what they were. That is the
     * third time this same fix has been made in this one instrument, one
     * category at a time. The generalisation is the fix; another per-category
     * copy would have been the fault again.
     */
    byClass: Object.fromEntries(Object.entries(out)
      .filter(([, arr]) => Array.isArray(arr) && arr.length)
      .map(([cat, arr]) => {
        const g = {}
        for (const f of arr) {
          const key = String(f && (f.finding ?? f.row) ? (f.finding ?? f.row) : JSON.stringify(f))
            .replace(/-?[0-9][0-9.]*/g, 'N').slice(0, 72)
          g[key] = (g[key] || 0) + 1
        }
        return [cat, Object.entries(g).map(([finding, n]) => ({ n, finding }))
          .sort((a, b) => b.n - a.n)]
      })),
    counts,
    ghosts: out.ghosts.slice(0, 6),
    covered: out.covered.slice(0, 6),
    /* Listed high: a label that does not fit its own button is not a polish
       item, it is a broken control. */
    contentSpill: out.contentSpill.slice(0, 6),
    iconOffCentre: out.iconOffCentre.slice(0, 6),
    other: out.other.slice(0, 6),
    tops: out.tops.slice(0, 5),
    baselines: out.baselines.slice(0, 5),
    heights: out.heights.slice(0, 5),
    edges: out.edges.slice(0, 5),
    gaps: out.gaps.slice(0, 4),
    overflow: out.overflow.slice(0, 5),
    textOffCentre: out.textOffCentre.slice(0, 5),
    scrollers: out.scrollers.slice(0, 5),
    smallTargets: out.smallTargets.slice(0, 5),
  }
}

/* ── Width sweep: the fault that is correct at one width and wrong at another ──
 *
 * Every check above measures the width the browser happens to be at. A control
 * sized by a constant looks right on a desktop and wrong on a phone, and one
 * sized by the touch breakpoint alone does the reverse. Both pass a sweep run
 * once. Both shipped here — a header mark stayed 36 while every button beside
 * it was promoted to 40, and the fix for that then made it 40 on a desktop
 * where the buttons are 36. Fixing one width and breaking the other is the
 * same defect twice, and no single-width check can see it.
 *
 * Usage, driving the window from outside:
 *
 *   resize(375);  atWidth('phone')
 *   resize(1440); atWidth('desktop')
 *   widthReport()
 *
 * `widthReport` answers two questions a single sweep cannot:
 *   1. Which findings exist at one width and not another.
 *   2. Which ROWS have members that changed height while their neighbours did
 *      not. That second one is the real detector. A row is a set of objects
 *      that belong together; if the breakpoint moved some of them and left the
 *      others behind, the row was never the unit the rule was written against.
 */
const _widthSnaps = new Map()

function _rowShapes (within = null) {
  const root = within ? document.querySelector(within) : document.body
  if (!root) return {}

  /* Band by what LOOKS like a row, not by who shares a parent.
   *
   * Grouping by DOM parent was the first attempt and it missed the fault it
   * was written for. A header mark and the buttons beside it sit in two
   * different flex containers — the mark with the wordmark, the buttons in
   * their own scroller — so no parent held both, and the one thing a reader
   * sees as a single row was never compared as one. What it caught instead was
   * an icon inside a button: technically a row, and not the unit anybody
   * aligns by eye.
   *
   * A row is a set of objects that share a horizontal band. That is the
   * definition the eye uses and the only one that survives the markup. */
  const cands = []
  root.querySelectorAll('*').forEach(el => {
    if (_hidden(el)) return
    const cs = getComputedStyle(el)
    const bg = cs.backgroundColor || ''
    const painted = bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)
    const bordered = ['Top', 'Right', 'Bottom', 'Left']
      .some(s => (parseFloat(cs['border' + s + 'Width']) || 0) > 0 && cs['border' + s + 'Style'] !== 'none')
    const isControl = /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(el.tagName)
    if (!(painted || bordered || isControl)) return
    const r = _visibleBox(el)
    if (r.width < 8 || r.height < 8) return
    cands.push({ el, r })
  })

  /* Keep the outermost painted object of each nest. An icon inside a button
     is part of the button, not another member of the row. */
  const outer = cands.filter(c => !cands.some(o => o.el !== c.el && o.el.contains(c.el)))

  /* Sort by top, then walk. Two objects are on one band when their vertical
     ranges overlap by more than a quarter of the shorter one — the same
     threshold the ink checks use, and enough to keep a 44px button and a 36px
     one on the same line while a stacked pair stays apart. */
  outer.sort((a, b) => a.r.top - b.r.top)
  const bands = []
  for (const c of outer) {
    const band = bands.find(bd => {
      const top = Math.max(bd.top, c.r.top), bot = Math.min(bd.bottom, c.r.bottom)
      return (bot - top) > 0.25 * Math.min(bd.bottom - bd.top, c.r.height)
    })
    if (band) {
      band.top = Math.min(band.top, c.r.top)
      band.bottom = Math.max(band.bottom, c.r.bottom)
      band.items.push(c)
    } else {
      bands.push({ top: c.r.top, bottom: c.r.bottom, items: [c] })
    }
  }

  /* Heights AND text baselines.
   *
   * The first version of this recorded heights only, and heights are the half
   * that gets noticed. A title bar passed it at both widths while five font
   * sizes sat on five different lines, because every box was still 36px — the
   * boxes were fine and the words were not. Baselines are the thing this
   * project keeps breaking, so they are the thing to carry across widths. */
  const rows = {}
  bands.filter(bd => bd.items.length > 1).forEach((bd, i) => {
    rows['band' + i] = bd.items.map(c => ({
      name: _name(c.el, 22),
      h: Math.round(c.r.height * 100) / 100,
      baseline: _textBaseline(c.el),
    }))
  })
  return rows
}

/* The real baseline of an element's first run of text.
 *
 * A Range bottom is the descender edge, not the baseline: it grows with the
 * font size, so two correct sizes on one line report a gap that is not there.
 * Canvas ascent gives the real number. Returns null where there is no visible
 * text, which is not a failure — a square with an icon in it has no baseline
 * to offer, and `_hidden` keeps clipped screen-reader labels out. */
function _textBaseline (el) {
  if (_hidden(el)) return null
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walk.nextNode())) if (node.textContent.trim()) break
  if (!node) return null
  const owner = node.parentElement
  if (!owner || _hidden(owner)) return null
  const range = document.createRange()
  range.selectNodeContents(node)
  const box = range.getBoundingClientRect()
  if (!box.height) return null
  const cs = getComputedStyle(owner)
  const ctx = (_textBaseline._ctx ||= document.createElement('canvas').getContext('2d'))
  ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily
  const m = ctx.measureText(node.textContent.trim())
  return Math.round((box.top + m.fontBoundingBoxAscent) * 100) / 100
}

function atWidth (label, within = null) {
  _widthSnaps.set(label, {
    vw: window.innerWidth,
    findings: sweep(within),
    rows: _rowShapes(within),
  })
  return label + ' captured at ' + window.innerWidth + 'px'
}

function widthReport () {
  const labels = [..._widthSnaps.keys()]
  if (labels.length < 2) return { error: 'need at least two atWidth() captures' }

  /* 1. A finding present at one width and absent at another. */
  const bucket = l => {
    const f = _widthSnaps.get(l).findings
    const ids = []
    for (const [k, v] of Object.entries(f)) {
      if (!Array.isArray(v)) continue
      v.forEach(item => ids.push(k + ':' + (item.el || item.row || item.name || JSON.stringify(item).slice(0, 40))))
    }
    return new Set(ids)
  }
  const sets = Object.fromEntries(labels.map(l => [l, bucket(l)]))
  const every = new Set(labels.flatMap(l => [...sets[l]]))
  const onlySome = [...every]
    .map(id => ({ id, at: labels.filter(l => sets[l].has(id)) }))
    .filter(x => x.at.length && x.at.length < labels.length)

  /* 2. The real detector. A row whose members did not move together. */
  const brokenStep = []
  const rowKeys = new Set(labels.flatMap(l => Object.keys(_widthSnaps.get(l).rows)))
  for (const key of rowKeys) {
    const perLabel = labels.map(l => ({ l, kids: _widthSnaps.get(l).rows[key] })).filter(x => x.kids)
    if (perLabel.length < 2) continue

    /* Match members by name, not by index. A band gains and loses members
       between widths — a wordmark hides on a phone — and comparing position 2
       against position 2 then measures two different objects. Only the members
       present at both widths can say anything. */
    const a = perLabel[0], b = perLabel[perLabel.length - 1]
    const mapB = new Map(b.kids.map(k => [k.name, k.h]))
    const common = a.kids.filter(k => mapB.has(k.name))
    if (common.length < 2) continue

    const moved = common.map(k => Math.abs(k.h - mapB.get(k.name)) > 0.5)
    if (moved.some(Boolean) && moved.some(x => !x)) {
      brokenStep.push({
        row: key,
        moved: common.filter((_, i) => moved[i]).map(k => k.name + ' ' + k.h + '→' + mapB.get(k.name)),
        stayed: common.filter((_, i) => !moved[i]).map(k => k.name + ' ' + k.h),
        widths: a.l + ' → ' + b.l,
        note: 'These share a horizontal band. Some changed height between the two widths and the rest did not, so whatever moved them was not written against the row.',
      })
    }
  }

  /* 3. A row whose text baselines agree at one width and not at another.
   *
   * The height check above cannot see this. Every box can keep its size while
   * the words inside them move onto different lines — which is exactly what
   * happened when a header was switched from baseline to centre: eleven runs
   * of text, five sizes, five lines, and not one box changed by a pixel. */
  const brokenBaselines = []
  for (const key of rowKeys) {
    const perLabel = labels
      .map(l => ({ l, kids: (_widthSnaps.get(l).rows[key] || []).filter(k => k.baseline != null) }))
      .filter(x => x.kids.length > 1)
    if (perLabel.length < 2) continue
    const state = perLabel.map(x => ({
      l: x.l,
      spread: Math.round((Math.max(...x.kids.map(k => k.baseline)) - Math.min(...x.kids.map(k => k.baseline))) * 100) / 100,
      items: x.kids.map(k => k.name + ' @' + k.baseline),
    }))
    /* Half a pixel is where the eye stops and the arithmetic starts. */
    const agree = state.map(s => s.spread <= 0.5)
    if (agree.some(Boolean) && agree.some(x => !x)) {
      brokenBaselines.push({
        row: key,
        agreesAt: state.filter((_, i) => agree[i]).map(s => s.l + ' (spread ' + s.spread + ')'),
        breaksAt: state.filter((_, i) => !agree[i]).map(s => s.l + ' (spread ' + s.spread + ') ' + s.items.join(', ')),
        note: 'The text on this row shares a line at one width and not at another. Box heights can be identical throughout.',
      })
    }
  }

  return {
    widths: labels.map(l => l + '=' + _widthSnaps.get(l).vw + 'px'),
    clean: onlySome.length === 0 && brokenStep.length === 0 && brokenBaselines.length === 0,
    /* Listed with the rows: baselines are what this project breaks most, and
       they are invisible to every height comparison. */
    rowsWhoseTextLeftTheLine: brokenBaselines.slice(0, 8),
    /* Listed first: a row that did not move as one is the fault this exists
       for, and it is invisible to every check that runs at a single width. */
    rowsThatDidNotMoveTogether: brokenStep.slice(0, 8),
    findingsAtSomeWidthsOnly: onlySome.slice(0, 12),
  }
}

/* ── verify: the whole gate, in one call ──
 *
 * Not a new check. Every part of this already existed and I kept running some
 * of them and not others, which is the same as running none — the one I skipped
 * was always where the defect was. Written after a session where I knew each
 * rule, could quote each rule, and broke four of them in a row:
 *
 *   - hand-wrote a probe instead of calling the tool, and the probe reported a
 *     screen-reader label as a baseline fault, which `_hidden` has handled for
 *     months
 *   - changed a row's alignment and did not re-measure that row
 *   - fixed one width and shipped the other broken, three times on one square
 *   - sent the syntax guard to /dev/null and read the silence as a pass
 *
 * Their verdict was exact: "it's not like you don't know what you're doing.
 * you just need to do it consistently, and keep checking." So the answer is not
 * another rule. It is one entry point with nothing to leave out.
 *
 *   await verify('header')                 // this width only
 *   await verify('header', ['desktop'])    // name it, then resize and repeat
 *
 * Call it a second time after resizing and it compares the two automatically.
 */
async function verify (within = null, label = null) {
  /* A FROZEN PAGE CAN BE FROZEN MID-ENTRANCE, AND THEN THE TRANSIENT READING
     BECOMES PERMANENT. A surface stopped at 40% opacity reports ghosts and
     covered elements that a live page would have resolved a frame later. That
     is the fault this whole section exists to prevent, held still. So the
     verdict is withdrawn rather than printed beside a warning. */
  const framesRun = await settle()
  const sweepResult = sweep(within)
  const name = label || ('w' + window.innerWidth)
  atWidth(name, within)

  const arrangement = rowFaults(within)
  const across = _widthSnaps.size > 1 ? widthReport() : null
  const counts = sweepResult.counts || {}
  /* `scrollers` lists the regions that scroll. That is context, not a fault —
     a preview pane SHOULD scroll, and a tab strip SHOULD scroll sideways.
     Counted towards the verdict it made `pass` unreachable on a healthy app,
     which is a gate nobody can use. */
  const total = Object.entries(counts)
    .filter(([k]) => k !== 'scrollers')
    .reduce((a, [, v]) => a + (v || 0), 0)

  return {
    at: name + ' (' + window.innerWidth + 'px)',
    thisWidth: { clean: total === 0, counts, ...sweepResult },
    /* Arrangement, which no geometric check has an opinion about. */
    arrangement,
    acrossWidths: across && {
      clean: across.clean,
      textLeftTheLine: across.rowsWhoseTextLeftTheLine,
      rowsOutOfStep: across.rowsThatDidNotMoveTogether,
      onlyAtSomeWidths: across.findingsAtSomeWidthsOnly,
    },
    /* One boolean, so there is nothing to read past. */
    pass: framesRun !== false && total === 0 && arrangement.clean !== false && (!across || across.clean),
    ...(framesRun === false
      ? { framesStopped: 'the document ran no animation frames, so this reading may be one frame of an entrance held still' }
      : {}),
    /* Said out loud, because a single width is half a test and the half you
       skip is where the fault is. */
    note: _widthSnaps.size > 1
      ? 'Compared ' + _widthSnaps.size + ' widths.'
      : 'ONE width measured. Resize and call verify() again before believing this.',
  }
}

/* ── Two faults a sweep walked straight past ──
 *
 * A title bar wrapped its last button onto a row of its own, at its natural
 * width, beside 300px of nothing. Every geometric check passed: the heights
 * matched, the baselines matched, nothing overflowed the root. The fault was
 * the arrangement, and no check had an opinion about arrangement.
 *
 * Both of these are rules this project already ships to other agents, and
 * neither had a check behind it here.
 */
function rowFaults (within = null) {
  const root = within ? document.querySelector(within) : document.body
  if (!root) return { error: 'no root for ' + within }
  const out = { orphans: [], emptySpacers: [] }

  const flexRows = [root, ...root.querySelectorAll('*')].filter(el => {
    const cs = getComputedStyle(el)
    return /flex/.test(cs.display) && !cs.flexDirection.startsWith('column')
  })

  for (const row of flexRows) {
    const kids = [...row.children].filter(c => !_hidden(c))
    if (kids.length < 2) continue
    const rowBox = _visibleBox(row)
    if (rowBox.width < 8) continue

    /* An empty flex child with grow still takes the free space. It renders
       nothing, so every paint check calls it fine, and it pushes real content
       around — measured at 38.9px of nothing in one bar, which was exactly
       what forced a wrap.
     *
     * Over ALL children, not the visible ones. `_hidden` treats anything under
     * 1px tall as invisible, which is right for alignment and exactly wrong
     * here: an empty spacer IS a zero-height box that still claims width.
     * Written against the filtered list first, this check could never have
     * fired on the fault it was built for — proved by putting the fault back
     * and watching it stay silent. */
    /* Two conditions were missing, and without them this cried wolf: 58
       findings in one pass, all but one of them wrong.
     *
     * 1. It must PAINT nothing. An icon-only button has no text and no element
     *    children — its mark is a background or a pseudo-element — so it read
     *    as empty. Anything with a fill, a border or a background image is a
     *    thing on the screen, whatever its markup says.
     *
     * 2. The row must actually have WRAPPED. A deliberate spacer pushing one
     *    button to the far end is a normal idiom and harms nothing while the
     *    row fits on one line. The header spacer was a fault because it forced
     *    a wrap; the same element in a row that fits is just a spacer.
     *
     * A check that fires on correct things costs more than the miss it was
     * trying to prevent. */
    /* Band by ink OVERLAP, never by distinct tops.
     *
     * Tops reported this page as having 28 wrapped rows. Almost none had
     * wrapped: a button whose icon sits 3px above its label has two distinct
     * tops and one line. This file already says so about baselines, and I
     * wrote the new check without applying it. */
    const boxes = [...row.children]
      .map(c => ({ c, b: _visibleBox(c) }))
      .filter(x => x.b.height > 0)
      .sort((a, b) => a.b.top - b.b.top)
    const bands = []
    for (const x of boxes) {
      const hit = bands.find(bd => Math.min(bd.bottom, x.b.bottom) - Math.max(bd.top, x.b.top) > 0)
      if (hit) { hit.top = Math.min(hit.top, x.b.top); hit.bottom = Math.max(hit.bottom, x.b.bottom); hit.items.push(x) }
      else bands.push({ top: x.b.top, bottom: x.b.bottom, items: [x] })
    }
    const rowWrapped = bands.length > 1

    if (rowWrapped) for (const c of row.children) {
      const cs = getComputedStyle(c)
      if (!(parseFloat(cs.flexGrow) > 0)) continue
      if ((c.textContent || '').trim() || c.children.length) continue
      const bg = cs.backgroundColor || ''
      const painted = bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)
      const bordered = ['Top', 'Right', 'Bottom', 'Left']
        .some(s => (parseFloat(cs['border' + s + 'Width']) || 0) > 0 && cs['border' + s + 'Style'] !== 'none')
      if (painted || bordered || (cs.backgroundImage && cs.backgroundImage !== 'none')) continue
      const box = _visibleBox(c)
      if (box.width <= 2) continue
      out.emptySpacers.push({
        el: _name(c, 26), in: _name(row, 20),
        width: Math.round(box.width * 10) / 10,
        note: 'Empty flex child with flex-grow, in a row that wrapped. It paints nothing and still claims this much width.',
      })
    }

    /* Any band holding exactly one item that does not fill the row. That is
       the orphan rule, which this project states in its own payload and had
       never checked. Reuses the bands computed above — one banding per row,
       so the two checks can never disagree about what a row is. */
    if (!rowWrapped) continue
    /* Against the CONTENT box, not the border box. A row with 12px of padding
       each side reported a child filling its line as an orphan 24px short —
       the padding is not space the child was ever offered. */
    const rcs = getComputedStyle(row)
    const contentW = row.clientWidth - (parseFloat(rcs.paddingLeft) || 0) - (parseFloat(rcs.paddingRight) || 0)

    for (const bd of bands) {
      if (bd.items.length !== 1) continue
      const only = bd.items[0]
      const fills = only.b.width >= contentW - 2
      if (fills) continue
      out.orphans.push({
        el: _name(only.c, 26), in: _name(row, 20),
        width: Math.round(only.b.width * 10) / 10,
        rowWidth: Math.round(contentW * 10) / 10,
        note: 'Alone on its own line at its natural width. An orphan takes the whole line, or it should not have wrapped.',
      })
    }
  }
  out.clean = out.orphans.length === 0 && out.emptySpacers.length === 0
  return out
}


/* ── WHAT THE SCREEN PAINTS, IN THE PIXELS THEY SEE ──
 *
 * Their verdict on the version this replaces: "your tool doesn't work, delete it
 * and make a new one from scratch, one that can actually see raster pixels as i
 * see them."
 *
 * The old one measured position correctly and was blind to the thing that was
 * actually wrong. On the button they photographed it reported the ink sitting
 * 1.76px below the cap line and 1.24px above the baseline, called that centred,
 * and said clean. Both numbers were right. The mark was 9 rows of ink in a
 * 12-row band, and the plus beside it was 6.
 *
 * A MARK CAN BE PERFECTLY CENTRED AND STILL WRONG. Nothing was asking how much
 * of the band it FILLS, so making every icon smaller reported as an improvement
 * — twice, and the second time they had to say so.
 *
 * Three faults fixed here:
 *
 *   IT NEVER ASKED ABOUT SIZE FROM BELOW. Only overhang was a fault, so shrink
 *   was a free move. An icon under 60% of the band reads as a speck.
 *
 *   IT RASTERISED AT CSS SCALE. A screen at devicePixelRatio 2 paints two device
 *   rows per CSS pixel and spreads a stroke across them by antialiasing. At 1x a
 *   mark half a device row out reads as perfect.
 *
 *   IT TOOK THE BASELINE FROM A FONT TABLE. `fontBoundingBoxAscent` is a number
 *   the font declares. The baseline here is the last row of painted ink under a
 *   string of capitals, which is a row on the screen.
 *
 * Everything is scanned in device rows and reported in CSS pixels.
 */
async function inkband (root) {
  let scope = root
  if (typeof root === 'string') {
    const all = document.querySelectorAll(root)
    if (all.length > 1) return { clean: null, finding: root + ' matches ' + all.length + ' elements. Pass the element.' }
    scope = all[0]
  }
  scope = scope || document.body
  if (!scope) return { clean: null, finding: 'no such root' }

  const dpr = window.devicePixelRatio || 1
  const out = []
  let measured = 0

  for (const ctl of scope.querySelectorAll('button, a, .btn, .nav-item, .tab, summary, label')) {
    const svg = ctl.querySelector('svg')
    if (!svg) continue
    /* A tick inside a checkbox is not an icon beside a label. The reader sees
       the checkbox's own box; the tick is ornament in it, and that box answers
       to the control sizing rules instead. */
    if (svg.closest('.checkbox, .switch, .radio, .toggle')) continue

    const words = _visibleLabel(ctl)
    if (!words) continue                       /* icon-only centres on its box */
    const r = svg.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue

    const type = _paintedBand(ctl, dpr)
    if (!type) continue
    const ink = await _paintedInk(svg, r, dpr)
    if (!ink) continue
    measured++

    const band = type.baseline - type.capTop
    if (band <= 0) continue
    const above = type.capTop - ink.top        /* + is over the cap line */
    const below = ink.bottom - type.baseline   /* + is under the baseline */
    const height = ink.bottom - ink.top
    const fills = height / band
    const px = n => Math.round(n) / dpr

    /* THREE VERDICTS, EACH ABOUT SOMETHING A RULE DECIDES.
     *
     * OFF CENTRE   the ink is not centred between the two lines. Ours: the
     *              alignment. The threshold is on the MOVE, which is half the
     *              difference, so it takes a 2-row spread to ask for a 1-row
     *              correction. Their bar: whole pixels only.
     * TOO BIG      it overhangs both lines. Ours: the size token. Their rule —
     *              "equal overhangs are FINE" — so a small equal overhang is
     *              correct and only a large one is a fault.
     * TOO SMALL    it fills so little of the band that it reads as a speck.
     *              This is the question that was missing, and the reason two
     *              rounds of shrinking passed as repairs. */
    /* CENTRING IS A QUESTION ABOUT THE BOX, because the box is what CSS places.
     *
     * Measured on the ink it faults the DRAWING. A nav mark sat 1.1px above the
     * cap line and 0.9 below the baseline, so its box was centred to 0.2px, and
     * three glyphs in the same row read -0.9/-0.1, +0.1/+0.9 and -0.9/-1.1. The
     * spread is where each glyph sits inside its own viewBox, and the only
     * remedy is a per-glyph transform. They rejected that twice.
     *
     * Ink still answers the SIZE question above, where the remedy is a token. */
    const boxAbove = (type.capTop - r.top * dpr)
    const boxBelow = (r.bottom * dpr - type.baseline)
    const offCentre = Math.round(Math.abs(boxAbove - boxBelow)) >= 2
    /* PROPORTIONAL, NEVER ABSOLUTE. 2px of overhang is a fifth of a 9px band
       and an eighth of a 16px one, so one number means two different things.
       A mark reads as too big when it exceeds the band by about a third on
       each side. Measured: a 14px icon on a 14px label overhangs 20% and reads
       correctly; the 20px icon this replaced overhangs 40% and is the fault
       they photographed. */
    const oversized = Math.min(above, below) / band >= 0.3
    /* ── SIZE IS A QUESTION ABOUT THE TOKEN, NOT ABOUT THE INK ──
     *
     * An ink-fill floor cannot answer it. A plus is drawn at 0.58 of its box on
     * purpose and a bell at 0.83, so any threshold low enough to spare the plus
     * lets a genuinely small icon through. Set at 60% it passed the exact state
     * they rejected: a 10px mark beside a 12px label, which they called worse
     * than before.
     *
     * The proportion they asked for is a rule about the TOKEN, so check the
     * token. The icon box takes the label’s type size. That is deterministic,
     * it is the same answer for every glyph in the set, and its remedy is one
     * number in one place.
     *
     * The band either side is loose on purpose: a check that fires on correct
     * code costs more than the miss it prevents. */
    const boxToLabel = r.height / (parseFloat(getComputedStyle(ctl).fontSize) || 1)
    /* THE RATIO, MEASURED RATHER THAN CHOSEN.
     *
     * The icon box takes the label size MINUS ONE TYPE STEP. That comes out of
     * the cap band, which is what the reader compares the mark against. A band
     * is about 0.75 of the type size, and the tallest glyphs in the set paint
     * nearly their whole box. An icon equal to the label therefore crosses the
     * baseline: measured 1.3px on a download mark beside a 12px label.
     *
     * One step down fits it. Measured on the same mark: 9px of ink in a 9px
     * band, sitting 0.3 above the cap line and 0.3 below the baseline.
     *
     *     12px label  ->  10px icon   0.83
     *     14px label  ->  12px icon   0.86
     *     16px label  ->  14px icon   0.88
     *
     * The band below is wide enough to hold all three and narrow enough to
     * catch a mismatched pair: a 16px label carrying a 10px icon reads 0.63. */
    /* THE SIZE VERDICT IS OFF, and this comment is the reason it stays off.
     *
     * I derived a ratio from the cap band, shipped three different answers from
     * it, and they rejected every one by eye. The last was 10px beside a 12px
     * label: "i fucking give up... you are counting surfaces and measuring in
     * ink". The state they call correct is 14px beside a 12px label, a ratio of
     * 1.17, which every version of my rule called too big.
     *
     * A check that fails the thing the person is happy with is not measuring
     * what they see. Rather than widen the band until it blesses whatever ships
     * — which is tuning the number, not the measurement — the verdict is off
     * until the rule is settled with them.
     *
     * Centring stays on. It is measured on the box, it is uncontested, and it
     * caught a real 11.25px fault on a wrapped checkbox label. */
    const undersized = false
    const tokenTooBig = false

    if (!offCentre && !oversized && !undersized && !tokenTooBig) continue
    out.push({
      el: _name(ctl, 28), label: words.slice(0, 16),
      band: px(band) + 'px', ink: px(height) + 'px', fills: Math.round(fills * 100) + '%',
      finding: offCentre
        ? `icon box sits ${px(-boxAbove)}px below the cap line and ${px(-boxBelow)}px above the `
          + 'baseline. Centre the box between them.'
        : oversized
          ? `ink overhangs both lines by ${px(Math.min(above, below))}px, ${Math.round(Math.min(above, below) / band * 100)}% of the band. `
            + 'It is centred and too big for the label. Take the icon token down a step.'
          : undersized
            ? `icon box is ${px(r.height * dpr)}px beside a ${parseFloat(getComputedStyle(ctl).fontSize)}px label, `
              + `${Math.round(boxToLabel * 100)}% of it. The icon box takes the label’s type size.`
            : `icon box is ${px(r.height * dpr)}px beside a ${parseFloat(getComputedStyle(ctl).fontSize)}px label, `
              + `${Math.round(boxToLabel * 100)}% of it. The icon box takes the label’s type size.`,
    })
  }
  return { clean: out.length === 0, dpr, measured, checked: 'painted ink against the painted cap band', findings: out }
}

/* THE WORDS A READER CAN SEE, not the text content. A screen-reader-only span
   has text and paints nothing, and judging a mark against a label nobody can
   read is judging it against nothing. */
function _visibleLabel (ctl) {
  let s = ''
  const walk = n => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { s += c.textContent; continue }
      if (c.nodeType !== 1) continue
      if (c.tagName.toLowerCase() === 'svg') continue
      const cs = getComputedStyle(c)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const b = c.getBoundingClientRect()
      if (b.width <= 1 || b.height <= 1) continue   /* the visually-hidden clip */
      walk(c)
    }
  }
  walk(ctl)
  return s.replace(/\s+/g, ' ').trim()
}

/* THE CAP LINE AND THE BASELINE, READ OFF PAINTED ROWS.
 *
 * Draw a string of capitals to a canvas at device resolution in the element's
 * own computed font, then scan for rows holding ink. The first is the cap line
 * and the last is the baseline, because no capital descends below it.
 *
 * The canvas origin is placed at a known offset, so both rows come back as
 * distances from the baseline. The baseline's place on the PAGE then comes from
 * the label's own box: its top, plus the distance the scan just measured from
 * the box top to the baseline. Nothing here reads a font table.
 *
 * Returned in device rows, in page coordinates. */
function _paintedBand (ctl, dpr) {
  /* I REPLACED A PROVEN MEASUREMENT WITH AN UNPROVEN ONE AND CALLED IT BETTER.
   *
   * The first version of this scanned painted rows for both lines, on the
   * reasoning that a font table is not a thing on the screen. Checked against
   * `typeMetrics` it came out 3px high on the cap line and 4px on the baseline.
   * `typeMetrics` had already been verified to 0.00 spread across five runs at
   * different sizes, so the disagreement was mine.
   *
   * And the premise was wrong anyway. `actualBoundingBoxAscent` of a capital IS
   * measured ink — the browser reports where the glyph paints, not what the font
   * declares. The cap line was never a table lookup.
   *
   * The fault they were pointing at was never the band. It was that nothing
   * asked how much of the band the mark FILLS, so two rounds of shrinking
   * passed as repairs. That question is in `inkband` above.
   *
   * Scaled to device rows so the ink scan, which runs at devicePixelRatio, can
   * be subtracted from it directly. */
  const m = typeMetrics(ctl)
  if (!m) return null
  return { capTop: m.capTop * dpr, baseline: m.baseline * dpr }
}
/* THE PAINTED EXTENT OF A MARK, in device rows, in page coordinates. */
async function _paintedInk (svg, rect, dpr) {
  const w = Math.max(1, Math.round(rect.width * dpr))
  const h = Math.max(1, Math.round(rect.height * dpr))
  const clone = svg.cloneNode(true)
  const cs = getComputedStyle(svg)
  clone.setAttribute('width', w)
  clone.setAttribute('height', h)
  clone.setAttribute('stroke', '#000')
  if (clone.getAttribute('fill') !== 'none') clone.setAttribute('fill', '#000')
  /* THE WEIGHT HAS TO SURVIVE THE SCALE-UP. Drawing a 12px icon into a 24-row
     canvas doubles every length, so a stroke declared in CSS pixels comes out at
     half its share unless it is scaled with the box. `non-scaling-stroke` means
     the declared number IS painted pixels, so convert it into viewBox units at
     the size the canvas is drawing. Without this the ink measures thin and an
     undersized mark reads as merely slim. */
  const sw = parseFloat(cs.strokeWidth) || 1
  const vb = (clone.getAttribute('viewBox') || '0 0 24 24').split(/\s+/).map(Number)
  clone.setAttribute('stroke-width', cs.vectorEffect === 'non-scaling-stroke'
    ? String(sw * (vb[2] || 24) / (rect.width || 1))
    : String(sw))
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
  const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url })
  if (!img) return null
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0, w, h)
  const rows = _rows(g, w, h)
  if (!rows) return null
  return { top: rect.top * dpr + rows.top, bottom: rect.top * dpr + rows.bottom }
}

/* First and last row holding ink. The alpha floor is low on purpose: an
   antialiased stroke edge is faint and it is still on the screen. */
function _rows (g, w, h) {
  const px = g.getImageData(0, 0, w, h).data
  let top = -1, bottom = -1
  for (let y = 0; y < h; y++) {
    let any = false
    for (let x = 0; x < w && !any; x++) if (px[(y * w + x) * 4 + 3] > 16) any = true
    if (any) { if (top < 0) top = y; bottom = y + 1 }
  }
  return top < 0 ? null : { top, bottom }
}
