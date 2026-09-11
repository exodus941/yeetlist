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
let activeTag = '';
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

function filteredVideos() {
  return videos
    .filter((v) => {
      const haystack = `${v.title} ${v.channel} ${(v.tags || []).join(' ')}`.toLowerCase();
      return (!activeTag || v.tags?.includes(activeTag)) && haystack.includes(searchTerm);
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
  const filtering = Boolean(activeTag || searchTerm);

  $('#listCount').textContent = filtering
    ? `${filtered.length} of ${videos.length} ${videos.length === 1 ? 'video' : 'videos'}`
    : `${videos.length} ${videos.length === 1 ? 'video' : 'videos'} waiting`;

  $('#rows').innerHTML = listState === 'loading' ? skeleton() : filtered.map(row).join('');

  renderState(filtered.length, filtering);
  renderTagFilters();
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

const row = (v) => `<tr class="${selected.has(v.id) ? 'row-selected' : ''}" data-id="${escape(v.id)}">
  <td class="check">
    <label class="check-hit">
      <input class="checkbox select" data-id="${escape(v.id)}" type="checkbox"
             ${selected.has(v.id) ? 'checked' : ''} aria-label="Select ${escape(v.title)}">
    </label>
  </td>
  <td>
    <span class="title-cell">
      <a class="video-title" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}"
         target="_blank" rel="noopener">${escape(v.title)}</a>
      <span class="subtle">youtube.com</span>
    </span>
  </td>
  <td>${escape(v.channel)}</td>
  <td class="amount">${escape(v.duration || '—')}</td>
  <td>${date(v.uploadedAt)}</td>
  <td>${date(v.addedAt)}</td>
  <td>
    <div class="tags">
      ${(v.tags || []).map((t) => `<span class="tag-chip">${escape(t)}</span>`).join('')}
      <input class="tag-input" data-id="${escape(v.id)}" placeholder="+ add tags"
             aria-label="Add tags to ${escape(v.title)}" autocomplete="off"
             role="combobox" aria-expanded="false" aria-autocomplete="list"
             aria-controls="tagSuggest">
    </div>
  </td>
  <td>
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
      <h3>That did not work</h3>
      <p>${escape(stateMessage)}</p>
      <button class="btn btn-sm" type="button" data-action="retry">${icon('refresh')} Try again</button>`;
    return;
  }

  box.removeAttribute('role');

  if (videos.length === 0) {
    box.hidden = false;
    box.innerHTML = `${icon('inbox')}
      <h3>Your watchlist is clear</h3>
      <p>Paste a YouTube link above to save a video for later.</p>
      <button class="btn btn-sm btn-primary" type="button" data-action="focus-add">Add your first video</button>`;
    return;
  }

  if (shown === 0 && filtering) {
    box.hidden = false;
    box.innerHTML = `${icon('search-x')}
      <h3>No videos match</h3>
      <p>${videos.length} ${videos.length === 1 ? 'video is' : 'videos are'} saved, and the current filter hides ${videos.length === 1 ? 'it' : 'them all'}.</p>
      <button class="btn-text" type="button" data-action="clear-filter">Clear filters</button>`;
    return;
  }

  box.hidden = true;
  box.innerHTML = '';
}

function renderTagFilters() {
  const tags = allTags();
  $('#tagFilters').innerHTML = [
    `<button class="tag ${activeTag ? '' : 'active'}" type="button" data-tag=""
       aria-pressed="${activeTag ? 'false' : 'true'}">All videos</button>`,
    ...tags.map((tag) => `<button class="tag ${activeTag === tag ? 'active' : ''}" type="button"
       data-tag="${escape(tag)}" aria-pressed="${activeTag === tag ? 'true' : 'false'}">${escape(tag)}</button>`),
  ].join('');
}

/* Paint is not a state. The sorted column says so in aria-sort, and its mark
   shows which way. */
function renderSortState() {
  $$('.th-sort').forEach((button) => {
    const th = button.closest('th');
    const active = button.dataset.key === sort.key;
    const name = active ? (sort.dir === 1 ? 'sort-up' : 'sort-down') : 'sort';
    button.querySelector('use').setAttribute('href', '#i-' + name);
    if (active) th.setAttribute('aria-sort', sort.dir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
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

  list.innerHTML = options.map((tag, i) => `<li role="option" id="tagSuggest-${i}"
    data-value="${escape(tag)}" aria-selected="false">${escape(tag)}</li>`).join('');

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

  $('#confirmTitle').textContent = many ? `Delete ${deletion.length} videos?` : 'Remove this video?';
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

function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = parseFile(String(reader.result));
      const merged = merge({ videos, deleted: tombstones }, incoming);
      videos = merged.videos;
      tombstones = merged.deleted;
      save();
      render();
      $('#addStatus').textContent = `Imported. ${videos.length} ${videos.length === 1 ? 'video' : 'videos'} now saved.`;
    } catch {
      $('#addStatus').textContent = 'That file is not a YeeTlist export.';
    }
  };
  reader.readAsText(file);
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
    const { driveEnabled, pickerEnabled } = await DRIVE.settings();
    $('#driveConnect').hidden = !driveEnabled || DRIVE.connected();
    $('#drivePick').hidden = !pickerEnabled;
    if (!driveEnabled) driveStatus('local', 'Stored locally');
  } catch {
    $('#driveConnect').hidden = true;
    $('#drivePick').hidden = true;
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

async function drivePick() {
  try {
    const chosen = await DRIVE.pick();
    if (!chosen) return;
    $('#addStatus').textContent = `Using ${chosen.name} from your Drive.`;
    await drivePull({ announce: true });
  } catch (error) {
    driveStatus('error', 'Sync failed');
    $('#addStatus').textContent = error.message;
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
  activeTag = '';
  searchTerm = '';
  $('#search').value = '';
  render();
};

$('#clearFilter').addEventListener('click', clearFilters);

$('#tagFilters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');
  if (!button) return;
  activeTag = button.dataset.tag;
  render();
});

$('thead').addEventListener('click', (event) => {
  const button = event.target.closest('.th-sort');
  if (!button) return;
  const key = button.dataset.key;
  sort.dir = sort.key === key ? -sort.dir : 1;
  sort.key = key;
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
$('#importFile').addEventListener('change', (event) => {
  if (event.target.files[0]) importFile(event.target.files[0]);
  event.target.value = '';
});

/* ---- drive --------------------------------------------------------------- */

$('#driveConnect').addEventListener('click', () => driveConnect({ interactive: true }));
$('#driveSync').addEventListener('click', () => drivePull({ announce: true }));
$('#drivePick').addEventListener('click', drivePick);
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
