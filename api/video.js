// Vercel serverless function. Keep YOUTUBE_API_KEY in Vercel environment variables.
const videoIdFrom = (value) => {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1);
    if (url.hostname.includes('youtube.com')) return url.searchParams.get('v') || url.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1];
  } catch {}
  return null;
};

const isoDuration = (iso) => {
  const p = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!p) return '—';
  const seconds = (+p[1] || 0) * 3600 + (+p[2] || 0) * 60 + (+p[3] || 0);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .filter((v, i) => i || v > 0).map(v => String(v).padStart(2, '0')).join(':').replace(/^0/, '');
};

export default async function handler(req, res) {
  const id = videoIdFrom(req.query.url || '');
  if (!id) return res.status(400).json({ error: 'Please paste a valid YouTube video link.' });
  if (!process.env.YOUTUBE_API_KEY) {
    try {
      const oembed = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(req.query.url)}&format=json`).then(r => r.json());
      return res.status(200).json({ id, title: oembed.title, channel: oembed.author_name, duration: '—', uploadedAt: null, limited: true });
    } catch { return res.status(422).json({ error: 'That video could not be read.' }); }
  }
  const endpoint = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${id}&key=${process.env.YOUTUBE_API_KEY}`;
  const json = await fetch(endpoint).then(r => r.json()).catch(() => ({}));

  /* Google's own message names the cause, so report it rather than collapsing
     every failure into "not found".
     Measured: this endpoint returned 404 "Video not found or unavailable" in
     production for a video that resolved locally in the same code. The video
     existed. The key was being refused, and the reader was sent looking for a
     deleted video instead of at their own configuration.

     The usual reasons are a key restricted by HTTP referrer, which a
     serverless call can never satisfy because it sends no referrer, and the
     YouTube Data API not being enabled on the key's project. */
  if (json.error) {
    return res.status(502).json({
      error: 'YouTube refused the request: ' + (json.error.message || 'no reason given'),
    });
  }
  if (!json.items?.[0]) return res.status(404).json({ error: 'Video not found or unavailable.' });
  const video = json.items[0];
  return res.status(200).json({ id, title: video.snippet.title, channel: video.snippet.channelTitle, duration: isoDuration(video.contentDetails.duration), uploadedAt: video.snippet.publishedAt });
}
