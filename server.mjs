import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/theme.js': ['theme.js', 'text/javascript; charset=utf-8'],
  '/core.js': ['core.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/products.svg': ['products.svg', 'image/svg+xml'],
  '/icons.svg': ['icons.svg', 'image/svg+xml'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
export async function createAppServer() {
  const files = new Map();
  for (const [path, [file, type]] of Object.entries(assets)) {
    const body = await readFile(new URL(`./public/${file}`, import.meta.url));
    files.set(path, { body, compressed: gzipSync(body), type, etag: `W/"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"` });
  }
  return createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    let path;
    try { path = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400); res.end(); return; }
    const file = files.get(path);
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : 'Not found'); return; }
    res.setHeader('Content-Type', file.type);
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('ETag', file.etag);
    res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === file.etag) { res.writeHead(304); res.end(); return; }
    const gzip = /(?:^|,)\s*gzip\s*(?:,|$)/.test(req.headers['accept-encoding'] || '');
    const body = gzip ? file.compressed : file.body;
    if (gzip) res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', body.length);
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createAppServer();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  server.on('error', error => { console.error(`Could not start Bare: ${error.message}`); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Bare is ready at http://${host}:${port}`));
}
