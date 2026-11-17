import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const worker = await readFile(new URL('../extension/worker.js', import.meta.url), 'utf8');
const bare = { url: 'https://undeadcommander.github.io/amazon-debloated/#/cart', frameId: 0 };
const amazon = { url: 'https://www.amazon.com/gp/cart/view.html', tab: { id: 7 }, frameId: 0 };
const job = { type: 'bare-cart:open', items: [{ id: 'B012345678', quantity: 2 }, { id: 'B087654321', quantity: 3 }] };
const claim = { type: 'bare-cart:claim' };

function launchWorker() {
  const listeners = {};
  const on = key => ({ addListener: callback => { listeners[key] = callback; } });
  const storage = {};
  const tabs = [];
  runInNewContext(worker, { URL, chrome: {
    runtime: { onMessageExternal: on('external'), onMessage: on('internal') },
    storage: { session: {
      async get(key) { return { [key]: storage[key] }; },
      async set(values) { Object.assign(storage, structuredClone(values)); },
      async remove(key) { delete storage[key]; },
    } },
    tabs: {
      onRemoved: on('removed'),
      async create({ url }) { tabs.push(url); return { id: 7 }; },
      async update(id, { url }) {
        assert.equal(id, 7);
        assert.ok(storage['bare-cart:7'], 'The job must be ready before Amazon loads');
        tabs.push(url);
      },
      async remove() {},
    },
  } });
  const send = (key, message, sender) => new Promise(resolve => {
    if (!listeners[key](message, sender, reply => resolve(structuredClone(reply)))) resolve(undefined);
  });
  return { send, tabs, close: () => listeners.removed(7) };
}

test('only the opened Amazon cart can claim the quantities and it can claim them once', async () => {
  const helper = launchWorker();
  assert.deepEqual(await helper.send('external', job, bare), { opened: true });
  assert.deepEqual(helper.tabs, ['about:blank', amazon.url]);
  assert.equal(await helper.send('internal', claim, { ...amazon, tab: { id: 8 } }), null);
  assert.equal(await helper.send('internal', claim, { ...amazon, url: 'https://www.amazon.com/cart/add-to-cart' }), undefined);
  const replies = await Promise.all([helper.send('internal', claim, amazon), helper.send('internal', claim, amazon)]);
  assert.deepEqual(replies.filter(Boolean), [{ items: job.items }]);
  assert.equal(await helper.send('internal', claim, amazon), null);
  await helper.send('external', job, bare);
  helper.close();
  assert.equal(await helper.send('internal', claim, amazon), null);
});

test('the worker rejects other pages, embedded frames, and invalid cart payloads', async () => {
  const helper = launchWorker();
  for (const sender of [
    { ...bare, url: 'https://another.example/amazon-debloated/' },
    { ...bare, url: 'https://undeadcommander.github.io/another-app/' },
    { ...bare, origin: 'https://another.example' },
    { ...bare, frameId: 1 },
  ]) assert.equal(await helper.send('external', job, sender), undefined);
  for (const items of [[], [{ id: 'sample-1', quantity: 1 }], [{ id: 'B012345678', quantity: 0 }], [job.items[0], job.items[0]]]) {
    assert.deepEqual(await helper.send('external', { ...job, items }, bare), { opened: false });
  }
  assert.deepEqual(helper.tabs, []);
});
