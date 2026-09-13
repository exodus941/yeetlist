// Vercel serverless function. Reads a page's own name so a bookmark is not
// just an address. No key, no account: it fetches the page and reads the
// head. Anything it cannot read falls back to the hostname on the client.

/* og:site_name is the name a site gives ITSELF, and <title> is the name of
   one page on it. The column asks for the site, so og wins where it exists,
   and the title carries the rest. */
const META = /<meta[^>]+(?:property|name)=["']og:site_name["'][^>]*content=["']([^"']+)["']/i;
const META_REVERSED = /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:site_name["']/i;
const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

const decode = (value) => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(+code))
  .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
  .replace(/\s+/g, ' ')
  .trim();

export default async function handler(req, res) {
  let target;
  try {
    target = new URL(req.query.url || '');
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('scheme');
  } catch {
    return res.status(400).json({ error: 'Please paste a valid link.' });
  }

  /* A PAGE CAN BE ANY SIZE, AND ONLY ITS HEAD IS WANTED. Reading the whole
     body to find a title in the first kilobyte spends the function's time on
     bytes nobody reads. The stream is dropped once the head has arrived. */
  const stop = AbortSignal.timeout(6000);
  let html = '';
  try {
    const page = await fetch(target.toString(), {
      signal: stop,
      redirect: 'follow',
      headers: {
        /* Named plainly. A server that refuses this is one the client's own
           fallback covers, and pretending to be a browser to get past it is
           not a thing this app should teach. */
        'user-agent': 'YeeTlist/1.0 (+https://yeetlist.vercel.app)',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!page.ok) return res.status(200).json({ title: '', reason: 'status ' + page.status });
    if (!/text\/html|application\/xhtml/i.test(page.headers.get('content-type') || '')) {
      return res.status(200).json({ title: '', reason: 'not a page' });
    }

    const reader = page.body.getReader();
    const decoder = new TextDecoder();
    while (html.length < 65536) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
  } catch (error) {
    /* NOT AN ERROR THE READER HAS TO ACT ON. The bookmark is still made, with
       the hostname as its name, so this answers 200 with an empty title. */
    return res.status(200).json({ title: '', reason: String(error.name || error) });
  }

  const site = html.match(META)?.[1] || html.match(META_REVERSED)?.[1] || '';
  const title = html.match(TITLE)?.[1] || '';
  const name = decode(site || title).slice(0, 200);

  return res.status(200).json({ title: name });
}
