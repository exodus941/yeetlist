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

/* 500 IS A LIMIT WITH A REASON. playlistItems answers 50 per call, and a list
   of 4000 would otherwise spend 80 calls and empty the day's quota on one
   paste. The answer says it was cut. */
const MAX_PAGES = 10;

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
  let page = '';
  let truncated = false;

  for (let at = 0; at < MAX_PAGES; at += 1) {
    const json = await ask(
      `playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(list)}`
      + (page ? `&pageToken=${page}` : ''),
    );
    if (json.error) return res.status(502).json({ error: json.error.message });

    (json.items || []).forEach((item) => {
      const id = item.contentDetails?.videoId;
      if (id) ids.push(id);
    });

    page = json.nextPageToken || '';
    if (!page) break;
    if (at === MAX_PAGES - 1) truncated = true;
  }

  return res.status(200).json({ name: named.items[0].snippet.title, ids, truncated });
}
