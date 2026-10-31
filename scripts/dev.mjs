import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import handler from '../api/f1.js';
try { process.loadEnvFile('.env'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const root = resolve('.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/f1') return handler(req, res);
  let path;
  try { path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`); }
  catch { res.writeHead(400).end('Bad request'); return; }
  if (!path.startsWith(root + sep) || !['.html', '.js', '.css', '.svg'].includes(extname(path)) || /[/\\](api|server|test|scripts|node_modules)[/\\]/.test(path)) {
    res.writeHead(404).end('Not found'); return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': `${types[extname(path)]}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${server.address().port}`));
