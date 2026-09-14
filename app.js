/* ==========================================================================
   YeeTlist
   ========================================================================== */

const STORE = 'yeetlist-v1';
const PAYLOAD_VERSION = 2;

/* THE BUILD SHOWN BESIDE THE WORDMARK, in MDexed's format: the date as
   YYMMDD, then the number of the push that day. 260915-4 is the fourth push
   of 15 September 2026.

   IT IS BUMPED ON EVERY PUSH, AND TWO WENT UP WITHOUT IT. The build read
   260915-1 while origin held three commits from that date, so the number
   beside the wordmark named the wrong build. Count `git log origin/main`
   for today before writing it.

   There is no bundler here, so nothing can inject this at compile time and
   this file is the one writer. package.json carries no "version" any more:
   that field takes semver, which cannot hold this shape, and two fields
   holding one figure is how they end up disagreeing. */
const VERSION = '260915-4';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const escape = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

const icon = (name, cls = 'icon') =>
  `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const date = (value) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';

/* Both dates render in both forms and CSS picks one, because which form fits
   is a question about the WIDTH. The table drops the time when the column
   narrows; the card shows the upload as a day and the addition in full, so
   the two are told apart by their shape rather than by a label. */
const dateOnly = (value) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
  : '—';

/* Whole words, and a unit is dropped where it is zero. "5 hours 3 minutes 47
   seconds", never "5 hours 0 minutes 47 seconds".

   A video whose duration never arrived reads as "—", and seconds() answers 0
   for it. That UNDERSTATES the total rather than hiding it, which is the
   honest way round: the count above still includes that video, so dropping it
   from the sum entirely would make the two lines disagree. */
const runtime = (total) => {
  const parts = [
    [Math.floor(total / 3600), 'hour'],
    [Math.floor(total / 60) % 60, 'minute'],
    [total % 60, 'second'],
  ].filter(([value]) => value > 0);

  if (!parts.length) return '0 seconds';
  return parts.map(([value, unit]) => `${value} ${unit}${value === 1 ? '' : 's'}`).join(' ');
};

const seconds = (value) => String(value ?? '')
  .split(':')
  .map(Number)
  .reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0);

/* ==========================================================================
   State
   ========================================================================== */

/* ==========================================================================
   The two lists

   ONE SPEC PER LIST, READ BY FIVE THINGS. The column widths, the header row,
   each row's cells, the card view's own labels and the sort menu all come
   from here. Written by hand they are five places that must agree about one
   set, and the first column added to one of them would break the rest.

   A LIST IS NOT A FILTER OVER ONE SHAPE. A bookmark has no channel, no
   duration and no upload date, so the table it sits in has different columns
   rather than four empty ones.
   ========================================================================== */

const LISTS = {
  youtube: {
    noun: ['Video', 'Videos'],
    head: 'Saved',
    runtime: true,
    placeholder: 'Paste a YouTube link…',
    fieldName: 'Add a video by YouTube link',
    add: 'Add to Watchlist',
    search: 'Search titles, channels, or tags',
    empty: {
      title: 'Your Watchlist Is Clear',
      body: 'Paste a YouTube link above to save a video for later.',
      action: 'Add Your First Video',
      none: 'No Videos Match',
    },
    columns: [
      { key: 'check' },
      { key: 'title', label: 'NAME', sort: 'title' },
      { key: 'chan', label: 'CHANNEL', sort: 'channel' },
      { key: 'dur', label: 'DURATION', sort: 'duration', amount: true },
      { key: 'up', label: 'UPLOADED', sort: 'uploadedAt' },
      { key: 'added', label: 'ADDED', sort: 'addedAt' },
      { key: 'tags', label: 'TAGS' },
      { key: 'remove' },
    ],
  },
  links: {
    noun: ['Bookmark', 'Bookmarks'],
    head: '',
    runtime: false,
    placeholder: 'Paste any link…',
    fieldName: 'Add a bookmark by link',
    add: 'Add to Bookmarks',
    search: 'Search names, addresses, or tags',
    empty: {
      title: 'No Bookmarks Yet',
      body: 'Paste any link above to keep it here beside your watchlist.',
      action: 'Add Your First Bookmark',
      none: 'No Bookmarks Match',
    },
    columns: [
      { key: 'check' },
      { key: 'title', label: 'NAME', sort: 'title' },
      /* An acronym is not title case. The menu takes the label's own words
         where the header's caps would mangle them. */
      { key: 'url', label: 'URL', menu: 'URL', sort: 'url' },
      { key: 'added', label: 'ADDED', sort: 'addedAt' },
      { key: 'tags', label: 'TAGS' },
      /* A SITE NAMES ITSELF AND OFTEN NAMES ITSELF BADLY. A video's title is
         YouTube's to state, so only this list can be renamed. */
      { key: 'edit' },
      { key: 'remove' },
    ],
  },
};

/* ONE ROW AT A TIME, AND THE DRAFT LIVES OUT HERE. render() rebuilds every
   row, so a value held only in the input is lost the moment anything else
   repaints the list. A Drive pull arriving mid-edit would do it. */
let editing = null;
let draft = '';

/* A record written before there were two lists has no kind, and every one of
   those is a video. Reading it here rather than migrating means an old file
   imports unchanged and an old export still opens. */
const listOf = (v) => (v && v.kind === 'link' ? 'links' : 'youtube');

let videos = [];
let tombstones = [];
let selected = new Set();
/* Each list keeps its own sort, because they share no columns beyond two.
   One shared key would leave the bookmarks sorted by a duration they have
   none of the moment a reader switched tabs. */
let tab = 'youtube';
const sorts = {
  youtube: { key: 'addedAt', dir: -1 },
  links: { key: 'addedAt', dir: -1 },
};
let sort = sorts.youtube;
/* A set, because the filter is a multiselect. Several tags match ANY of
   them: adding a tag widens the result, which is what a reader expects from
   a tag filter. */
let activeTags = new Set();
/* The same OR. Untagged beside #music reads as "music videos and the ones I
   have not sorted yet", which is the same widening every other option does. */
let untaggedOnly = false;
let searchTerm = '';
let deletion = null;
let listState = 'ready';
let stateMessage = '';
const metadataRequested = new Set();

function load() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { raw = null; }
  const parsed = normalise(raw);
  videos = parsed.videos;
  tombstones = parsed.deleted;
}

/* BOTH SHAPES GET THE SAME ORDER. The bare array is the first version's, and
   its tags are in whatever order they were typed. Sorting here is what puts
   every stored record in order on the first load after this ships, without
   a migration step anybody has to remember to run. */
const ordered = (v) => (v.tags?.length ? { ...v, tags: sortTags(v.tags) } : v);

/* Accepts the bare array the first version wrote, and the object this one
   writes. A stored shape that stops being read is a watchlist that vanishes. */
function normalise(raw) {
  if (Array.isArray(raw)) return { videos: raw.filter(Boolean).map(ordered), deleted: [] };
  if (raw && Array.isArray(raw.videos)) {
    return {
      videos: raw.videos.filter(Boolean).map(ordered),
      deleted: Array.isArray(raw.deleted) ? raw.deleted.filter((t) => t && t.id) : [],
    };
  }
  return { videos: [], deleted: [] };
}

const payload = () => ({
  version: PAYLOAD_VERSION,
  updatedAt: new Date().toISOString(),
  videos,
  deleted: tombstones,
});

function save() {
  localStorage.setItem(STORE, JSON.stringify({ version: PAYLOAD_VERSION, videos, deleted: tombstones }));
  queueDrivePush();
}

/* Everything below reads the CURRENT list. A tag menu counting videos while
   the bookmarks are on screen offers a filter that returns nothing, and the
   count beside each option would be about rows nobody can see. */
const inTab = () => videos.filter((v) => listOf(v) === tab);

/* A TAGS ARRAY IS ALPHABETICAL WHEREVER IT IS WRITTEN. Insertion order put
   the newest tag last, so one video read #music #3d and the next #3d #music,
   and a reader scanning the column had to read every chip.

   ONE COMPARATOR, EVERY CALLER. The filter menu already sorted this way, so
   the menu and the chips cannot drift into two orders. Every door that
   writes a tags array calls it: the two adders, the merge, and normalise(),
   which is what puts stored data in order the day this ships. */
const sortTags = (list) => [...list].sort((a, b) => a.localeCompare(b));

const allTags = () => sortTags([...new Set(inTab().flatMap((v) => v.tags || []))]);

/* UNTAGGED IS NOT A TAG, SO IT GETS ITS OWN FLAG. A tag is whatever the
   reader typed, so a sentinel string in activeTags would collide the day
   somebody names a tag "untagged". */
const bare = (v) => (v.tags || []).length === 0;
const bareCount = () => inTab().filter(bare).length;

/* It only earns a place in the menu where it can return something. With no
   tags at all it selects the whole list, which is what no filter already
   does, and the count beside it would repeat the heading. One writer for
   that condition: the menu and the prune both read it. */
const bareOffered = () => bareCount() > 0 && allTags().length > 0;

/* A tag is stored bare and shown with a hash. Keeping the hash out of storage
   means no migration, no chance of a double hash, and an export whose JSON
   payload does not change shape.

   The hash is also the search syntax. "#vfx" matches only a tag, because no
   title holds that literal, while a bare "vfx" still matches titles, channels
   and tags alike. */
const hashed = (tag) => '#' + tag;

function filteredVideos() {
  return inTab()
    .filter((v) => {
      /* A bookmark's address is searchable, because the name a site gives
         itself is often not the word a reader remembers it by. */
      const haystack = `${v.title} ${v.channel || ''} ${v.url || ''} `
        + `${(v.tags || []).map(hashed).join(' ')}`.toLowerCase();
      const tagged = (activeTags.size === 0 && !untaggedOnly)
        || (v.tags || []).some((t) => activeTags.has(t))
        || (untaggedOnly && bare(v));
      return tagged && haystack.toLowerCase().includes(searchTerm);
    })
    .sort((a, b) => {
      let x = a[sort.key] ?? '';
      let y = b[sort.key] ?? '';
      if (sort.key === 'duration') { x = seconds(x); y = seconds(y); }
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir;
    });
}

/* ==========================================================================
   Render
   ========================================================================== */

function render() {
  /* A FILTER THAT LEAVES THE MENU HAS TO TURN ITSELF OFF. Tag the last bare
     video and the option goes, so the filter would sit on with nothing on
     screen to show it or clear it. The tags already retire this way. */
  if (untaggedOnly && !bareOffered()) untaggedOnly = false;

  /* An edit cannot outlive its row. Deleting the record being renamed, or
     switching to a list it is not in, would leave a field open over nothing
     and a check button that saves into a gap. */
  if (editing !== null && !inTab().some((v) => v.id === editing)) { editing = null; draft = ''; }

  const spec = LISTS[tab];
  const held = inTab();
  const filtered = filteredVideos();
  const filtering = activeTags.size > 0 || untaggedOnly || Boolean(searchTerm);

  renderChrome(spec);

  const noun = spec.noun[held.length === 1 ? 0 : 1];
  const head = spec.head ? spec.head + ' ' : '';
  $('#listCount').textContent = filtering
    ? `${filtered.length} of ${held.length} ${head}${noun}`
    : `${held.length} ${head}${noun}`;

  /* The runtime answers the question a count cannot: is there time for this.
     So it reads the FILTERED set, the same as the line above it. A total for
     the whole library beside a filtered count would be two answers to two
     different questions, stacked.

     A BOOKMARK HAS NO DURATION, so the line is not a zero there. It is a
     question that does not apply, and the list says so by not asking it. */
  const runtimeLine = $('#listRuntime');
  runtimeLine.textContent = spec.runtime
    ? runtime(filtered.reduce((total, v) => total + seconds(v.duration), 0))
    : '';
  runtimeLine.hidden = !spec.runtime || !filtered.length;

  $('#rows').innerHTML = listState === 'loading' ? skeleton() : filtered.map(row).join('');

  renderState(filtered.length, filtering);
  renderTagFilter();
  renderSortState();

  /* Three states. Indeterminate is the honest answer when some of the rows
     below are chosen and some are not. */
  const chosen = filtered.filter((v) => selected.has(v.id)).length;
  const all = filtered.length > 0 && chosen === filtered.length;
  const some = chosen > 0 && chosen < filtered.length;

  /* ONE RENDERER FOR BOTH BOXES. The table's header cell holds one and the
     sort bar holds the other, because the card view renders no header. Two
     writers would let them disagree about a state neither reader can check. */
  [$('#allCheck'), $('#allCheckBar')].forEach((box) => {
    box.checked = all;
    box.indeterminate = some;
    box.disabled = filtered.length === 0;
  });

  /* The count on a tab is its WHOLE list, never the filtered one. A filter
     belongs to the tab you are on, so a number shrinking on the tab you are
     not looking at would be reporting your filter against somebody else's
     list. */
  $('#tabCountYoutube').textContent = videos.filter((v) => listOf(v) === 'youtube').length;
  $('#tabCountLinks').textContent = videos.filter((v) => listOf(v) === 'links').length;

  /* The FIELD decides, never searchTerm. A run of spaces is a search nobody
     can see and still something to clear. */
  $('#searchClear').hidden = !$('#search').value;

  $('#deleteSelected').disabled = selected.size === 0;
  $('#tagSelected').disabled = selected.size === 0;
  $('#clearFilter').disabled = !filtering;

  /* A panel about a selection cannot outlive it. Deselecting the last row
     with the panel open would leave two buttons acting on nothing. */
  if (bulkOpen && !selected.size) closeBulk();
  else if (bulkOpen) renderBulk();

  fitTags();
}

/* THE TAGS COLUMN HUGS ITS OWN CONTENT, BETWEEN TWO BOUNDS. Its floor is its
   own heading, because a column narrower than the word TAGS paints that word
   over the column beside it. Its ceiling is TWO CHIPS SIDE BY SIDE, whatever
   the widest two are, so a row with six tags takes three lines rather than a
   third of the table.

   AND THE ADD CONTROL SITS ON THAT LINE, which is their decision, taken from
   the two states rendered side by side. It is 28px and it is not a tag, so a
   cap of two chips alone dropped it to a second line: 2 of 34 watchlist rows
   and 3 of 4 bookmark rows grew, at 64px and 96px of table height. It costs
   32px of the name column in both lists and no row gains a line.

   THE PAIRS ARE DISJOINT AND IN ORDER: (1,2), (3,4), (5,6). A sliding window
   would ask about (2,3) as well, and the column would then have to hold two
   chips that no line ever puts together. The tags are alphabetical, so the
   pairing is the same on every render rather than a property of the order
   somebody typed them in.

   A LONE LAST CHIP IS ITS OWN CHUNK. It sits on a line by itself, so the
   column has to hold it, and it is the case that widens a one-tag row.

   THE DEAD CHIP IS NOT A TAG AND STILL HAS TO FIT. It states `nowrap`, so it
   cannot give a line back the way a tag run can.

   MEASURED, NEVER COMPUTED. The chip's width is its padding, its label, its
   mark and its own gap, which is four numbers this would otherwise restate.
   The rectangle is the answer, and `.cell-tags .tag-chip` refuses to shrink
   so the rectangle is the chip's natural width rather than whatever the
   current column left it. */
function fitTags() {
  const th = $('#head').querySelector('[data-col="tags"]');
  if (!th) return;

  const cs = getComputedStyle(th);
  const pad = (parseFloat(cs.paddingInlineStart) || 0) + (parseFloat(cs.paddingInlineEnd) || 0);

  /* The label is one word, so it never wraps and a Range over it is the
     painted ink rather than the box the column happens to give it. */
  const range = document.createRange();
  range.selectNodeContents(th);
  const heading = range.getBoundingClientRect().width;

  let gap = 0;
  let content = 0;
  $$('#rows .cell-tags .tags').forEach((box) => {
    gap = parseFloat(getComputedStyle(box).columnGap) || gap;
    box.querySelectorAll('.dead-chip').forEach((chip) => {
      content = Math.max(content, chip.getBoundingClientRect().width);
    });

    const chips = [...box.querySelectorAll('.tag-chip')].map((c) => c.getBoundingClientRect().width);
    for (let i = 0; i < chips.length; i += 2) {
      const pair = chips[i] + (chips[i + 1] === undefined ? 0 : gap + chips[i + 1]);
      content = Math.max(content, pair);
    }
  });

  /* THE BUTTON, NEVER ITS WRAPPER. `.tag-add` grows into a field while
     somebody is typing, and a render during that would state a column wide
     enough to hold the field for ever. The button under it is 28px at both
     pointers, because its own target is an overhang rather than a size.

     AND AN OPEN FIELD HIDES ITS OWN BUTTON, so the first one in the table
     can measure 0. Taking the first read 0 the moment row one was typing,
     and the column lost the 32px this cap exists to hold. Take the widest
     button that is painted, and fall back to the step it is drawn at when a
     one-row table has its only field open. */
  const add = $$('#rows .tag-add-btn')
    .reduce((w, b) => Math.max(w, b.getBoundingClientRect().width), 0)
    || parseFloat(getComputedStyle(th).getPropertyValue('--control-sm')) || 0;
  const widest = Math.max(heading, content ? content + gap + add : add);

  /* Round the ANSWER, once, so the column lands on a whole pixel however
     many fractions the chips came to. */
  th.closest('table').style.setProperty('--col-tags', `${Math.ceil(widest + pad)}px`);
}

/* ONE PASS FOR EVERYTHING THE COLUMN SET DECIDES. The widths, the header
   row, the sort menu, the two placeholders and the tab marks all read the
   same spec, so a column added to a list reaches every one of them.

   THE SORT KEY IS CHECKED AGAINST THE COLUMNS. Switching to a list that has
   no such column would otherwise leave the menu on a key nothing sorts by,
   and the table showing an order no header can explain. */
function renderChrome(spec) {
  const keys = spec.columns.filter((c) => c.sort);
  if (!keys.some((c) => c.sort === sort.key)) sort.key = 'addedAt';

  /* The table says which list it is holding, so a column can state a width
     in one and stay auto in the other. */
  $('#cols').closest('table').dataset.list = tab;
  $('#cols').innerHTML = spec.columns.map((c) => `<col class="col-${c.key}" />`).join('');

  $('#head').innerHTML = `<tr>${spec.columns.map((c) => {
    if (c.key === 'check') {
      return `<th class="col-check check" scope="col">
        <label class="check-hit">
          <input id="allCheck" class="checkbox" type="checkbox"
                 aria-label="Select all ${escape(spec.noun[1].toLowerCase())}" />
        </label>
      </th>`;
    }
    if (c.key === 'remove') return `<th class="col-remove" scope="col"><span class="sr-only">Remove</span></th>`;
    if (c.key === 'edit') return `<th class="col-edit" scope="col"><span class="sr-only">Rename</span></th>`;
    /* THE KEY IS AN ATTRIBUTE, NOT A CLASS. fitTags() has to find this cell
       to read its own label's ink, and a `col-tags` class here would be a
       second writer on the width the colgroup already states. */
    if (!c.sort) return `<th scope="col" data-col="${escape(c.key)}">${escape(c.label)}</th>`;
    return `<th scope="col" data-col="${escape(c.key)}"${c.amount ? ' class="amount"' : ''}>
      <button class="th-sort" type="button" data-key="${escape(c.sort)}">${escape(c.label)} ${icon('sort')}</button>
    </th>`;
  }).join('')}</tr>`;

  /* A DIRECTION OPTION IS AN ACTION, and the hr between the two groups is
     real HTML rather than an optgroup claiming they are different kinds. */
  $('#sortKey').innerHTML =
    keys.map((c) => `<option value="${escape(c.sort)}">${escape(c.menu || title(c.label))}</option>`).join('')
    + '<hr />'
    + '<option value="dir:1">Ascending</option><option value="dir:-1">Descending</option>';

  $('#videoUrl').placeholder = spec.placeholder;
  $('#videoUrl').setAttribute('aria-label', spec.fieldName);
  $('#addBtn .btn-label').textContent = spec.add;
  $('#search').placeholder = spec.search;
  $('#search').setAttribute('aria-label', spec.search);

  $$('.tab').forEach((button) => {
    const on = button.dataset.tab === tab;
    button.setAttribute('aria-selected', on ? 'true' : 'false');
    button.tabIndex = on ? 0 : -1;
  });
}

/* The header is set in caps by the stylesheet, so the menu needs the words
   back in their own case rather than a second copy of each label. */
const title = (label) => label.replace(/\S+/g, (w) => w[0] + w.slice(1).toLowerCase());

/* One rendering for both shapes. At narrow widths CSS turns each row into a
   card, and data-label is what gives every fact its name once the header row
   is gone. Two renderings of the same data would drift. */
const CELLS = {
  check: (v) => `<td class="check cell-check">
    <label class="check-hit">
      <input class="checkbox select" data-id="${escape(v.id)}" type="checkbox"
             ${selected.has(v.id) ? 'checked' : ''} aria-label="Select ${escape(v.title)}">
    </label>
  </td>`,

  /* ONE LINK, TWO ADDRESSES. A video is reached by its id and a bookmark IS
     its address, so the href is the one thing the two lists disagree about
     in this cell. */
  /* THE TEXT TRUNCATES IN A SPAN, NOT ON THE ANCHOR. overflow: hidden clips
     an element's own ::after, so the anchor cannot both ellipsise and carry
     a target overhang. Moving the clipping one level in leaves the anchor
     free to be the target. */
  title: (v) => `<td class="cell-title">${editing === v.id
    ? `<input class="input title-input" data-id="${escape(v.id)}" value="${escape(draft)}"
              aria-label="Name for ${escape(v.url || v.title)}" autocomplete="off" />`
    : `<a class="video-link" href="${escape(hrefOf(v))}" target="_blank" rel="noopener"
       title="${v.dead ? 'Unavailable on YouTube. ' : ''}${escape(v.title)}"><span
       class="truncate">${escape(v.title)}</span></a>`}
  </td>`,

  /* ONE BUTTON, TWO JOBS, AND THE MODE IS AN ATTRIBUTE RATHER THAN A CLASS.
     The handler reads data-mode, so neither the colour nor the mark can drift
     from what the press actually does. */
  edit: (v) => {
    const on = editing === v.id;
    return `<td class="cell-edit">
      <button class="row-edit" data-id="${escape(v.id)}" data-mode="${on ? 'save' : 'edit'}"
              type="button" aria-label="${on ? 'Save the name' : 'Rename'} ${escape(v.title)}"
              >${icon(on ? 'check' : 'pencil')}</button>
    </td>`;
  },

  /* THE ADDRESS IS SHOWN WITHOUT ITS SCHEME, because https:// is on every
     one of them and carries nothing a reader is choosing between. The title
     holds the whole thing for anyone who needs it. */
  url: (v) => `<td class="cell-url">
    <span class="cell-name">URL</span>
    <span class="truncate" title="${escape(v.url || '')}">${escape(plainUrl(v.url))}</span>
  </td>`,

  chan: (v) => `<td class="cell-chan">
    <span class="cell-name">Channel</span>
    <span class="truncate" title="${escape(v.channel)}">${escape(v.channel)}</span>
  </td>`,

  dur: (v) => `<td class="cell-dur amount"><span class="cell-name">Duration</span>${escape(v.duration || '—')}</td>`,

  up: (v) => `<td class="cell-up">
    <span class="cell-name">Uploaded</span>
    <span class="date-full">${date(v.uploadedAt)}</span><span class="date-day">${dateOnly(v.uploadedAt)}</span>
  </td>`,

  added: (v) => `<td class="cell-added">
    <span class="cell-name">Added</span>
    <span class="date-full">${date(v.addedAt)}</span><span class="date-day">${dateOnly(v.addedAt)}</span>
  </td>`,

  tags: (v) => `<td class="cell-tags">
    <div class="tags">
      ${v.dead ? `<span class="dead-chip">${icon('alert')}Unavailable</span>` : ''}
      ${(v.tags || []).map((t) => `<span class="tag-chip">
        <span>${escape(hashed(t))}</span>
        <button class="tag-remove" type="button" data-id="${escape(v.id)}" data-tag="${escape(t)}"
                aria-label="Remove ${escape(hashed(t))} from ${escape(v.title)}">${icon('x')}</button>
      </span>`).join('')}
      <span class="tag-add">
        <button class="tag-add-btn" type="button" aria-label="Add a tag to ${escape(v.title)}"
                aria-expanded="false">${icon('plus')}</button>
        <label class="tag-input-hit">
          <input class="tag-input" data-id="${escape(v.id)}" placeholder="Tag name"
                 aria-label="Add tags to ${escape(v.title)}" autocomplete="off"
                 role="combobox" aria-expanded="false" aria-autocomplete="list"
                 aria-controls="tagSuggest">
        </label>
      </span>
    </div>
  </td>`,

  /* THE SAME MARK, A DIFFERENT JOB. While a name is being edited this button
     reverts rather than deletes, so data-mode decides which, and the
     accessible name says so out loud. A cross that deletes and a cross that
     cancels must never be told apart by the reader's memory alone. */
  remove: (v) => {
    const on = editing === v.id;
    return `<td class="cell-remove">
      <button class="row-remove" data-id="${escape(v.id)}" data-mode="${on ? 'revert' : 'delete'}"
              type="button"
              aria-label="${on ? `Discard the change to ${escape(v.title)}` : `Remove ${escape(v.title)}`}"
              >${icon('x')}</button>
    </td>`;
  },
};

const hrefOf = (v) => (listOf(v) === 'links'
  ? (v.url || '#')
  : `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`);

const plainUrl = (value = '') => String(value).replace(/^https?:\/\//, '').replace(/\/$/, '');

const row = (v) => `<tr class="${[selected.has(v.id) ? 'row-selected' : '', v.dead ? 'row-dead' : ''].filter(Boolean).join(' ')}" data-id="${escape(v.id)}">
  ${LISTS[tab].columns.map((c) => CELLS[c.key](v)).join('')}
</tr>`;

/* A loading state holds the SHAPE of what is coming, never a spinner. Each
   placeholder height comes from the type tokens of the line it stands in for,
   so the skeleton and the loaded row measure the same. */
const skeleton = () => Array.from({ length: 3 }, () => `<tr class="skeleton-row" aria-hidden="true">
  ${Array.from({ length: 8 }, (_, i) => `<td><span class="${i === 0 || i > 5 ? 'short' : ''}"></span></td>`).join('')}
</tr>`).join('');

/* Four states, never one. First run offers the feature's own action. No
   results offers a way BACK. A failure names what failed. Loading says so. */
function renderState(shown, filtering) {
  const box = $('#state');

  if (listState === 'loading') {
    box.hidden = false;
    box.setAttribute('role', 'status');
    box.setAttribute('aria-busy', 'true');
    box.innerHTML = `<h3>Reading your watchlist…</h3><p>Fetching video details.</p>`;
    return;
  }

  box.removeAttribute('aria-busy');

  if (listState === 'error') {
    box.hidden = false;
    box.setAttribute('role', 'alert');
    box.innerHTML = `${icon('alert')}
      <h3>That Did Not Work</h3>
      <p>${escape(stateMessage)}</p>
      <button class="btn btn-sm" type="button" data-action="retry">${icon('refresh')} Try Again</button>`;
    return;
  }

  box.removeAttribute('role');

  /* EMPTY AND NO RESULTS ARE DIFFERENT SCREENS, and both are about the list
     ON SHOW. Read against the whole library, a first bookmark beside fifteen
     videos rendered neither, so the bookmarks tab opened as a bare table with
     nothing in it and nothing said. */
  const held = inTab();
  const empty = LISTS[tab].empty;

  if (held.length === 0) {
    box.hidden = false;
    box.innerHTML = `${icon('inbox')}
      <h3>${escape(empty.title)}</h3>
      <p>${escape(empty.body)}</p>
      <button class="btn btn-sm btn-primary" type="button" data-action="focus-add">${escape(empty.action)}</button>`;
    return;
  }

  if (shown === 0 && filtering) {
    const one = held.length === 1;
    const noun = LISTS[tab].noun[one ? 0 : 1].toLowerCase();
    box.hidden = false;
    box.innerHTML = `${icon('search-x')}
      <h3>${escape(empty.none)}</h3>
      <p>${held.length} ${escape(noun)} ${one ? 'is' : 'are'} saved, and the current filter hides ${one ? 'it' : 'them all'}.</p>
      <button class="btn btn-sm" type="button" data-action="clear-filter">${icon('x')} Clear Filters</button>`;
    return;
  }

  box.hidden = true;
  box.innerHTML = '';
}

/* The trigger states what is chosen, because a control that cannot show its
   own value is broken. One tag reads as its name, several as a count. */
function renderTagFilter() {
  const tags = allTags();
  const chosen = activeTags.size + (untaggedOnly ? 1 : 0);

  /* The noun has to stay true. Two tags are Tags. A tag beside Untagged are
     not both tags, so the pair is Filters. "All" alone, because the trigger
     sits under a label that already says FILTER BY TAG, and the word after
     it would change with the tab. */
  $('#tagFilterValue').textContent =
    chosen === 0 ? 'All'
      : chosen > 1 ? `${chosen} ${untaggedOnly ? 'Filters' : 'Tags'}`
        : untaggedOnly ? 'Untagged'
          : hashed([...activeTags][0]);

  const held = inTab();
  const counts = new Map(tags.map((tag) => [tag, held.filter((v) => v.tags?.includes(tag)).length]));

  /* data-tag stays BARE. It is the key, and only the visible text is
     hashed. Hashing the key would break every lookup against `videos`. */
  const items = [];

  /* UNTAGGED LEADS, ABOVE THE RULE. It is the one option that is not a tag,
     and a reader reaching for it does not have to walk a list of fifty first.
     THE SEPARATOR IS PRESENTATIONAL: a listbox takes option and group
     children, so role="separator" among them is not a child the role allows.
     The option's own words say what it is. */
  if (bareOffered()) {
    items.push(`<li class="multi-option" role="option" id="tagOptUntagged"
        data-untagged="true" aria-selected="${untaggedOnly ? 'true' : 'false'}">
        <span class="multi-box">${icon('check')}</span>
        <span>Untagged</span>
        <span class="multi-count">${bareCount()}</span>
      </li>`);
    items.push(`<li class="multi-sep" role="presentation"></li>`);
  }

  items.push(...tags.map((tag, i) => `<li class="multi-option" role="option" id="tagOpt-${i}"
        data-tag="${escape(tag)}" aria-selected="${activeTags.has(tag) ? 'true' : 'false'}">
        <span class="multi-box">${icon('check')}</span>
        <span>${escape(hashed(tag))}</span>
        <span class="multi-count">${counts.get(tag)}</span>
      </li>`));

  $('#tagFilterList').innerHTML = items.length
    ? items.join('')
    : `<li class="multi-option" aria-disabled="true">No Tags Yet</li>`;

  /* An option removed while the panel is open must not leave the active
     index pointing past the end of the list. Count the OPTIONS, not the
     tags: the list also holds a separator now. */
  const open = multiOptions().length;
  if (multi.index >= open) multi.index = open - 1;
}

/* Paint is not a state. The sorted column says so in aria-sort, and its mark
   shows which way. The sort bar reads the same state, so the two controls
   cannot disagree. */
function renderSortState() {
  $$('.th-sort').forEach((button) => {
    const th = button.closest('th');
    const active = button.dataset.key === sort.key;
    const name = active ? (sort.dir === 1 ? 'sort-up' : 'sort-down') : 'sort';
    button.querySelector('use').setAttribute('href', '#i-' + name);
    if (active) th.setAttribute('aria-sort', sort.dir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });

  /* THE KEY OPTION CARRIES THE ARROW, so the collapsed trigger says both the
     key and the direction. Every other key is left plain, or the menu reads
     as five directions rather than one. */
  const key = $('#sortKey');
  const arrow = sort.dir === 1 ? ' ↑' : ' ↓';
  [...key.options].forEach((o) => {
    if (o.value.startsWith('dir:')) return;
    o.textContent = o.dataset.label || (o.dataset.label = o.textContent);
    if (o.value === sort.key) o.textContent += arrow;
  });
  key.value = sort.key;

  key.setAttribute('aria-label',
    'Sort by ' + (key.selectedOptions[0]?.dataset.label || sort.key)
    + ', ' + (sort.dir === 1 ? 'ascending' : 'descending'));
}

/* ==========================================================================
   Tag autocomplete

   One listbox for every tag input, fixed to the viewport rather than nested
   in the cell. A table that scrolls sideways would clip a dropdown drawn
   inside it, and this one cannot be clipped by anything.

   Keys: ArrowDown and ArrowUp move the active option. Enter takes the active
   option, or commits what was typed when none is active. Tab takes the active
   option and leaves. Escape closes the list and keeps the text. Comma commits.
   ========================================================================== */

const suggest = {
  list: null,
  input: null,
  options: [],
  index: -1,
};

function suggestBox() {
  if (suggest.list) return suggest.list;
  const list = document.createElement('ul');
  list.id = 'tagSuggest';
  list.className = 'tag-suggest';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Existing tags');
  list.hidden = true;
  document.body.append(list);

  /* Pointerdown, not click: a click fires after the input has already lost
     focus, and the blur handler would have closed the list first. */
  list.addEventListener('pointerdown', (event) => {
    const option = event.target.closest('[role=option]');
    if (!option || !suggest.input) return;
    event.preventDefault();
    accept(option.dataset.value);
  });

  suggest.list = list;
  return list;
}

function matchesFor(input) {
  const video = videos.find((v) => v.id === input.dataset.id);
  const own = new Set((video?.tags || []).map((t) => t.toLowerCase()));
  const typed = currentFragment(input).trim().replace(/^#/, '').toLowerCase();

  return allTags()
    .filter((tag) => !own.has(tag.toLowerCase()))
    .filter((tag) => !typed || tag.toLowerCase().includes(typed))
    .sort((a, b) => {
      /* A tag that starts with what was typed is the better guess. */
      const rankA = typed && a.toLowerCase().startsWith(typed) ? 0 : 1;
      const rankB = typed && b.toLowerCase().startsWith(typed) ? 0 : 1;
      return rankA - rankB || a.localeCompare(b);
    })
    .slice(0, 8);
}

/* The field takes a comma-separated run, so only the fragment after the last
   comma is what the reader is typing now. */
const currentFragment = (input) => input.value.split(',').pop();

function openSuggest(input) {
  const list = suggestBox();
  const options = matchesFor(input);

  if (!options.length) return closeSuggest();

  suggest.input = input;
  suggest.options = options;
  suggest.index = -1;

  /* data-value stays BARE, because accept() writes it into the field and
     addTags stores it. Only the label carries the hash. */
  list.innerHTML = options.map((tag, i) => `<li role="option" id="tagSuggest-${i}"
    data-value="${escape(tag)}" aria-selected="false">${escape(hashed(tag))}</li>`).join('');

  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  input.removeAttribute('aria-activedescendant');
  positionSuggest();
}

function positionSuggest() {
  if (!suggest.input || suggest.list.hidden) return;
  const box = suggest.input.getBoundingClientRect();
  const list = suggest.list;

  list.style.minWidth = Math.max(box.width, 160) + 'px';
  list.style.left = Math.min(box.left, innerWidth - list.offsetWidth - 8) + 'px';

  /* Open upward when the list would fall off the bottom of the window. */
  const below = innerHeight - box.bottom;
  if (below < list.offsetHeight + 8 && box.top > list.offsetHeight + 8) {
    list.style.top = (box.top - list.offsetHeight - 4) + 'px';
  } else {
    list.style.top = (box.bottom + 4) + 'px';
  }
}

function closeSuggest() {
  if (!suggest.list || suggest.list.hidden) return;
  suggest.list.hidden = true;
  suggest.input?.setAttribute('aria-expanded', 'false');
  suggest.input?.removeAttribute('aria-activedescendant');
  suggest.input = null;
  suggest.options = [];
  suggest.index = -1;
}

/* The ring has one slot more than there are options, because "nothing active"
   is a position too: it is how the reader gets back to what they typed.
   Slot 0 is that position, so an option at index i sits at slot i + 1. */
function moveSuggest(step) {
  if (!suggest.options.length) return;
  const count = suggest.options.length;
  const slot = suggest.index + 1;
  suggest.index = ((slot + step + count + 1) % (count + 1)) - 1;

  [...suggest.list.children].forEach((option, i) => {
    const on = i === suggest.index;
    option.setAttribute('aria-selected', on ? 'true' : 'false');
    option.classList.toggle('active', on);
    if (on) option.scrollIntoView({ block: 'nearest' });
  });

  if (suggest.index === -1) suggest.input.removeAttribute('aria-activedescendant');
  else suggest.input.setAttribute('aria-activedescendant', 'tagSuggest-' + suggest.index);
}

/* ONE FIELD, TWO DESTINATIONS. A row's field writes to that video. The bulk
   panel's field writes to a pending list that Apply then spreads over the
   selection. Everything before this point is identical, so the fork is here
   rather than in two copies of the editor. */
const isBulk = (el) => Boolean(el?.closest('#tagBulkPanel'));

const commitTagInput = (input, raw) =>
  isBulk(input) ? addPendingTags(raw) : addTags(input.dataset.id, raw);

/* Replace the fragment being typed, keep any complete tags before it. */
function accept(tag) {
  const input = suggest.input;
  if (!input) return;
  const parts = input.value.split(',');
  parts[parts.length - 1] = tag;
  closeSuggest();
  commitTagInput(input, parts.join(','));
}

/* ==========================================================================
   Mutations
   ========================================================================== */

/* Dropping the last video carrying a tag retires that tag, so an active
   filter on it must go too. Left behind, the multiselect would keep offering
   a tag that matches nothing and the list would read as empty for no visible
   reason. */
function removeTag(id, tag) {
  const video = videos.find((v) => v.id === id);
  if (!video) return;

  video.tags = (video.tags || []).filter((t) => t !== tag);
  save();
  if (!allTags().includes(tag)) activeTags.delete(tag);
  render();
}

/* ==========================================================================
   Tagging a selection

   The pending list is a STAGING set. Nothing reaches a video until Apply, so
   a reader can build three tags, change their mind and close the panel with
   the watchlist untouched.
   ========================================================================== */

const parseTags = (raw) =>
  raw.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);

/* Case-insensitive, first spelling wins. "VFX" typed after "vfx" is the same
   tag, and keeping both would split one filter into two. */
function mergeTags(existing, incoming) {
  const seen = new Map(existing.map((t) => [t.toLowerCase(), t]));
  incoming.forEach((t) => { if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t); });
  return sortTags([...seen.values()]);
}

function addPendingTags(raw) {
  const tags = parseTags(raw);
  if (!tags.length) return;
  pendingTags = mergeTags(pendingTags, tags);
  renderBulk();
  /* The panel was rebuilt, so the field is a new element. Focus goes back to
     the field rather than to a plus, because the panel is a place to type. */
  $('#tagBulkPanel .tag-input')?.focus();
}

function removePendingTag(tag) {
  pendingTags = pendingTags.filter((t) => t !== tag);
  renderBulk();
}

function applyPendingTags() {
  if (!pendingTags.length || !selected.size) return;
  const ids = new Set(selected);
  const added = pendingTags.length;

  videos = videos.map((v) =>
    ids.has(v.id) ? { ...v, tags: mergeTags(v.tags || [], pendingTags) } : v);

  save();
  pendingTags = [];
  closeBulk({ refocus: true });
  render();
  say(`Added ${added} tag${added === 1 ? '' : 's'} to ${ids.size} video${ids.size === 1 ? '' : 's'}.`);
}

function clearSelectedTags() {
  if (!selected.size) return;
  const ids = new Set(selected);
  const touched = videos.filter((v) => ids.has(v.id) && (v.tags || []).length).length;
  if (!touched) return;

  videos = videos.map((v) => (ids.has(v.id) ? { ...v, tags: [] } : v));
  save();

  /* A tag whose last video just lost it is retired, so a filter on it must go
     too. Left behind, the list reads as empty for no visible reason. */
  const live = new Set(allTags());
  [...activeTags].forEach((t) => { if (!live.has(t)) activeTags.delete(t); });

  closeBulk({ refocus: true });
  render();
  say(`Cleared the tags from ${touched} video${touched === 1 ? '' : 's'}.`);
}

function renderBulk() {
  const count = selected.size;
  $('#tagBulkCount').textContent =
    `${count} video${count === 1 ? '' : 's'} selected`;

  $('#tagBulkTags').innerHTML = `
    ${pendingTags.map((t) => `<span class="tag-chip">
      <span>${escape(hashed(t))}</span>
      <button class="tag-remove" type="button" data-tag="${escape(t)}"
              aria-label="Remove ${escape(hashed(t))} from the tags to apply">${icon('x')}</button>
    </span>`).join('')}
    <span class="tag-add" data-expanded="true">
      <label class="tag-input-hit">
        <input class="tag-input" placeholder="Tag name"
               aria-label="Tags to apply to the selected videos" autocomplete="off"
               role="combobox" aria-expanded="false" aria-autocomplete="list"
               aria-controls="tagSuggest">
      </label>
    </span>`;

  $('#tagBulkApply').disabled = !pendingTags.length || !count;
  /* Nothing to clear is not the same as nothing selected, and both disable
     it. A button that runs and changes nothing reads as broken. */
  $('#tagBulkClear').disabled =
    !count || !videos.some((v) => selected.has(v.id) && (v.tags || []).length);
}

function openBulk() {
  if (bulkOpen || !selected.size) return;
  bulkOpen = true;
  $('#tagBulkPanel').hidden = false;
  $('#tagSelected').setAttribute('aria-expanded', 'true');
  renderBulk();
  /* Open AND ready. The field is the only reason this panel exists, so a
     reader can type the moment it appears.

     THE LIST STAYS SHUT. Focus runs the same handler a reader's own click
     runs, so it offered every existing tag over the two buttons below. It
     also arrived only sometimes, because a click on the trigger can move
     focus again afterwards. Closing it here makes the opening state one
     thing rather than two. Typing or ArrowDown still opens it. */
  $('#tagBulkPanel .tag-input').focus();
  closeSuggest();
}

function closeBulk({ refocus = false } = {}) {
  if (!bulkOpen) return;
  bulkOpen = false;
  closeSuggest();
  $('#tagBulkPanel').hidden = true;
  $('#tagSelected').setAttribute('aria-expanded', 'false');
  if (refocus) $('#tagSelected').focus();
}

function addTags(id, raw) {
  const tags = raw.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  const video = videos.find((v) => v.id === id);
  if (!video || !tags.length) return;

  const seen = new Map((video.tags || []).map((t) => [t.toLowerCase(), t]));
  tags.forEach((tag) => { if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag); });
  video.tags = sortTags([...seen.values()]);

  save();
  render();
  /* THE FIELD STAYS OPEN FOR THE NEXT TAG. Tags arrive in runs, so a landed
     one used to leave the reader on the plus with a second press to make
     before they could type again.

     The row was rebuilt, so the field is a NEW element and the old one's
     focus went with it. Re-find it and open it. Escape and a click outside
     both put it back to the plus, which is what those two already did to an
     empty field. */
  expandTagField($(`tr[data-id="${CSS.escape(id)}"] .tag-add`));
}

/* ONE PASS FILLS THE GAPS AND FINDS THE DEAD, because both questions are
   answered by the same request.

   It asks about EVERY video rather than only the ones missing data. A video
   that was fine last week can be removed or made private this week, and
   nothing else would ever notice. videos.list costs one quota unit per call
   of up to 50 ids, so checking 500 videos costs 10 units against a daily
   10,000. The old path spent one request per video and learned less. */
async function refreshMetadata() {
  /* ONLY THE VIDEOS. YouTube knows nothing about a bookmark's address, so
     asking about one returns nothing, and nothing is what this reads as
     deleted. Measured: the first bookmark added came back struck through and
     marked Unavailable within a second of being saved. */
  const pending = videos.filter((v) => listOf(v) === 'youtube' && !metadataRequested.has(v.id));
  if (!pending.length) return;

  pending.forEach((v) => metadataRequested.add(v.id));

  const found = new Map();
  let trustworthy = true;

  for (let at = 0; at < pending.length; at += 50) {
    const chunk = pending.slice(at, at + 50);
    try {
      const response = await fetch('/api/videos?ids=' + chunk.map((v) => v.id).join(','));
      const data = await response.json();

      /* ABSENCE ONLY MEANS DEAD WHEN THE ANSWER WAS GOOD. A refused key, a
         502 or a dropped connection also return nothing, and marking a whole
         library dead on a network blip is the worst thing this can do.

         The oEmbed fallback is untrustworthy for the same reason. It fetches
         each video separately and drops the ones that fail, so a timeout
         reads exactly like a deletion. It fills metadata and is never
         allowed to condemn anything. */
      if (!response.ok || data.limited) trustworthy = false;
      (data.videos || []).forEach((v) => found.set(v.id, v));
    } catch {
      trustworthy = false;
    }
  }

  videos = videos.map((video) => {
    if (!pending.some((p) => p.id === video.id)) return video;

    const fresh = found.get(video.id);
    if (fresh) {
      /* Back from the dead is a real case: a video set private and then made
         public again. Clearing the flag costs nothing and a stale one is a
         row the reader distrusts for no reason. */
      const { dead, ...rest } = video;
      return { ...rest, ...fresh, tags: video.tags, addedAt: video.addedAt };
    }
    return trustworthy ? { ...video, dead: true } : video;
  });

  save();
  render();
}

/* ==========================================================================
   The status line

   ONE WRITER. Twelve call sites used to set #addStatus directly, so the
   dismiss control and the timer would have been twelve things to remember.

   A MESSAGE GOES AFTER 15 SECONDS. Nothing cleared the line before, so the
   first message of a session stayed until another replaced it, and one about
   a video added an hour ago still sat under the field.
   ========================================================================== */

const STATUS_LIFE = 15000;
let statusTimer = 0;

function say(text, markup = false) {
  const line = $('#addStatus');
  if (markup) line.innerHTML = text; else line.textContent = text;

  /* The control is hidden rather than absent, so there is nothing to build
     and nothing to wire on each message. */
  $('#addStatusDismiss').hidden = !text;

  clearTimeout(statusTimer);
  statusTimer = text ? setTimeout(() => say(''), STATUS_LIFE) : 0;
}

/* THE TAB DECIDES WHERE A LINK GOES, never the link itself. Routing on the
   address would drop a video into a list the reader is not looking at, and
   the only sign would be a count moving on the other tab. Each list says
   what it takes and refuses the rest by name. */
const isYouTube = (value) => {
  try {
    const url = new URL(value);
    return url.hostname === 'youtu.be' || url.hostname.endsWith('youtube.com');
  } catch { return false; }
};

async function addVideo() {
  const url = $('#videoUrl').value.trim();
  if (!url) return;

  $('#addBtn').disabled = true;

  try {
    if (tab === 'links' && isYouTube(url)) {
      throw new Error('That is a YouTube link. Add it from the YouTube tab.');
    }
    if (tab === 'youtube' && !isYouTube(url)) {
      throw new Error('That is not a YouTube link. Add it from the Other Bookmarks tab.');
    }
    await (tab === 'links' ? addLink(url) : addYouTube(url));
    $('#videoUrl').value = '';
    render();
  } catch (error) {
    say(error.message || 'Could not add that link.');
  } finally {
    $('#addBtn').disabled = false;
  }
}

async function addYouTube(url) {
  say('Reading video details…');
  const response = await fetch(`/api/video?url=${encodeURIComponent(url)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  if (videos.some((v) => v.id === data.id)) throw new Error('That video is already in your watchlist.');

  videos.push({ ...data, kind: 'youtube', addedAt: new Date().toISOString(), tags: [] });
  tombstones = tombstones.filter((t) => t.id !== data.id);
  save();
  /* The only message that is not plain text: it names an environment
     variable, so the name is set in the code face. */
  say(data.limited
    ? 'Added. Set <code>YOUTUBE_API_KEY</code> in Vercel to fetch duration and upload date.'
    : 'Added to your watchlist.', data.limited);
}

/* A BOOKMARK'S ID IS ITS ADDRESS. Videos are keyed by the YouTube id, and
   merge(), the tombstones and the selection all key off `id`, so a bookmark
   needs one of its own that two devices agree on. The address is that,
   normalised so a trailing slash cannot make one link into two. */
const linkId = (value) => {
  const url = new URL(value);
  url.hash = '';
  return url.toString().replace(/\/$/, '');
};

async function addLink(raw) {
  /* A reader pastes what they copied, and a bare host is a thing people
     copy. Naming the scheme is the app's job rather than theirs. */
  const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  let id;
  try { id = linkId(url); } catch { throw new Error('That is not a link this can read.'); }
  if (videos.some((v) => v.id === id)) throw new Error('That link is already bookmarked.');

  say('Reading the page…');
  let name = '';
  try {
    const response = await fetch(`/api/link?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    if (response.ok) name = data.title || '';
  } catch { /* the host is the fallback, below */ }

  /* THE HOST IS THE FALLBACK, NOT AN ERROR. Plenty of pages refuse a server
     that is not a browser, and a bookmark with no name is worse than one
     named after its own site. */
  if (!name) name = new URL(url).hostname.replace(/^www\./, '');

  videos.push({ id, kind: 'link', title: name, url, addedAt: new Date().toISOString(), tags: [] });
  tombstones = tombstones.filter((t) => t.id !== id);
  save();
  say(`Bookmarked ${name}.`);
}

function openDelete(ids) {
  deletion = [...ids];
  if (!deletion.length) return;

  const many = deletion.length !== 1;
  const required = `delete ${deletion.length} videos`;

  $('#confirmTitle').textContent = many ? `Delete ${deletion.length} Videos?` : 'Remove This Video?';
  $('#confirmText').textContent = many
    ? 'This removes them from your watchlist on every device you have connected. It cannot be undone.'
    : 'This removes the video from your watchlist on every device you have connected.';
  $('#typedConfirm').hidden = !many;
  $('#confirmInput').value = '';
  $('#confirmDelete').disabled = many;
  if (many) $('#requiredText').textContent = required;
  $('#confirm').showModal();
}

/* A delete leaves a tombstone, or the next device to sync puts it back. */
function commitDelete() {
  if (!deletion) return;
  const at = new Date().toISOString();
  const going = new Set(deletion);

  videos = videos.filter((v) => !going.has(v.id));
  deletion.forEach((id) => {
    tombstones = tombstones.filter((t) => t.id !== id);
    tombstones.push({ id, at });
    selected.delete(id);
  });

  save();
  render();
}

/* ==========================================================================
   The portable file
   ========================================================================== */

/* TWO TABLES, BECAUSE THE TWO LISTS SHARE NO COLUMNS WORTH SHARING. A single
   table with a Kind column would leave three cells empty on every bookmark
   row, and the file's whole job above the fence is to be read. */
function fileText() {
  const clips = videos.filter((v) => listOf(v) === 'youtube');
  const links = videos.filter((v) => listOf(v) === 'links');
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const clipRows = clips.map((v) => `| ${cell(v.title)} | ${cell(v.channel)} | ${cell(v.duration || '—')} `
    + `| ${cell(v.uploadedAt ? v.uploadedAt.slice(0, 10) : '—')} | ${cell((v.tags || []).join(' '))} |`);

  const linkRows = links.map((v) => `| ${cell(v.title)} | ${cell(v.url)} | ${cell((v.tags || []).join(' '))} |`);

  const section = (heading, header, divider, rows) =>
    (rows.length ? ['', `## ${heading}`, '', header, divider, ...rows] : []);

  return [
    '# YeeTlist watchlist',
    '',
    `> ${count(clips.length, 'video', 'videos')}, ${count(links.length, 'bookmark', 'bookmarks')}. `
      + `Written ${new Date().toISOString()} by YeeTlist.`,
    ...section('Videos', '| Video | Channel | Duration | Uploaded | Tags |',
      '| --- | --- | --- | --- | --- |', clipRows),
    ...section('Other bookmarks', '| Site | URL | Tags |', '| --- | --- | --- |', linkRows),
    '',
    '<!-- YeeTlist data below. The tables above are for reading; this block is what imports. -->',
    '',
    '```json',
    JSON.stringify(payload(), null, 2),
    '```',
    '',
  ].join('\n');
}

const cell = (value = '') => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function parseFile(source) {
  const fenced = source.match(/```json\s*([\s\S]*?)\s*```/);
  const raw = JSON.parse(fenced ? fenced[1] : source);
  const parsed = normalise(raw);
  if (!Array.isArray(parsed.videos)) throw new Error('no videos');
  return parsed;
}

/* Union by id. A record in both keeps the richer metadata, the earlier
   addedAt and the union of the tags. A tombstone wins only when it is newer
   than the record it deletes, so re-adding a video brings it back. */
function merge(local, incoming) {
  const byId = new Map();

  const put = (video) => {
    const existing = byId.get(video.id);
    if (!existing) return byId.set(video.id, { ...video, tags: sortTags(video.tags || []) });

    const richer = (a, b) =>
      (a.duration && a.duration !== '—' ? 1 : 0) + (a.uploadedAt ? 1 : 0)
      >= (b.duration && b.duration !== '—' ? 1 : 0) + (b.uploadedAt ? 1 : 0) ? a : b;

    const base = richer(existing, video);
    const seen = new Map();
    [...(existing.tags || []), ...(video.tags || [])]
      .forEach((t) => { if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t); });

    byId.set(video.id, {
      ...base,
      tags: sortTags([...seen.values()]),
      addedAt: [existing.addedAt, video.addedAt].filter(Boolean).sort()[0] || base.addedAt,
    });
  };

  local.videos.forEach(put);
  incoming.videos.forEach(put);

  const graves = new Map();
  [...local.deleted, ...incoming.deleted].forEach((t) => {
    const held = graves.get(t.id);
    if (!held || String(t.at) > String(held.at)) graves.set(t.id, t);
  });

  for (const [id, grave] of graves) {
    const video = byId.get(id);
    if (video && String(grave.at) > String(video.addedAt || '')) byId.delete(id);
  }

  return { videos: [...byId.values()], deleted: [...graves.values()] };
}

function exportFile() {
  const blob = new Blob([fileText()], { type: 'text/markdown' });
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'yeetlist.md',
  });
  link.click();
  URL.revokeObjectURL(link.href);
}

/* A YeeTlist export merges. ANYTHING ELSE IS SCANNED FOR LINKS, so a file
   this app never wrote is read rather than refused. Its own payload is tried
   first, because a merge carries tags, dates and tombstones that a scan
   cannot see. */
function importFile(file) {
  const isHtml = /\.html?$/i.test(file.name) || file.type === 'text/html';
  const reader = new FileReader();
  reader.onerror = () => toast('error', 'That file could not be read.');
  reader.onload = () => {
    const text = String(reader.result);

    if (!isHtml) {
      try {
        const incoming = parseFile(text);
        const merged = merge({ videos, deleted: tombstones }, incoming);
        videos = merged.videos;
        tombstones = merged.deleted;
        save();
        render();
        /* A YeeTlist file holds both lists, so the count names both. */
        const clips = videos.filter((v) => listOf(v) === 'youtube').length;
        const links = videos.length - clips;
        return toast('ok', `Imported ${clips} ${clips === 1 ? 'video' : 'videos'}`
          + ` and ${links} ${links === 1 ? 'bookmark' : 'bookmarks'}.`);
      } catch { /* not a YeeTlist export, so read it for links instead */ }
    }

    importLinks(text, isHtml);
  };
  reader.readAsText(file);
}

/* ==========================================================================
   Link import
   ========================================================================== */

/* An id is exactly eleven characters of the URL alphabet. Validating it here
   keeps a playlist id, a channel handle and a stray query value out. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;

function videoIdFrom(href) {
  let url;
  try { url = new URL(String(href), 'https://www.youtube.com'); } catch { return null; }
  if (!YT_HOST.test(url.hostname)) return null;

  const take = (v) => (VIDEO_ID.test(v || '') ? v : null);

  if (/youtu\.be$/i.test(url.hostname)) return take(url.pathname.slice(1).split('/')[0]);
  if (url.searchParams.get('v')) return take(url.searchParams.get('v'));

  /* /shorts, /embed, /v and /live all carry the id as the first segment. A
     /playlist or /@channel has no video in it and drops out here. */
  const path = url.pathname.match(/^\/(?:shorts|embed|v|live)\/([^/?#]+)/);
  return path ? take(path[1]) : null;
}

/* TWO LISTS OUT OF ONE FILE. A YouTube link is a video and everything else is
   a bookmark, which is the same split the tabs make.

   A VIDEO COMES FROM ANYWHERE AND A BOOKMARK COMES FROM AN ENTRY. A video
   link names one video wherever it sits, so a bare id in a paragraph is safe
   to take. A page address is not: a bookmarks file lists links somebody
   saved, while a note, an article or a video description CITES them. Taking
   every address out of one file read 109 of them, against the 46 videos it
   holds. Each scanner below decides what an entry is for its own format.

   THE LINK'S OWN TEXT IS THE BOOKMARK'S NAME. That name is the one the reader
   chose. It beats anything a fetch could return, needs no network, and a file
   of two hundred links costs nothing rather than two hundred requests. */
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300);

/* AN ASSET IS NOT A PAGE. A thumbnail, a favicon or a stylesheet is something
   a document points at, never something a reader saved. One file's entry
   lines held 46 of them beside its 46 videos. */
const ASSET = /\.(?:jpe?g|png|gif|webp|avif|svgz?|bmp|ico|css|js|mjs|json|woff2?|ttf|otf|eot|map)(?:$|[?#])/i;
const BARE = /https?:\/\/[^\s"'<>)\]]+/g;

function linksIn(text, isHtml) {
  const clips = new Set();
  const pages = new Map();

  const add = (href, title) => {
    const id = videoIdFrom(href);
    if (id) { clips.add(id); return; }
    if (ASSET.test(String(href))) return;

    let key;
    try { key = linkId(href); } catch { return; }
    if (!/^https?:/i.test(key)) return;
    if (!pages.has(key)) pages.set(key, clean(title));
  };

  if (isHtml) scanHtml(text, add); else scanText(text, add);

  /* Belt and braces, and the whole of the video pass: an address with a video
     id in it is that video, quoted or saved. The entry pass runs first, so a
     bookmark that found a name keeps it. */
  (text.match(BARE) || []).forEach((href) => {
    const id = videoIdFrom(href);
    if (id) clips.add(id);
  });

  return { clips, pages };
}

/* --------------------------------------------------------------------------
   Markdown, and any other text
   -------------------------------------------------------------------------- */

const MARKER = /^(?:[-*+]|\d+[.)])\s+/;
const HEADING = /^#{1,6}\s+/;
const QUOTE = /^>\s?/;
/* A field name in front of the address: "**URL**: ", "Link: ", "Source - ". */
const LABEL = /^(?:\*\*|__)?[A-Za-z0-9][A-Za-z0-9 _/-]{0,24}(?:\*\*|__)?\s*[:–-]\s+/;
/* A markdown link, an autolink, or a bare address. */
const LINK = /^(!)?\[([^\]]*)\]\(\s*<?([^\s)<>]+)>?[^)]*\)|^<(https?:\/\/[^>\s]+)>|^(https?:\/\/[^\s"'<>)\]]+)/;

function scanText(text, add) {
  let heading = '';
  let headingFree = false;

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\t/g, '    ');
    const indent = line.length - line.replace(/^ +/, '').length;
    let rest = line.trim().replace(QUOTE, '').trim();
    if (!rest) continue;

    const head = rest.match(HEADING);
    if (head) {
      rest = rest.slice(head[0].length).trim();
      /* "### 1. Eternal Confinement" names the entry written under it. A
         heading that is itself a link keeps its words and drops the address. */
      heading = rest.replace(/^\d+[.)]\s+/, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#]/g, '').trim();
      headingFree = true;
    }

    const marked = MARKER.test(rest);
    if (marked) rest = rest.replace(MARKER, '');

    /* AN INDENTED LINE WITH NO MARKER IS CONTINUATION PROSE, which is what a
       markdown list calls the body of the item above it. A description pasted
       into such a block cites addresses rather than saving them. Nested list
       items carry their own marker, so they stay entries. */
    if (indent > 0 && !marked && !head) continue;

    const body = rest.replace(LABEL, '');
    const m = body.match(LINK);
    if (!m || m[1]) continue;

    /* A LINE WITH NO MARKER HAS TO BE THE LINK. Without that, every sentence
       holding an address becomes a bookmark. A list item may carry a note
       after its link, which is how an annotated list is written. */
    if (!marked && !head && body.replace(LINK, '').trim().replace(/^[.,;]$/, '')) continue;

    /* A bare address runs to whitespace, so a sentence's full stop joins it.
       A markdown link is delimited and keeps whatever is inside its brackets. */
    const href = m[3] || m[4] || (m[5] || '').replace(/[.,;:!?]+$/, '');
    let name = (m[2] || '').trim();
    /* A link whose text is its own address carries no name. */
    if (/^(?:https?:\/\/|www\.)/i.test(name)) name = '';
    /* A HEADING NAMES AT MOST THE FIRST LINK UNDER IT, or one section title
       ends up on every link in that section. */
    if (!name && headingFree) name = heading;
    headingFree = false;

    add(href, name);
  }
}

/* --------------------------------------------------------------------------
   HTML
   -------------------------------------------------------------------------- */

/* DOMParser neither runs scripts nor fetches anything for text/html, and the
   result is never put into the live document. Only hrefs are read from it. */
const BLOCK = new Set(['li', 'dt', 'dd', 'p', 'div', 'td', 'th', 'section',
  'article', 'main', 'body', 'blockquote', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const ITEM = new Set(['li', 'dt', 'dd']);
/* CHROME IS NOT A BOOKMARK. A page's own navigation, masthead and footer are
   how that site moves you around. A bookmarks export carries none of these,
   so nothing is lost by refusing them. */
const CHROME = ['nav', 'header', 'footer'];

/* Nothing but whitespace stands between this node and one edge of its block. */
function edgeClear(node, block, side) {
  for (let n = node; n && n !== block; n = n.parentElement) {
    for (let s = n[side]; s; s = s[side]) {
      if (s.nodeType === 1 || (s.nodeType === 3 && s.textContent.trim())) return false;
    }
  }
  return true;
}

function scanHtml(html, add) {
  let doc;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch { return; }

  doc.querySelectorAll('a[href]').forEach((a) => {
    /* Walk up to the nearest block rather than asking closest() for a list of
       tags. A selector list answers with whichever matches first, which is a
       property of the file being read rather than of this rule. */
    /* Asked as an existence question at any depth, because a footer's link
       usually sits inside a paragraph and the block walk below stops before
       it. Nothing is kept from the answer, so which tag matched first cannot
       change the result. */
    if (CHROME.some((tag) => a.closest(tag))) return;

    let block = null;
    for (let p = a.parentElement, hops = 0; p && hops < 8; p = p.parentElement, hops += 1) {
      if (BLOCK.has(p.tagName.toLowerCase())) { block = p; break; }
    }
    if (!block) return;
    if (!edgeClear(a, block, 'previousSibling')) return;

    /* A LIST ITEM IS A SAVED ENTRY EVEN WITH A NOTE AFTER IT. That is the
       shape of a bookmarks export, whose anchors sit one to a <DT>, and of
       every hand-written list of links. Outside a list the anchor has to be
       the whole of its block, or a sentence citing an address is saved. */
    if (!ITEM.has(block.tagName.toLowerCase())
      && !edgeClear(a, block, 'nextSibling')) return;

    add(a.getAttribute('href'), a.textContent);
  });
}

const importRun = { active: false, cancelled: false };

function showImportPanel(total) {
  $('#importPanel').hidden = false;
  $('#importCancel').disabled = false;
  setImportProgress(0, total, { added: 0, duplicate: 0, failed: 0 });
}

function setImportProgress(done, total, counts) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  $('#importFill').style.width = percent + '%';
  $('#importBar').setAttribute('aria-valuenow', String(percent));
  $('#importCounts').textContent =
    `${done} of ${total} checked. ${counts.added} added`
    + (counts.duplicate ? `, ${counts.duplicate} already saved` : '')
    + (counts.failed ? `, ${counts.failed} could not be read` : '') + '.';
}

/* Chunked, because videos.list takes 50 ids per call and costs one quota unit
   either way. Ten keeps the bar moving: at 50 a 200-link file would advance
   four times, which is not a progress bar. */
async function importLinks(text, isHtml) {
  if (importRun.active) return;

  const { clips, pages } = linksIn(text, isHtml);
  const total = clips.size + pages.size;
  if (total === 0) {
    return toast('warn', 'No links in that file.',
      'It was read successfully. A video link counts anywhere in the file, and'
      + ' a bookmark has to be a list entry or a line of its own.');
  }

  const known = new Set(videos.map((v) => v.id));
  const fresh = [...clips.keys()].filter((id) => !known.has(id));
  const freshPages = [...pages.keys()].filter((id) => !known.has(id));
  const counts = { added: 0, duplicate: total - fresh.length - freshPages.length, failed: 0 };

  if (fresh.length + freshPages.length === 0) {
    return toast('warn', 'Nothing new to import.', total === 1
      ? 'That link was already saved.'
      : `All ${total} links were already saved.`);
  }

  importRun.active = true;
  importRun.cancelled = false;
  showImportPanel(fresh.length + freshPages.length);

  /* THE BOOKMARKS GO IN FIRST, because they need no network and so cannot
     fail. The bar then starts from a real number rather than from zero while
     the first chunk of videos is in flight. */
  const now = new Date().toISOString();
  freshPages.forEach((id) => {
    let name = pages.get(id);
    if (!name) { try { name = new URL(id).hostname.replace(/^www\./, ''); } catch { name = id; } }
    videos.push({ id, kind: 'link', title: name, url: id, addedAt: now, tags: [] });
    tombstones = tombstones.filter((t) => t.id !== id);
    counts.added += 1;
  });

  if (freshPages.length) {
    save();
    setImportProgress(freshPages.length, fresh.length + freshPages.length, counts);
    render();
  }

  let done = freshPages.length;
  const CHUNK = 10;

  try {
    for (let i = 0; i < fresh.length; i += CHUNK) {
      if (importRun.cancelled) break;
      const chunk = fresh.slice(i, i + CHUNK);

      let resolved = [];
      try {
        const response = await fetch('/api/videos?ids=' + chunk.join(','));
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Request failed.');
        resolved = data.videos || [];
      } catch (error) {
        /* One bad chunk must not end the run, but a refused key would fail
           every chunk in turn, so the reason is surfaced once at the end. */
        importRun.error = error.message;
      }

      const byId = new Map(resolved.map((v) => [v.id, v]));
      const addedAt = new Date().toISOString();

      chunk.forEach((id) => {
        const data = byId.get(id);
        if (!data) { counts.failed += 1; return; }
        videos.push({ ...data, kind: 'youtube', addedAt, tags: [] });
        tombstones = tombstones.filter((t) => t.id !== id);
        counts.added += 1;
      });

      done += chunk.length;
      /* Saved per chunk, so closing the tab mid-import keeps what resolved. */
      save();
      setImportProgress(done, fresh.length + freshPages.length, counts);
      render();
    }

    /* HOLD AT THE END, OR THE BAR NEVER ARRIVES.
       An import that fits one chunk set 0%, then 100%, then hid the panel in
       the same tick. Sampled every 60ms it read 0% four times running: the
       full bar existed for less than a frame. A panel that appears at zero
       and vanishes reads as broken rather than as finished. */
    if (!importRun.cancelled) await new Promise((r) => setTimeout(r, 500));
  } finally {
    importRun.active = false;
    $('#importPanel').hidden = true;
    $('#importFill').style.width = '0%';
  }

  render();
  reportImport(counts, total, importRun.cancelled, freshPages.length);
  importRun.error = null;
}

/* THE REPORT SAYS WHICH LIST GOT WHAT. One file now fills two, and "Imported
   58 videos" would be wrong about the half that are not. */
function reportImport(counts, total, cancelled, bookmarks) {
  const detail = [
    counts.duplicate ? `${counts.duplicate} already saved` : null,
    counts.failed ? `${counts.failed} could not be read` : null,
    importRun.error ? importRun.error : null,
  ].filter(Boolean).join(' · ');

  const clips = counts.added - bookmarks;
  const parts = [
    clips > 0 ? `${clips} ${clips === 1 ? 'video' : 'videos'}` : null,
    bookmarks > 0 ? `${bookmarks} ${bookmarks === 1 ? 'bookmark' : 'bookmarks'}` : null,
  ].filter(Boolean);
  const what = parts.join(' and ') || 'nothing';

  if (cancelled) {
    return toast('warn', `Import stopped. ${what} added.`,
      detail || `${total - counts.added - counts.duplicate} were not checked.`);
  }
  if (counts.added === 0) {
    return toast('error', 'Nothing was imported.', detail || 'None of the links could be read.');
  }
  toast(counts.failed || importRun.error ? 'warn' : 'ok', `Imported ${what}.`, detail);
}

/* ==========================================================================
   Toasts
   ========================================================================== */

/* A TOAST THAT PERSISTS MUST NOT COVER A CONTROL.
   Fixed to the bottom corner, two of them sat on the remove buttons of the
   last two rows: 6 covered findings at 28x28 and 52x64. They intercept
   clicks, and they stay until dismissed, so those buttons were unreachable
   for as long as the toast was up.

   Reserving the room is the fix rather than auto-dismissing. The count is
   the reason the toast exists, and a toast that removes itself takes the
   number away before it has been read. */
function reserveToastRoom() {
  const box = $('#toasts');
  const height = box.children.length ? Math.ceil(box.getBoundingClientRect().height) : 0;
  document.body.style.paddingBlockEnd = height ? `calc(${height}px + var(--space-2xl))` : '';
}

const TOAST_LIMIT = 3;

function toast(kind, title, detail) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.kind = kind;
  node.innerHTML = `
    <span class="toast-mark">${icon(kind === 'ok' ? 'check' : 'alert')}</span>
    <div class="toast-body">
      <div class="toast-title">${escape(title)}</div>
      ${detail ? `<div class="toast-detail">${escape(detail)}</div>` : ''}
    </div>
    <button class="btn btn-sm btn-icon toast-close" type="button" aria-label="Dismiss">${icon('x')}</button>`;

  node.querySelector('.toast-close').addEventListener('click', () => {
    node.remove();
    reserveToastRoom();
  });

  const box = $('#toasts');
  box.append(node);
  /* Capped, or the reserved room grows without bound and eats the page. */
  while (box.children.length > TOAST_LIMIT) box.firstElementChild.remove();
  reserveToastRoom();
  return node;
}

/* ==========================================================================
   Drive
   ========================================================================== */

let pushTimer = null;
let pushing = false;

/* One token request at a time. Two in flight open two popups. */
let driveResuming = false;

/* null until /api/config answers. Not false: "Drive is off" and "nobody has
   asked yet" are different states, and painting the first for the second
   flashes "Stored locally" at a reader who is linked. */
let driveAvailable = null;

/* Staged in the bulk panel, spread over the selection by Apply. */
let pendingTags = [];
let bulkOpen = false;

function driveStatus(state, words) {
  $('#syncDot').dataset.state = state;
  $('#syncWords').textContent = words;
}

/* Name the cause, or the reader is left holding a code. Each of these has a
   different repair, and three of the four are console settings rather than
   anything the reader did. */
function describeLinkFailure(reason) {
  const known = {
    access_denied: 'Access was declined, so nothing was linked.',
    state_mismatch:
      'That sign-in did not match the one this page started. Try Link Google Drive again.',
    no_refresh_token:
      'Google returned no refresh token, so the connection could not be made lasting. '
      + 'Remove YeeTlist from your Google account permissions and link it again.',
    unconfigured:
      'Server-side Google sync is not configured for this deployment. '
      + 'It needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SESSION_SECRET.',
  };
  if (known[reason]) return known[reason];
  if (/redirect_uri_mismatch/i.test(reason)) {
    return 'Google refused the redirect address. Add this exact URL to the OAuth '
      + `client's Authorized redirect URIs: ${location.origin}/api/oauth/callback`;
  }
  return 'Google refused the sign-in' + (reason ? `: ${reason}` : '.');
}

/* LINKED and AUTHORISED are different facts. The link lives in storage and
   survives a reload. The token does not, and has to be fetched again on
   every load, which can fail for a moment without the link being gone. */
function renderDrive() {
  const linked = DRIVE.connected();
  const live = DRIVE.live();
  const connect = $('#driveConnect');

  /* null until /api/config answers, and hidden while unknown. A control the
     deployment cannot honour is worse than an absent one, and a button that
     appears and then vanishes is worse than one that arrives late. */
  connect.hidden = !driveAvailable || (linked && live);
  $('#driveGroup').hidden = !(linked && live);

  connect.querySelector('.btn-label').textContent = linked ? 'Reconnect Drive' : 'Link Google Drive';
  connect.setAttribute('aria-label', linked ? 'Reconnect Google Drive' : 'Link Google Drive');

  /* A REQUEST IN FLIGHT IS NOT A FAILURE, AND SAYING SO IS THE WHOLE
     COMPLAINT. Every load starts with no token, so a linked reader met
     "Reconnect to sync" for as long as the resume took. It reads as broken on
     the one load nobody triggered, which is the load a deploy causes.

     LINKED IS KNOWN AT ONCE AND AVAILABLE IS NOT, so linked decides first.
     Ordered the other way, the unknown branch painted "Stored locally" over a
     reader who was already connecting: measured, the busy words never reached
     the screen at all. The markup ships "Stored locally", so an unlinked
     reader sees the right thing while /api/config is still in the air. */
  const broken = linked && !live && !driveResuming;

  if (linked) {
    if (live) { /* whatever the last sync said still stands */ }
    else if (driveResuming) driveStatus('busy', 'Connecting…');
    else driveStatus('error', 'Reconnect to sync');
  } else if (driveAvailable !== null) {
    driveStatus('local', 'Stored locally');
  }

  /* THE SAME THREE FACTS THE STATUS LINE READS, so the banner and the header
     can never disagree. One writer for one state.

     driveResuming is in the condition for the reason the status line has it:
     a resume runs on every load, and a red banner during that second shouts
     at a reader whose sync is coming back on its own. */
  $('#driveAlert').hidden = !broken;
}

/* A control the deployment cannot honour is worse than an absent one, so the
   Connect button appears only once the environment carries a client ID, and
   Pick appears only with an API key for the Picker. */
/* ONE WRITER FOR THE BUTTON, AND THIS IS NOT IT. This used to set
   connect.hidden itself, on a rule that disagreed with renderDrive: it hid
   the button whenever the reader was LINKED, where renderDrive shows it
   whenever the link is not live. So whether a reader could press Reconnect
   depended on which of two async calls happened to land last.

   It answers one question now, and renderDrive paints. */
async function renderDriveAvailability() {
  try {
    driveAvailable = Boolean((await DRIVE.settings()).driveEnabled);
  } catch {
    driveAvailable = false;
  }
  renderDrive();
}

async function driveConnect({ interactive = true } = {}) {
  try {
    driveStatus('busy', 'Connecting…');
    await (interactive ? DRIVE.connect() : DRIVE.resume());
    renderDrive();
    await drivePull({ announce: true });
    /* Anything edited while the token was gone goes up now, rather than
       waiting for the next change to trigger a push. */
    if (drivePendingPush) { drivePendingPush = false; await drivePush(); }
  } catch (error) {
    if (interactive) {
      driveStatus('error', 'Not connected');
      say(error.message);
      renderDrive();
      return;
    }

    /* A FAILED SILENT RESUME IS NOT A DISCONNECT, AND TREATING IT AS ONE LOST
       THE LINK ON EVERY DEPLOY.

       This called DRIVE.forget() here, which wipes the remembered connection
       and the file id. The resume runs at load, and a fresh build re-fetches
       every asset, so the Google script and /api/config are slowest on
       exactly that load. One timeout and the link was gone for good, with
       the app quietly back on local storage.

       The link is kept now. Only an explicit Disconnect forgets it. */
    renderDrive();
  }
}

/* On connect, read whatever is already there and merge it in. A file this app
   wrote on another device is found by name. One the reader made by hand needs
   the Picker once, because drive.file cannot see a file nobody handed it. */
async function drivePull({ announce = false } = {}) {
  try {
    driveStatus('busy', 'Reading Drive…');
    let id = DRIVE.fileId();
    let found = id ? await DRIVE.meta(id).catch(() => null) : null;
    if (!found) found = await DRIVE.find();

    if (!found) {
      driveStatus('busy', 'Creating ' + DRIVE.FILENAME + '…');
      const created = await DRIVE.create(fileText());
      DRIVE.remember({ fileId: created.id, syncedAt: created.modifiedTime });
      driveStatus('ok', 'Synced to Drive');
      if (announce) say(`Created ${DRIVE.FILENAME} in your Drive.`);
      return;
    }

    DRIVE.remember({ fileId: found.id });
    const text = await DRIVE.read(found.id);
    const incoming = parseFile(text);
    const before = videos.length;
    const merged = merge({ videos, deleted: tombstones }, incoming);
    videos = merged.videos;
    tombstones = merged.deleted;

    localStorage.setItem(STORE, JSON.stringify({ version: PAYLOAD_VERSION, videos, deleted: tombstones }));
    DRIVE.remember({ syncedAt: found.modifiedTime });
    render();
    driveStatus('ok', 'Synced to Drive');

    if (announce) {
      const gained = videos.length - before;
      say(gained > 0
        ? `Read ${DRIVE.FILENAME} from Drive. ${gained} ${gained === 1 ? 'video' : 'videos'} added.`
        : `Read ${DRIVE.FILENAME} from Drive. Nothing new.`);
    }
    await drivePush();
  } catch (error) {
    driveStatus('error', 'Sync failed');
    say(error.message);
  }
}

/* Edits made while the token is gone are not lost. They are already in local
   storage, and this remembers that Drive is behind, so a reconnect pushes
   them rather than waiting for the next change. */
let drivePendingPush = false;

function queueDrivePush() {
  if (!DRIVE.connected()) return;
  if (!DRIVE.live()) { drivePendingPush = true; return; }
  clearTimeout(pushTimer);
  pushTimer = setTimeout(drivePush, 1200);
}

async function drivePush() {
  if (!DRIVE.connected() || pushing) return;
  if (!DRIVE.live()) { drivePendingPush = true; return; }
  pushing = true;
  try {
    driveStatus('busy', 'Saving…');
    const id = DRIVE.fileId();
    const written = id ? await DRIVE.update(id, fileText()) : await DRIVE.create(fileText());
    DRIVE.remember({ fileId: written.id, syncedAt: written.modifiedTime });
    driveStatus('ok', 'Synced to Drive');
  } catch (error) {
    driveStatus('error', 'Sync failed');
    say(error.message);
  } finally {
    pushing = false;
  }
}


/* ==========================================================================
   Wiring
   ========================================================================== */

$('#addBtn').addEventListener('click', addVideo);
$('#videoUrl').addEventListener('keydown', (event) => { if (event.key === 'Enter') addVideo(); });

$('#search').addEventListener('input', (event) => {
  searchTerm = event.target.value.toLowerCase();
  render();
});

/* Focus goes back to the field, because clearing a search is the start of
   typing another one, not the end of the task. */
function clearSearch() {
  $('#search').value = '';
  searchTerm = '';
  $('#search').focus();
  render();
}

$('#searchClear').addEventListener('click', clearSearch);

/* ---- the two lists ------------------------------------------------------ */

const TAB_STORE = 'yeetlist-tab';

/* A FILTER BELONGS TO THE LIST IT WAS SET ON. Carried across, a tag the other
   list has none of would show an empty table and a menu with no such option
   to turn off. The selection goes for the same reason: Delete Selected must
   never act on rows the reader cannot see. */
function showTab(next) {
  if (next === tab || !LISTS[next]) return;
  tab = next;
  sort = sorts[tab];
  activeTags.clear();
  untaggedOnly = false;
  selected.clear();
  closeBulk();
  searchTerm = '';
  $('#search').value = '';
  try { localStorage.setItem(TAB_STORE, tab); } catch { /* a private window */ }
  render();
  $('#tab-' + (tab === 'links' ? 'links' : 'youtube')).focus();
}

$('.tabs').addEventListener('click', (event) => {
  const button = event.target.closest('.tab');
  if (button) showTab(button.dataset.tab);
});

/* ONE TAB STOP, AND THE ARROWS MOVE WITHIN IT. Home and End are part of the
   same pattern, and a two-tab strip still answers them. */
$('.tabs').addEventListener('keydown', (event) => {
  const order = $$('.tab');
  const at = order.findIndex((b) => b.dataset.tab === tab);
  const go = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: order.length - 1 }[event.key];
  if (go === undefined) return;
  event.preventDefault();
  showTab(order[(go + order.length) % order.length].dataset.tab);
});

/* Escape only acts where there is something to clear. Swallowed on an empty
   field it would stop every outer Escape from ever reaching its handler. */
$('#search').addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !event.target.value) return;
  event.preventDefault();
  clearSearch();
});

const clearFilters = () => {
  activeTags.clear();
  untaggedOnly = false;
  searchTerm = '';
  $('#search').value = '';
  render();
};

$('#clearFilter').addEventListener('click', clearFilters);

/* ---- tag multiselect ---------------------------------------------------- */

/* One tab stop. The trigger keeps focus and aria-activedescendant names the
   active option, which is the listbox pattern rather than a tab stop per
   checkbox: a strip of ten would otherwise cost ten presses to walk past. */
const multi = { open: false, index: -1 };

const multiOptions = () => $$('#tagFilterList [role=option]');

function openMulti() {
  if (multi.open) return;
  multi.open = true;
  $('#tagFilterList').hidden = false;
  $('#tagFilterTrigger').setAttribute('aria-expanded', 'true');
}

function closeMulti({ refocus = false } = {}) {
  if (!multi.open) return;
  multi.open = false;
  multi.index = -1;
  $('#tagFilterList').hidden = true;
  const trigger = $('#tagFilterTrigger');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.removeAttribute('aria-activedescendant');
  multiOptions().forEach((o) => o.classList.remove('active'));
  if (refocus) trigger.focus();
}

function moveMulti(step) {
  const options = multiOptions();
  if (!options.length) return;
  multi.index = (multi.index + step + options.length) % options.length;
  options.forEach((o, i) => o.classList.toggle('active', i === multi.index));
  options[multi.index].scrollIntoView({ block: 'nearest' });
  $('#tagFilterTrigger').setAttribute('aria-activedescendant', options[multi.index].id);
}

/* It takes the OPTION, not a tag string, because one option in the list is
   not a tag and has no key to pass. */
function toggleOption(option) {
  if (option.dataset.untagged) untaggedOnly = !untaggedOnly;
  else if (activeTags.has(option.dataset.tag)) activeTags.delete(option.dataset.tag);
  else activeTags.add(option.dataset.tag);

  const held = multi.index;
  render();
  /* render() rebuilt the list, so put the active mark back where it was. */
  multi.index = held;
  const options = multiOptions();
  options.forEach((o, i) => o.classList.toggle('active', i === multi.index));
}

$('#tagFilterTrigger').addEventListener('click', () => {
  if (multi.open) closeMulti(); else openMulti();
});

$('#tagFilterList').addEventListener('click', (event) => {
  const option = event.target.closest('[role=option]');
  if (option) toggleOption(option);
});

$('#tagFilterTrigger').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!multi.open) { openMulti(); moveMulti(event.key === 'ArrowDown' ? 1 : -1); }
    else moveMulti(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (event.key === 'Escape' && multi.open) { event.preventDefault(); closeMulti(); return; }
  if ((event.key === 'Enter' || event.key === ' ') && multi.open && multi.index >= 0) {
    event.preventDefault();
    toggleOption(multiOptions()[multi.index]);
  }
});

/* A click anywhere else closes it. Pointerdown, so a click that lands on
   another control still reaches that control.

   CAPTURE PHASE, BECAUSE THIS ASKS WHERE THE POINTER LANDED. That is a fact
   about the moment the event STARTED, and on the bubble phase the answer had
   already changed. Picking a suggestion runs the list's own handler first,
   which rewrites the list, so the very element the pointer went down on is
   detached by the time this ran. closest() then walked up from a node with no
   parent and returned null, which reads exactly like a click on the page.

   Measured on one pick: the same LI reported connected true and inside the
   list on capture, and connected false and outside it on bubble. The tag was
   applied and the panel closed under the reader.

   Reading isConnected instead would be a guess that detached means inside.
   The phase is the fact. */
addEventListener('pointerdown', (event) => {
  if (multi.open && !event.target.closest('#tagFilter')) closeMulti();

  /* The suggestion list is appended to the BODY so it can escape the panel's
     clipping, so it is outside #tagBulk. */
  if (bulkOpen && !event.target.closest('#tagBulk') && !event.target.closest('#tagSuggest')) {
    closeBulk();
  }
}, true);

/* ---- sorting ------------------------------------------------------------ */

/* Two controls, one state. The column headers and the sort bar both write
   `sort`, and renderSortState reads it back into both. */
$('thead').addEventListener('click', (event) => {
  const button = event.target.closest('.th-sort');
  if (!button) return;
  const key = button.dataset.key;
  sort.dir = sort.key === key ? -sort.dir : 1;
  sort.key = key;
  render();
});

$('#sortKey').addEventListener('change', (event) => {
  const picked = event.target.value;

  /* A DIRECTION IS AN ACTION. Applying it and returning the value to the key
     is what keeps the trigger showing the key. Without this the menu would
     read "Descending" and the sort key would be invisible. */
  if (picked.startsWith('dir:')) {
    sort.dir = Number(picked.slice(4));
    render();
    return;
  }

  sort.key = picked;
  render();
});

/* ---- the sticky stack ---------------------------------------------------- */

/* NO SELECTOR CAN ASK A PREVIOUS SIBLING FOR ITS HEIGHT, so each row's offset
   is written here and read by the stylesheet. Three rows stick: the add row,
   the filter row and the sort row.

   It re-measures on every resize AND on every content change, because the
   filter row wraps at narrow widths and the sort row is hidden entirely above
   952. A typed offset would be right at one width and wrong at the next.

   A HIDDEN ROW CONTRIBUTES NOTHING. offsetParent is null for display:none, so
   the sort row drops out of the sum on a desktop rather than reserving 44px
   of nothing under the filters. */
function stackSticky() {
  const rows = ['.add-card', '.filters', '.sort-bar'].map((q) => $(q));

  /* THE CHAIN STARTS AT THE GAP, NOT AT ZERO. The first row stops short of
     the viewport edge by the page's own top padding, so every offset below it
     carries that distance too. Read off the shell, because that is where the
     value is published and it changes at 952. */
  const shell = $('.shell');
  let run = parseFloat(getComputedStyle(shell).getPropertyValue('--page-pad')) || 0;
  rows.forEach((el, i) => {
    if (i > 0) document.documentElement.style.setProperty('--stick-' + i, run + 'px');
    if (el && el.offsetParent !== null) run += el.getBoundingClientRect().height;
  });
}

if (typeof ResizeObserver === 'function') {
  const watch = new ResizeObserver(stackSticky);
  ['.add-card', '.filters', '.sort-bar'].forEach((q) => { const el = $(q); if (el) watch.observe(el); });
}
addEventListener('resize', stackSticky);
stackSticky();

/* ONE HANDLER FOR BOTH BOXES, and the header's is DELEGATED. The header row
   is rebuilt whenever the column set changes, so a listener bound to
   #allCheck itself dies with the element the first time a reader switches
   lists. #head outlives it. */
function selectAll(event) {
  const filtered = filteredVideos();
  filtered.forEach((v) => { if (event.target.checked) selected.add(v.id); else selected.delete(v.id); });
  render();
}

$('#allCheckBar').addEventListener('change', selectAll);
$('#head').addEventListener('change', (event) => {
  if (event.target.id === 'allCheck') selectAll(event);
});

/* THE DRAFT IS READ ON EVERY KEYSTROKE, never off the field at save time.
   Anything that repaints the list replaces the input, and a value living only
   in the DOM goes with it. */
$('#rows').addEventListener('input', (event) => {
  if (event.target.classList.contains('title-input')) draft = event.target.value;
});

/* The two keys the two buttons are. Enter is the check, Escape is the cross,
   so a reader who never reaches for the mouse gets the same pair. */
$('#rows').addEventListener('keydown', (event) => {
  if (!event.target.classList.contains('title-input')) return;
  if (event.key === 'Enter') { event.preventDefault(); saveName(); }
  if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); }
});

$('#rows').addEventListener('change', (event) => {
  if (!event.target.classList.contains('select')) return;
  const id = event.target.dataset.id;
  if (event.target.checked) selected.add(id); else selected.delete(id);
  render();
});


/* BOUND TO BOTH ROOTS, NEVER WRITTEN TWICE. The bulk panel holds the same
   editor, so it needs the same five listeners. A second copy of them would
   drift, and these are the handlers that took four rounds to get right. */
function onTagClick(event) {
  const add = event.target.closest('.tag-add-btn');
  if (add) return expandTagField(add.closest('.tag-add'));

  const tag = event.target.closest('.tag-remove');
  if (tag) {
    return isBulk(tag) ? removePendingTag(tag.dataset.tag)
      : removeTag(tag.dataset.id, tag.dataset.tag);
  }

  const pencil = event.target.closest('.row-edit');
  if (pencil) return pencil.dataset.mode === 'save' ? saveName() : startEdit(pencil.dataset.id);

  /* A bulk panel holds no rows, so this matches nothing there. */
  const button = event.target.closest('.row-remove');
  if (!button) return;
  if (button.dataset.mode === 'revert') return cancelEdit();
  openDelete([button.dataset.id]);
}

/* ==========================================================================
   Renaming a bookmark

   A SITE NAMES ITSELF, AND OFTEN BADLY. The name is the one field here the
   reader owns, so it is the one field this edits. The address is the record's
   identity and the tags have their own editor.
   ========================================================================== */

function startEdit(id) {
  const item = videos.find((v) => v.id === id);
  if (!item) return;
  editing = id;
  draft = item.title || '';
  render();

  /* SELECTED, NOT JUST FOCUSED. A fetched site name is usually the thing
     being replaced rather than corrected, so typing should overwrite it. */
  const field = $('#rows .title-input');
  if (field) { field.focus(); field.select(); }
}

function cancelEdit() {
  if (editing === null) return;
  editing = null;
  draft = '';
  render();
}

function saveName() {
  if (editing === null) return;
  const id = editing;
  const name = draft.trim();
  const item = videos.find((v) => v.id === id);

  /* AN EMPTY NAME IS NOT A NAME. Saved, the row would be a blank line with an
     address under it and nothing to click. The host is what the bookmark was
     called before anyone typed, so it is what an emptied field falls back to. */
  if (item) {
    let next = name;
    if (!next) { try { next = new URL(item.url).hostname.replace(/^www\./, ''); } catch { next = item.title } }
    if (next !== item.title) { item.title = next; save(); }
  }

  editing = null;
  draft = '';
  render();
}

/* One open field at a time. Two of them would leave a row looking ready for
   input it is not going to receive. */
function expandTagField(wrap) {
  if (!wrap) return;
  $$('.tag-add[data-expanded]').forEach(collapseTagField);
  wrap.dataset.expanded = 'true';
  wrap.querySelector('.tag-add-btn').setAttribute('aria-expanded', 'true');
  wrap.querySelector('.tag-input').focus();
}

function collapseTagField(wrap) {
  /* THE PANEL'S FIELD IS PERMANENT. A panel whose only job is typing must not
     open on a plus, so it has no collapsed state to go back to. This guard is
     what stops a row's field, a blur or an Escape from taking it away. */
  if (!wrap || !wrap.dataset.expanded || isBulk(wrap)) return;
  delete wrap.dataset.expanded;
  wrap.querySelector('.tag-add-btn')?.setAttribute('aria-expanded', 'false');
  wrap.querySelector('.tag-input').value = '';
}

$('#deleteSelected').addEventListener('click', () => openDelete(selected));

$('#tagSelected').addEventListener('click', () => {
  if (bulkOpen) closeBulk(); else openBulk();
});

$('#tagBulkApply').addEventListener('click', applyPendingTags);
$('#tagBulkClear').addEventListener('click', clearSelectedTags);

/* The same call the header's own button makes. Two controls, one path: a
   second implementation of the link flow would drift from this one. */
$('#driveAlertAction').addEventListener('click', () => driveConnect({ interactive: true }));

/* say('') clears the timer as well as the words, so a dismissed message
   cannot be cleared a second time fifteen seconds later. */
$('#addStatusDismiss').addEventListener('click', () => say(''));

/* Escape walks back out one step at a time: the suggestion list, then the
   panel.

   IT ASKS THE STATE, NEVER defaultPrevented. Both handlers sit on this same
   element, so they fire in the order they were added, and this one is added
   first. Reading defaultPrevented here measured a flag nothing had set yet,
   and Escape closed the whole panel with the list still open. The order was
   the opposite of what the old comment claimed. */
$('#tagBulkPanel').addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (suggest.input && !suggest.list?.hidden) return;
  event.preventDefault();
  closeBulk({ refocus: true });
});

$('#confirmInput').addEventListener('input', (event) => {
  $('#confirmDelete').disabled =
    event.target.value.trim().toLowerCase() !== `delete ${deletion?.length ?? 0} videos`;
});

$('#confirm').addEventListener('close', () => {
  if ($('#confirm').returnValue === 'default') commitDelete();
  deletion = null;
});

$('#state').addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'clear-filter') clearFilters();
  if (action === 'focus-add') $('#videoUrl').focus();
  if (action === 'retry') { listState = 'ready'; render(); refreshMetadata(); }
});

/* ---- tag autocomplete ---------------------------------------------------- */

const onTagInput = (event) => {
  if (event.target.classList.contains('tag-input')) openSuggest(event.target);
};

/* Leaving an untouched field collapses it. Leaving one with text in it does
   NOT, because collapsing would throw away what was typed.

   relatedTarget says where focus WENT, which is the question being asked.
   Reading document.activeElement in a timeout instead gave the wrong answer:
   in a tab that is not focused it can still name the field that just blurred,
   so the collapse never ran. The timeout stays only so a pointerdown on a
   suggestion lands first. */
function onTagFocusOut(event) {
  if (!event.target.classList.contains('tag-input')) return;
  const wrap = event.target.closest('.tag-add');
  const wentTo = event.relatedTarget;
  setTimeout(() => {
    closeSuggest();
    if (!wrap || (wentTo && wrap.contains(wentTo))) return;
    if (!wrap.querySelector('.tag-input').value.trim()) collapseTagField(wrap);
  }, 0);
}

function onTagKeydown(event) {
  const input = event.target;
  if (!input.classList.contains('tag-input')) return;
  const open = suggest.input === input && !suggest.list?.hidden;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (open) moveSuggest(1); else openSuggest(input);
    return;
  }
  if (event.key === 'ArrowUp' && open) { event.preventDefault(); moveSuggest(-1); return; }
  /* Escape closes the suggestions first. With none open it collapses the
     field, so one key walks all the way back out. */
  if (event.key === 'Escape') {
    if (open) { event.preventDefault(); return closeSuggest(); }
    /* In the panel the field cannot collapse, so this step of the walk does
       not exist. Leave the event alone and the panel's own handler closes it.
       preventDefault here would make Escape do nothing at all. */
    if (isBulk(input)) return;
    event.preventDefault();
    const wrap = input.closest('.tag-add');
    collapseTagField(wrap);
    wrap?.querySelector('.tag-add-btn')?.focus();
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    if (open && suggest.index >= 0) accept(suggest.options[suggest.index]);
    else { closeSuggest(); commitTagInput(input, input.value); }
    return;
  }
  if (event.key === 'Tab' && open && suggest.index >= 0) {
    event.preventDefault();
    accept(suggest.options[suggest.index]);
    return;
  }
  if (event.key === ',') {
    event.preventDefault();
    closeSuggest();
    commitTagInput(input, input.value);
  }
}

[$('#rows'), $('#tagBulkPanel')].forEach((root) => {
  root.addEventListener('click', onTagClick);
  root.addEventListener('input', onTagInput);
  root.addEventListener('focusin', onTagInput);
  root.addEventListener('focusout', onTagFocusOut);
  root.addEventListener('keydown', onTagKeydown);
});

addEventListener('scroll', positionSuggest, { passive: true, capture: true });
addEventListener('resize', positionSuggest);

/* THE STRIP ABOVE THE CARD GROWS BY ONE RADIUS WHILE THE CARD IS STUCK, and
   the stylesheet cannot ask whether it is. The strip's extra 8px fills the
   card's rounded corners from behind, so it is only wanted once something
   scrolls under them. At rest it reached into the header instead.

   READ THE GEOMETRY, NEVER A SCROLL DISTANCE. The card sticks when its own
   top meets its `top`, and both come off the element. A number typed here
   would be the header's height, which is a different thing that changes with
   the type and the pointer. */
function markStuck() {
  const card = $('.add-card');
  const shell = $('.shell');
  if (!card || !shell) return;
  const offset = parseFloat(getComputedStyle(card).top) || 0;
  shell.toggleAttribute('data-stuck', card.getBoundingClientRect().top <= offset + 0.5);
}

addEventListener('scroll', markStuck, { passive: true });
addEventListener('resize', markStuck, { passive: true });
markStuck();

/* ---- the portable file --------------------------------------------------- */

$('#exportBtn').addEventListener('click', exportFile);
$('#importBtn').addEventListener('click', () => $('#importFile').click());

/* Cancel stops before the next chunk. A request already in flight is left to
   finish, so whatever it resolved is kept rather than thrown away.

   The guard matters: 30 links resolve in under 1.4s, so the panel can be gone
   before a hand reaches the button. Without it a late click set `cancelled`
   on a finished run and wrote "Stopping…" onto a hidden panel. */
$('#importCancel').addEventListener('click', () => {
  if (!importRun.active) return;
  importRun.cancelled = true;
  $('#importCancel').disabled = true;
  $('#importCounts').textContent = 'Stopping after the current batch…';
});
$('#importFile').addEventListener('change', (event) => {
  if (event.target.files[0]) importFile(event.target.files[0]);
  event.target.value = '';
});

/* ---- drive --------------------------------------------------------------- */

$('#driveConnect').addEventListener('click', () => driveConnect({ interactive: true }));
$('#driveSync').addEventListener('click', () => drivePull({ announce: true }));
$('#driveDisconnect').addEventListener('click', async () => {
  /* Paint the disconnected state at once. Revoking reaches Google over the
     network, and a button that looks dead until that returns reads as a
     button that did not work. */
  const done = DRIVE.disconnect();
  renderDrive();
  say('Disconnected. Your watchlist stays in this browser.');
  await done;
  renderDrive();
});

/* ==========================================================================
   Start
   ========================================================================== */

load();

$('#brandBuild').textContent = VERSION;
$('#brandBuild').title = `YeeTlist ${VERSION}`;

/* The tab a reader left on is where they meant to be. It is a view rather
   than data, so it stays local and never reaches Drive. */
try {
  const held = localStorage.getItem(TAB_STORE);
  if (LISTS[held]) { tab = held; sort = sorts[tab]; }
} catch { /* a private window */ }

/* THE SERVER FLOW COMES BACK BY REDIRECT, SO THE ANSWER ARRIVES IN THE URL.
   /api/oauth/callback cannot speak to a page that does not exist yet, so it
   states the outcome in a query parameter and the page reads it here.

   The cookie is HttpOnly, so nothing on this page can see whether a link was
   made. "drive=linked" is the only word for it. */
const arriving = new URLSearchParams(location.search);
const arrivedWith = arriving.get('drive');
if (arrivedWith) {
  if (arrivedWith === 'linked') DRIVE.remember({ connected: true });
  /* Clean the address bar before anything else can reload it. Left in place,
     a refresh would replay this every time, and "linked" would keep
     announcing itself. replaceState adds no history entry, so Back still
     goes where the reader expects. */
  history.replaceState(null, '', location.pathname);
}

driveResuming = DRIVE.connected();
renderDrive();
render();
refreshMetadata();
renderDriveAvailability();

/* ONE WRITER FOR THE STATUS LINE, AND IT IS renderDrive. This used to set
   "Not connected" here too, and renderDriveAvailability overwrote it a moment
   later with "Stored locally". Measured: the words never survived to be read.

   The two say different things anyway. The status line reports where the
   watchlist LIVES, which is locally and correctly. The message reports what
   just failed. */
if (arrivedWith === 'error') {
  say(describeLinkFailure(arriving.get('reason') || ''));
}

/* A remembered connection resumes without a prompt. It fails quietly when
   the Google session has gone, because an unasked-for popup is worse.

   WHERE THE SERVER HOLDS A REFRESH TOKEN THIS IS ONE SILENT REQUEST, with no
   window to block. Otherwise DRIVE restores a kept token that is still inside
   its hour, and asks Google for nothing at all. */
if (DRIVE.connected()) {
  /* THE RETRY WAITS FOR A GESTURE, BECAUSE THAT IS THE WHOLE DIFFERENCE.
     A token request may open a popup, and a browser blocks one with no
     gesture behind it. So the load-time attempt fails on a page the reader did
     not open themselves, and pressing Reconnect then works on the first try.
     One retry on the first interaction spends that gesture instead of asking
     for a second one.

     It binds BEFORE the load-time attempt, not after it. Waiting for that
     promise costs the 15 seconds the Google script is given, and a click
     inside that window would reach nothing.

     IT UNBINDS ONLY WHERE IT ACTS. Written to unbind first, a click landing
     while the load-time attempt was still running spent the one retry on
     nothing: measured, the handler ran, found a request in flight, and left.
     Every later click then reached no listener. Declining has to keep the
     listener, or the gesture that matters is the one already gone. */
  const retry = () => {
    if (driveResuming) return;
    removeEventListener('pointerdown', retry, true);
    removeEventListener('keydown', retry, true);
    if (DRIVE.connected() && !DRIVE.live()) driveConnect({ interactive: false });
  };
  addEventListener('pointerdown', retry, true);
  addEventListener('keydown', retry, true);

  driveResuming = true;
  driveConnect({ interactive: false }).finally(() => {
    driveResuming = false;
    /* The status said "Connecting…" while this ran. Something has to say what
       it became, or a failed resume leaves the busy words up for good. */
    renderDrive();
  });
}
