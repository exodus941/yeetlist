/* Metadata for MANY videos in one call.

   videos.list takes up to 50 ids per request and costs one quota unit either
   way, so a 200-link bookmarks file is 4 requests instead of 200. The client
   asks in smaller chunks than that, because a progress bar that moves four
   times is not a progress bar.

   Keep YOUTUBE_API_KEY unrestricted by HTTP referrer. This runs on a server
   and sends no referrer, so a browser-restricted key is refused outright. */

const ID = /^[A-Za-z0-9_-]{11}$/;

const isoDuration = (iso) => {
  const p = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!p) return '—';
  const seconds = (+p[1] || 0) * 3600 + (+p[2] || 0) * 60 + (+p[3] || 0);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .filter((v, i) => i || v > 0).map((v) => String(v).padStart(2, '0')).join(':').replace(/^0/, '');
};

export default async function handler(req, res) {
  const ids = String(req.query.ids || '')
    .split(',').map((s) => s.trim()).filter((s) => ID.test(s));

  if (!ids.length) return res.status(400).json({ error: 'No valid video ids were sent.' });
  if (ids.length > 50) return res.status(400).json({ error: 'Send 50 ids at most.' });

  /* Without a key there is no batch endpoint at all, so oEmbed is asked once
     per id. It gives a title and a channel and nothing else. */
  if (!process.env.YOUTUBE_API_KEY) {
    const videos = await Promise.all(ids.map(async (id) => {
      try {
        const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
        if (!r.ok) return null;
        const o = await r.json();
        return { id, title: o.title, channel: o.author_name, duration: '—', uploadedAt: null, limited: true };
      } catch { return null; }
    }));
    return res.status(200).json({ videos: videos.filter(Boolean), limited: true });
  }

  const endpoint = 'https://www.googleapis.com/youtube/v3/videos'
    + `?part=snippet,contentDetails&maxResults=50&id=${ids.join(',')}`
    + `&key=${process.env.YOUTUBE_API_KEY}`;

  const json = await fetch(endpoint).then((r) => r.json()).catch(() => ({}));

  /* Google's own message names the cause. Collapsing it into "not found"
     sends the reader looking for deleted videos instead of at their key. */
  if (json.error) {
    return res.status(502).json({
      error: 'YouTube refused the request: ' + (json.error.message || 'no reason given'),
    });
  }

  /* A private, deleted or region-blocked id is simply absent from items, so
     the caller learns which ones resolved by comparing against what it sent. */
  const videos = (json.items || []).map((v) => ({
    id: v.id,
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    duration: isoDuration(v.contentDetails?.duration),
    uploadedAt: v.snippet.publishedAt,
  }));

  return res.status(200).json({ videos });
}
