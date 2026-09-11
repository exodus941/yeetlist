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
http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  // Mirrors api/config.js. Both public Google identifiers come from the
  // environment, so neither is in the repository.
  if (requestUrl.pathname === '/api/config') {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const apiKey = process.env.GOOGLE_API_KEY || '';
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ clientId, apiKey, driveEnabled: Boolean(clientId), pickerEnabled: Boolean(clientId && apiKey) }));
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
  const relative = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
  const file = path.resolve(root, relative);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'}); fs.createReadStream(file).pipe(res);
}).listen(3000, () => console.log('YeeTlist running at http://localhost:3000'));
