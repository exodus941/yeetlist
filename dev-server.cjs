// Dependency-free local preview. Vercel runs api/video.js in production.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const idFrom = value => { try { const u = new URL(value); return u.hostname === 'youtu.be' ? u.pathname.slice(1) : (u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1]); } catch { return null; } };
// Load local secrets without adding a dependency. Do not commit .env.local.
const localEnv = path.join(root, '.env.local');
if (fs.existsSync(localEnv)) fs.readFileSync(localEnv, 'utf8').split(/\r?\n/).forEach(line => { const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ''); });
const duration = iso => { const p = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if (!p) return '—'; const parts = [(+p[1]||0), (+p[2]||0), (+p[3]||0)]; return parts.filter((v, i) => i || v > 0).map(v => String(v).padStart(2, '0')).join(':').replace(/^0/, ''); };

// api/_session.js is ESM and this file is CommonJS, so it arrives through a
// dynamic import. Cached, because the module holds a derived key.
let sessionModule = null;
const session = () => (sessionModule ||= import('./api/_session.js'));

// A Vercel handler answers through res.status().json() and res.send(). Node's
// own ServerResponse has neither, so the four routes get them here rather
// than being rewritten for the preview. Rewriting them is how the preview
// starts testing something other than what ships.
function vercelShim(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
  res.send = (body) => { res.end(String(body)); return res; };
  return res;
}

async function oauth(requestUrl, req, res) {
  const name = requestUrl.pathname.slice('/api/oauth/'.length);
  if (!/^(start|callback|token|disconnect)$/.test(name)) { res.writeHead(404); return res.end('Not found'); }
  try {
    const { default: handler } = await import(`./api/oauth/${name}.js`);
    return handler(req, vercelShim(res));
  } catch (error) {
    res.writeHead(500, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ error: String(error && error.message || error) }));
  }
}
http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  // Mirrors api/config.js. The public Google identifier comes from the
  // environment, so it is not in the repository.
  if (requestUrl.pathname === '/api/config') {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const { serverAuthReady } = await session();
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ clientId, driveEnabled: Boolean(clientId), serverAuth: serverAuthReady() }));
  }
  // The OAuth routes run the SAME module the serverless functions import, so
  // the local preview cannot disagree with production about a cookie, a
  // cipher or a redirect address. A second implementation would drift, and
  // these are the routines a mistake in is silent.
  if (requestUrl.pathname.startsWith('/api/oauth/')) return oauth(requestUrl, req, res);
  // Mirrors api/videos.js. Up to 50 ids in one call, so a bookmarks import
  // costs one quota unit per chunk rather than one per video.
  if (requestUrl.pathname === '/api/videos') {
    const ids = String(requestUrl.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(s => /^[A-Za-z0-9_-]{11}$/.test(s));
    if (!ids.length || ids.length > 50) { res.writeHead(400, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Send between 1 and 50 valid video ids.'})); }
    try {
      if (!process.env.YOUTUBE_API_KEY) {
        const videos = await Promise.all(ids.map(async id => {
          try { const o = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`).then(r => r.ok ? r.json() : null)
            return o ? { id, title:o.title, channel:o.author_name, duration:'—', uploadedAt:null, limited:true } : null } catch { return null }
        }));
        res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({videos:videos.filter(Boolean), limited:true}));
      }
      const data = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&maxResults=50&id=${ids.join(',')}&key=${process.env.YOUTUBE_API_KEY}`).then(r => r.json());
      if (data.error) { res.writeHead(502, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'YouTube refused the request: ' + (data.error.message || 'no reason given')})); }
      const videos = (data.items || []).map(v => ({ id:v.id, title:v.snippet.title, channel:v.snippet.channelTitle, duration:duration(v.contentDetails && v.contentDetails.duration), uploadedAt:v.snippet.publishedAt }));
      res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({videos}));
    } catch { res.writeHead(502, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Could not reach YouTube.'})); }
  }
  if (requestUrl.pathname === '/api/video') {
    const input = requestUrl.searchParams.get('url') || '', id = idFrom(input);
    if (!id) { res.writeHead(400, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Please paste a valid YouTube video link.'})); }
    try {
      // Mirrors api/video.js: report Google's own reason rather than
      // collapsing a refused key into "not found".
      if (process.env.YOUTUBE_API_KEY) { const data = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${id}&key=${process.env.YOUTUBE_API_KEY}`).then(r => r.json());
        if (data.error) { res.writeHead(502, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'YouTube refused the request: ' + (data.error.message || 'no reason given')})); }
        const video = data.items?.[0]; if (!video) throw new Error(); res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({id,title:video.snippet.title,channel:video.snippet.channelTitle,duration:duration(video.contentDetails.duration),uploadedAt:video.snippet.publishedAt})); }
      const oembed = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(input)}&format=json`).then(r => r.json()); res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({id,title:oembed.title,channel:oembed.author_name,duration:'—',uploadedAt:null,limited:true}));
    }
    catch { res.writeHead(422, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'That video could not be read.'})); }
  }
  // Same route as /api/link below: the real module, imported. A playlist is
  // read once and its ids go through /api/videos, so a second implementation
  // here would be the one place the preview could disagree.
  if (requestUrl.pathname === '/api/playlist') {
    try {
      const { default: handler } = await import('./api/playlist.js');
      return handler({ query: { url: requestUrl.searchParams.get('url') || '' } }, vercelShim(res));
    } catch (error) {
      res.writeHead(500, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:String(error && error.message || error)}));
    }
  }
  // api/link.js is ESM and this file is CommonJS, so it arrives through a
  // dynamic import rather than being restated here. One implementation, so
  // the preview cannot answer differently from production.
  if (requestUrl.pathname === '/api/link') {
    try {
      const { default: handler } = await import('./api/link.js');
      return handler(
        { query: { url: requestUrl.searchParams.get('url') || '' } },
        { status(code) { this._code = code; return this },
          json(body) { res.writeHead(this._code || 200, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); } },
      );
    } catch (error) {
      res.writeHead(500, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:String(error && error.message || error)}));
    }
  }
  const relative = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
  const file = path.resolve(root, relative);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'}); fs.createReadStream(file).pipe(res);
}).listen(3000, () => console.log('YeeTlist running at http://localhost:3000'));
