import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { workspaceRequest } from './workspace.mjs';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
if (!fs.existsSync(path.join(root, 'index.html')))
  throw Error('Build the web client with npm run build first.');
const middleware = workspaceRequest(process.env);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
const server = http.createServer((req, res) => {
  void middleware(req, res, () => {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      res.writeHead(405).end();
      return;
    }
    let relative;
    try {
      relative =
        decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') ||
        'index.html';
    } catch {
      res.writeHead(400).end();
      return;
    }
    const file = path.resolve(root, relative);
    if (
      !file.startsWith(path.resolve(root) + path.sep) ||
      relative.split(/[\\/]/).some((s) => s.startsWith('.'))
    ) {
      res.writeHead(404).end();
      return;
    }
    fs.stat(file, (e, st) => {
      if (e || !st.isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Content-Length': st.size,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        'Cache-Control': relative.startsWith('assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
      if (req.method === 'HEAD') res.end();
      else
        fs.createReadStream(file)
          .on('error', () => res.destroy())
          .pipe(res);
    });
  }).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
const host = process.env.HOST || '127.0.0.1',
  port = Number(process.env.PORT || 4188);
server.listen(port, host, () => console.log('Relay web on http://' + host + ':' + server.address().port));
