/* ==========================================================================
   YeeTlist
   ========================================================================== */

const STORE = 'yeetlist-v1';
const PAYLOAD_VERSION = 2;

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

/* The card view shows the upload as a day and the addition in full, so the
   two are told apart by their shape rather than by a label. */
const dateOnly = (value) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
  : '—';

const seconds = (value) => String(value ?? '')
  .split(':')
  .map(Number)
  .reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0);

/* ==========================================================================
   State
   ========================================================================== */

let videos = [];
let tombstones = [];
let selected = new Set();
let sort = { key: 'addedAt', dir: -1 };
/* A set, because the filter is a multiselect. Several tags match ANY of
   them: adding a tag widens the result, which is what a reader expects from
   a tag filter. */
let activeTags = new Set();
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

/* Accepts the bare array the first version wrote, and the object this one
   writes. A stored shape that stops being read is a watchlist that vanishes. */
function normalise(raw) {
  if (Array.isArray(raw)) return { videos: raw.filter(Boolean), deleted: [] };
  if (raw && Array.isArray(raw.videos)) {
    return {
      videos: raw.videos.filter(Boolean),
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

const allTags = () =>
  [...new Set(videos.flatMap((v) => v.tags || []))].sort((a, b) => a.localeCompare(b));

/* A tag is stored bare and shown with a hash. Keeping the hash out of storage
   means no migration, no chance of a double hash, and an export whose JSON
   payload does not change shape.

   The hash is also the search syntax. "#vfx" matches only a tag, because no
   title holds that literal, while a bare "vfx" still matches titles, channels
   and tags alike. */
const hashed = (tag) => '#' + tag;

function filteredVideos() {
  return videos
    .filter((v) => {
      const haystack = `${v.title} ${v.channel} ${(v.tags || []).map(hashed).join(' ')}`.toLowerCase();
      const tagged = activeTags.size === 0 || (v.tags || []).some((t) => activeTags.has(t));
      return tagged && haystack.includes(searchTerm);
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
  const filtered = filteredVideos();
  const filtering = activeTags.size > 0 || Boolean(searchTerm);

  $('#listCount').textContent = filtering
    ? `${filtered.length} of ${videos.length} Saved ${videos.length === 1 ? 'Video' : 'Videos'}`
    : `${videos.length} Saved ${videos.length === 1 ? 'Video' : 'Videos'}`;

  $('#rows').innerHTML = listState === 'loading' ? skeleton() : filtered.map(row).join('');

  renderState(filtered.length, filtering);
  renderTagFilter();
  renderSortState();

  /* Three states. Indeterminate is the honest answer when some of the rows
     below are chosen and some are not. */
  const box = $('#allCheck');
  const chosen = filtered.filter((v) => selected.has(v.id)).length;
  box.checked = filtered.length > 0 && chosen === filtered.length;
  box.indeterminate = chosen > 0 && chosen < filtered.length;

  $('#deleteSelected').disabled = selected.size === 0;
  $('#clearFilter').disabled = !filtering;
}

/* One rendering for both shapes. At narrow widths CSS turns each row into a
   card, and data-label is what gives every fact its name once the header row
   is gone. Two renderings of the same data would drift. */
const row = (v) => `<tr class="${selected.has(v.id) ? 'row-selected' : ''}" data-id="${escape(v.id)}">
  <td class="check cell-check">
    <label class="check-hit">
      <input class="checkbox select" data-id="${escape(v.id)}" type="checkbox"
             ${selected.has(v.id) ? 'checked' : ''} aria-label="Select ${escape(v.title)}">
    </label>
  </td>
  <td class="cell-title">
    <a class="video-link" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}"
       target="_blank" rel="noopener" title="${escape(v.title)}">${escape(v.title)}</a>
  </td>
  <td class="cell-chan">
    <span class="cell-name">Channel</span>
    <span class="truncate" title="${escape(v.channel)}">${escape(v.channel)}</span>
  </td>
  <td class="cell-dur amount"><span class="cell-name">Duration</span>${escape(v.duration || '—')}</td>
  <td class="cell-up">
    <span class="cell-name">Uploaded</span>
    <span class="date-full">${date(v.uploadedAt)}</span><span class="date-day">${dateOnly(v.uploadedAt)}</span>
  </td>
  <td class="cell-added"><span class="cell-name">Added</span>${date(v.addedAt)}</td>
  <td class="cell-tags">
    <div class="tags">
      ${(v.tags || []).map((t) => `<span class="tag-chip">${escape(hashed(t))}</span>`).join('')}
      <label class="tag-input-hit">
        <input class="tag-input" data-id="${escape(v.id)}" placeholder="+ add tags"
               aria-label="Add tags to ${escape(v.title)}" autocomplete="off"
               role="combobox" aria-expanded="false" aria-autocomplete="list"
               aria-controls="tagSuggest">
      </label>
    </div>
  </td>
  <td class="cell-remove">
    <button class="row-remove" data-id="${escape(v.id)}" type="button"
            aria-label="Remove ${escape(v.title)}">${icon('x')}</button>
  </td>
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

  if (videos.length === 0) {
    box.hidden = false;
    box.innerHTML = `${icon('inbox')}
      <h3>Your Watchlist Is Clear</h3>
      <p>Paste a YouTube link above to save a video for later.</p>
      <button class="btn btn-sm btn-primary" type="button" data-action="focus-add">Add Your First Video</button>`;
    return;
  }

  if (shown === 0 && filtering) {
    box.hidden = false;
    box.innerHTML = `${icon('search-x')}
      <h3>No Videos Match</h3>
      <p>${videos.length} ${videos.length === 1 ? 'video is' : 'videos are'} saved, and the current filter hides ${videos.length === 1 ? 'it' : 'them all'}.</p>
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
  const chosen = [...activeTags];

  $('#tagFilterValue').textContent = chosen.length === 0
    ? 'All Videos'
    : chosen.length === 1 ? hashed(chosen[0]) : `${chosen.length} Tags`;

  const counts = new Map(tags.map((tag) => [tag, videos.filter((v) => v.tags?.includes(tag)).length]));

  $('#tagFilterList').innerHTML = tags.length === 0
    ? `<li class="multi-option" aria-disabled="true">No Tags Yet</li>`
    /* data-tag stays BARE. It is the key, and only the visible text is
       hashed. Hashing the key would break every lookup against `videos`. */
    : tags.map((tag, i) => `<li class="multi-option" role="option" id="tagOpt-${i}"
        data-tag="${escape(tag)}" aria-selected="${activeTags.has(tag) ? 'true' : 'false'}">
        <span class="multi-box">${icon('check')}</span>
        <span>${escape(hashed(tag))}</span>
        <span class="multi-count">${counts.get(tag)}</span>
      </li>`).join('');

  /* An option removed while the panel is open must not leave the active
     index pointing past the end of the list. */
  if (multi.index >= tags.length) multi.index = tags.length - 1;
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

  $('#sortKey').value = sort.key;
  $('#sortDir').value = String(sort.dir);
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

/* Replace the fragment being typed, keep any complete tags before it. */
function accept(tag) {
  const input = suggest.input;
  if (!input) return;
  const parts = input.value.split(',');
  parts[parts.length - 1] = tag;
  const id = input.dataset.id;
  closeSuggest();
  addTags(id, parts.join(','));
}

/* ==========================================================================
   Mutations
   ========================================================================== */

function addTags(id, raw) {
  const tags = raw.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  const video = videos.find((v) => v.id === id);
  if (!video || !tags.length) return;

  const seen = new Map((video.tags || []).map((t) => [t.toLowerCase(), t]));
  tags.forEach((tag) => { if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag); });
  video.tags = [...seen.values()];

  save();
  render();
  /* The row was rebuilt, so put the cursor back where the reader left it. */
  $(`.tag-input[data-id="${CSS.escape(id)}"]`)?.focus();
}

async function refreshMissingMetadata() {
  const incomplete = videos.filter((v) =>
    (!v.duration || v.duration === '—' || !v.uploadedAt) && !metadataRequested.has(v.id));
  if (!incomplete.length) return;

  incomplete.forEach((v) => metadataRequested.add(v.id));

  const refreshed = await Promise.all(incomplete.map(async (video) => {
    try {
      const response = await fetch(`/api/video?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + video.id)}`);
      if (!response.ok) return video;
      const data = await response.json();
      return { ...video, ...data, tags: video.tags, addedAt: video.addedAt };
    } catch { return video; }
  }));

  const updates = new Map(refreshed.map((v) => [v.id, v]));
  videos = videos.map((v) => updates.get(v.id) || v);
  save();
  render();
}

async function addVideo() {
  const url = $('#videoUrl').value.trim();
  const status = $('#addStatus');
  if (!url) return;

  $('#addBtn').disabled = true;
  status.textContent = 'Reading video details…';

  try {
    const response = await fetch(`/api/video?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (videos.some((v) => v.id === data.id)) throw new Error('That video is already in your watchlist.');

    videos.push({ ...data, addedAt: new Date().toISOString(), tags: [] });
    tombstones = tombstones.filter((t) => t.id !== data.id);
    save();
    $('#videoUrl').value = '';
    status.innerHTML = data.limited
      ? 'Added. Set <code>YOUTUBE_API_KEY</code> in Vercel to fetch duration and upload date.'
      : 'Added to your watchlist.';
    render();
  } catch (error) {
    status.textContent = error.message || 'Could not add that video.';
  } finally {
    $('#addBtn').disabled = false;
  }
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

function fileText() {
  const rows = videos.map((v) => `| ${cell(v.title)} | ${cell(v.channel)} | ${cell(v.duration || '—')} `
    + `| ${cell(v.uploadedAt ? v.uploadedAt.slice(0, 10) : '—')} | ${cell((v.tags || []).join(' '))} |`);

  return [
    '# YeeTlist watchlist',
    '',
    `> ${videos.length} ${videos.length === 1 ? 'video' : 'videos'}. Written ${new Date().toISOString()} by YeeTlist.`,
    '',
    '| Video | Channel | Duration | Uploaded | Tags |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '<!-- YeeTlist data below. The table above is for reading; this block is what imports. -->',
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
    if (!existing) return byId.set(video.id, { ...video, tags: [...(video.tags || [])] });

    const richer = (a, b) =>
      (a.duration && a.duration !== '—' ? 1 : 0) + (a.uploadedAt ? 1 : 0)
      >= (b.duration && b.duration !== '—' ? 1 : 0) + (b.uploadedAt ? 1 : 0) ? a : b;

    const base = richer(existing, video);
    const seen = new Map();
    [...(existing.tags || []), ...(video.tags || [])]
      .forEach((t) => { if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t); });

    byId.set(video.id, {
      ...base,
      tags: [...seen.values()],
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

/* The file type picks the operation. A .md or .json merges a watchlist. An
   .html is a bookmarks export, so it gets parsed for YouTube links. */
function importFile(file) {
  const isHtml = /\.html?$/i.test(file.name) || file.type === 'text/html';
  const reader = new FileReader();
  reader.onerror = () => toast('error', 'That file could not be read.');
  reader.onload = () => {
    const text = String(reader.result);
    if (isHtml) return importBookmarks(text);

    try {
      const incoming = parseFile(text);
      const merged = merge({ videos, deleted: tombstones }, incoming);
      videos = merged.videos;
      tombstones = merged.deleted;
      save();
      render();
      toast('ok', `Imported ${videos.length} ${videos.length === 1 ? 'video' : 'videos'}.`);
    } catch {
      toast('error', 'That file is not a YeeTlist export.',
        'Export a .md from YeeTlist, or pick a bookmarks .html file instead.');
    }
  };
  reader.readAsText(file);
}

/* ==========================================================================
   Bookmarks import
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

/* DOMParser neither runs scripts nor fetches anything for text/html, and the
   result is never put into the live document. Only hrefs are read from it. */
function youtubeLinksIn(html) {
  const found = new Map();

  const add = (href, title) => {
    const id = videoIdFrom(href);
    if (!id || found.has(id)) return;
    found.set(id, String(title || '').replace(/\s+/g, ' ').trim().slice(0, 300));
  };

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('a[href]').forEach((a) => add(a.getAttribute('href'), a.textContent));
  } catch { /* fall through to the text scan */ }

  /* Belt and braces: some exporters write bare URLs with no anchor at all.
     The anchor pass runs first, so a link with a real title keeps it. */
  const bare = html.match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  bare.forEach((href) => add(href, ''));

  return found;
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
async function importBookmarks(html) {
  if (importRun.active) return;

  const found = youtubeLinksIn(html);
  if (found.size === 0) {
    return toast('warn', 'No YouTube links in that file.',
      'It was read successfully and held no youtube.com or youtu.be video links.');
  }

  const known = new Set(videos.map((v) => v.id));
  const fresh = [...found.keys()].filter((id) => !known.has(id));
  const counts = { added: 0, duplicate: found.size - fresh.length, failed: 0 };

  if (fresh.length === 0) {
    return toast('warn', 'Nothing new to import.', found.size === 1
      ? 'That link was already in your watchlist.'
      : `All ${found.size} links were already in your watchlist.`);
  }

  importRun.active = true;
  importRun.cancelled = false;
  showImportPanel(fresh.length);

  let done = 0;
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
        videos.push({ ...data, addedAt, tags: [] });
        tombstones = tombstones.filter((t) => t.id !== id);
        counts.added += 1;
      });

      done += chunk.length;
      /* Saved per chunk, so closing the tab mid-import keeps what resolved. */
      save();
      setImportProgress(done, fresh.length, counts);
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
  reportImport(counts, found.size, importRun.cancelled);
  importRun.error = null;
}

function reportImport(counts, total, cancelled) {
  const detail = [
    counts.duplicate ? `${counts.duplicate} already saved` : null,
    counts.failed ? `${counts.failed} could not be read` : null,
    importRun.error ? importRun.error : null,
  ].filter(Boolean).join(' · ');

  const noun = counts.added === 1 ? 'video' : 'videos';

  if (cancelled) {
    return toast('warn', `Import stopped. ${counts.added} ${noun} added.`,
      detail || `${total - counts.added - counts.duplicate} were not checked.`);
  }
  if (counts.added === 0) {
    return toast('error', 'Nothing was imported.', detail || 'None of the links could be read.');
  }
  toast(counts.failed || importRun.error ? 'warn' : 'ok',
    `Imported ${counts.added} ${noun}.`, detail);
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

function driveStatus(state, words) {
  $('#syncDot').dataset.state = state;
  $('#syncWords').textContent = words;
}

function renderDrive() {
  const on = DRIVE.connected();
  $('#driveConnect').hidden = on;
  $('#driveGroup').hidden = !on;
  if (!on) driveStatus('local', 'Stored locally');
}

/* A control the deployment cannot honour is worse than an absent one, so the
   Connect button appears only once the environment carries a client ID, and
   Pick appears only with an API key for the Picker. */
async function renderDriveAvailability() {
  try {
    const { driveEnabled } = await DRIVE.settings();
    $('#driveConnect').hidden = !driveEnabled || DRIVE.connected();
    if (!driveEnabled) driveStatus('local', 'Stored locally');
  } catch {
    $('#driveConnect').hidden = true;
  }
}

async function driveConnect({ interactive = true } = {}) {
  try {
    driveStatus('busy', 'Connecting…');
    await (interactive ? DRIVE.connect() : DRIVE.resume());
    renderDrive();
    await drivePull({ announce: true });
  } catch (error) {
    if (interactive) {
      driveStatus('error', 'Not connected');
      $('#addStatus').textContent = error.message;
    } else {
      DRIVE.forget();
      renderDrive();
    }
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
      if (announce) $('#addStatus').textContent = `Created ${DRIVE.FILENAME} in your Drive.`;
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
      $('#addStatus').textContent = gained > 0
        ? `Read ${DRIVE.FILENAME} from Drive. ${gained} ${gained === 1 ? 'video' : 'videos'} added.`
        : `Read ${DRIVE.FILENAME} from Drive. Nothing new.`;
    }
    await drivePush();
  } catch (error) {
    driveStatus('error', 'Sync failed');
    $('#addStatus').textContent = error.message;
  }
}

function queueDrivePush() {
  if (!DRIVE.connected()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(drivePush, 1200);
}

async function drivePush() {
  if (!DRIVE.connected() || pushing) return;
  pushing = true;
  try {
    driveStatus('busy', 'Saving…');
    const id = DRIVE.fileId();
    const written = id ? await DRIVE.update(id, fileText()) : await DRIVE.create(fileText());
    DRIVE.remember({ fileId: written.id, syncedAt: written.modifiedTime });
    driveStatus('ok', 'Synced to Drive');
  } catch (error) {
    driveStatus('error', 'Sync failed');
    $('#addStatus').textContent = error.message;
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

const clearFilters = () => {
  activeTags.clear();
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

function toggleTag(tag) {
  if (activeTags.has(tag)) activeTags.delete(tag); else activeTags.add(tag);
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
  if (option) toggleTag(option.dataset.tag);
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
    toggleTag(multiOptions()[multi.index].dataset.tag);
  }
});

/* A click anywhere else closes it. Pointerdown, so a click that lands on
   another control still reaches that control. */
addEventListener('pointerdown', (event) => {
  if (multi.open && !event.target.closest('#tagFilter')) closeMulti();
});

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
  sort.key = event.target.value;
  render();
});

$('#sortDir').addEventListener('change', (event) => {
  sort.dir = Number(event.target.value);
  render();
});

$('#rows').addEventListener('change', (event) => {
  if (!event.target.classList.contains('select')) return;
  const id = event.target.dataset.id;
  if (event.target.checked) selected.add(id); else selected.delete(id);
  render();
});

$('#allCheck').addEventListener('change', (event) => {
  const filtered = filteredVideos();
  filtered.forEach((v) => { if (event.target.checked) selected.add(v.id); else selected.delete(v.id); });
  render();
});

$('#rows').addEventListener('click', (event) => {
  const button = event.target.closest('.row-remove');
  if (button) openDelete([button.dataset.id]);
});

$('#deleteSelected').addEventListener('click', () => openDelete(selected));

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
  if (action === 'retry') { listState = 'ready'; render(); refreshMissingMetadata(); }
});

/* ---- tag autocomplete ---------------------------------------------------- */

$('#rows').addEventListener('input', (event) => {
  if (event.target.classList.contains('tag-input')) openSuggest(event.target);
});

$('#rows').addEventListener('focusin', (event) => {
  if (event.target.classList.contains('tag-input')) openSuggest(event.target);
});

$('#rows').addEventListener('focusout', (event) => {
  if (event.target.classList.contains('tag-input')) setTimeout(closeSuggest, 0);
});

$('#rows').addEventListener('keydown', (event) => {
  const input = event.target;
  if (!input.classList.contains('tag-input')) return;
  const open = suggest.input === input && !suggest.list?.hidden;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (open) moveSuggest(1); else openSuggest(input);
    return;
  }
  if (event.key === 'ArrowUp' && open) { event.preventDefault(); moveSuggest(-1); return; }
  if (event.key === 'Escape' && open) { event.preventDefault(); closeSuggest(); return; }

  if (event.key === 'Enter') {
    event.preventDefault();
    if (open && suggest.index >= 0) accept(suggest.options[suggest.index]);
    else { closeSuggest(); addTags(input.dataset.id, input.value); }
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
    addTags(input.dataset.id, input.value);
  }
});

addEventListener('scroll', positionSuggest, { passive: true, capture: true });
addEventListener('resize', positionSuggest);

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
$('#driveDisconnect').addEventListener('click', () => {
  DRIVE.disconnect();
  renderDrive();
  $('#addStatus').textContent = 'Disconnected. Your watchlist stays in this browser.';
});

/* ==========================================================================
   Start
   ========================================================================== */

load();
renderDrive();
render();
refreshMissingMetadata();
renderDriveAvailability();

/* A remembered connection resumes without a prompt. It fails quietly when
   the Google session has gone, because an unasked-for popup is worse. */
if (DRIVE.connected()) driveConnect({ interactive: false });
