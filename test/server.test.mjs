import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.mjs';
import { once } from 'node:events';
import { request } from 'node:http';

test('server serves the app, compression, conditional requests, and safe paths', async t => {
  const server = await createAppServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Amazon, simplified/);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const js = await fetch(`${base}/app.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal(js.headers.get('content-encoding'), 'gzip');
  assert.ok((await js.text()).includes('renderShop'));
  const cached = await fetch(`${base}/app.js`, { headers: { 'If-None-Match': js.headers.get('etag') } });
  assert.equal(cached.status, 304);
  const head = await fetch(`${base}/styles.css`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const path of ['/.env', '/package.json', '/server.mjs', '/..%2fpackage.json', '/missing']) assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  const compressed = await new Promise(resolve => {
    request(`${base}/app.js`, { headers: { 'Accept-Encoding': 'gzip' } }, res => {
      let size = 0;
      res.on('data', chunk => size += chunk.length);
      res.on('end', () => resolve(size));
    }).end();
  });
  assert.ok(compressed < 12000, `App script is ${compressed} bytes gzipped`);
});
