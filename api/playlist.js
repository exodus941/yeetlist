/* Every video id behind a playlist address.

   IT RETURNS IDS AND NOTHING ELSE. /api/videos already reads the metadata in
   chunks of 50, with the progress panel the file import uses, so this adds no
   second path for the same work.

   A CHANNEL IS NOT A PLAYLIST HERE. Their instruction, 19 September 2026: a
   channel link goes into Other Bookmarks as one row. So this answers for a
   list id alone, and everything else is somebody's bookmark.

   Keep YOUTUBE_API_KEY unrestricted by HTTP referrer. This runs on a server
   and sends no referrer, so a browser-restricted key is refused outright. */

const API = 'https://www.googleapis.com/youtube/v3';

/* THERE IS NO CAP ON THE LIST, BECAUSE THE QUOTA WAS NEVER THE REASON.
   playlistItems costs ONE unit per call whatever it returns, against a daily
   10,000, so a 4,000-video list spends 80 of them. A 500 ceiling was my own
   invention and it silently dropped whatever sat past it.

   WHAT DOES BIND IS THE FUNCTION'S OWN CLOCK. So this pages until its budget
   runs out and hands the next token back. The caller asks again with that
   token, so the list is read in full across as many calls as it takes. */
const BUDGET_MS = 8000;

/* A LIST ID THE API CANNOT READ. A radio list is generated per viewer, and
   Watch Later and Liked belong to one account. */
const PRIVATE_LIST = /^(RD|WL|LL)/;

const ask = (path) => fetch(`${API}/${path}&key=${process.env.YOUTUBE_API_KEY}`)
  .then((r) => r.json());

export default async function handler(req, res) {
  let url;
  try { url = new URL(req.query.url || ''); } catch { url = null; }

  const list = url?.searchParams.get('list');
  if (!list) return res.status(400).json({ error: 'Paste a playlist link.' });

  if (PRIVATE_LIST.test(list)) {
    return res.status(422).json({ error: 'That list belongs to one account, so it cannot be read.' });
  }

  /* WITHOUT A KEY THERE IS NO ANSWER AT ALL. oEmbed reads one video and knows
     nothing about a playlist, so this says so rather than returning an empty
     list that reads as an empty playlist. */
  if (!process.env.YOUTUBE_API_KEY) {
    return res.status(501).json({ error: 'Adding a playlist needs a YouTube API key.' });
  }

  const named = await ask(`playlists?part=snippet&id=${encodeURIComponent(list)}`);
  if (named.error) return res.status(502).json({ error: named.error.message });
  if (!named.items?.[0]) return res.status(404).json({ error: 'That playlist could not be found.' });

  const ids = [];
  let page = String(req.query.page || '');
  const started = Date.now();

  do {
    const json = await ask(
      `playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(list)}`
      + (page ? `&pageToken=${encodeURIComponent(page)}` : ''),
    );
    if (json.error) return res.status(502).json({ error: json.error.message });

    (json.items || []).forEach((item) => {
      const id = item.contentDetails?.videoId;
      if (id) ids.push(id);
    });

    page = json.nextPageToken || '';
  } while (page && Date.now() - started < BUDGET_MS);

  /* `next` is empty when the list is finished. Anything else is a token the
     caller passes straight back, so nothing is ever dropped. */
  return res.status(200).json({ name: named.items[0].snippet.title, ids, next: page });
}
