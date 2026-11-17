import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const script = await readFile(new URL('../extension/amazon.js', import.meta.url), 'utf8');
const origin = 'https://www.amazon.com';
const cart = `${origin}/gp/cart/view.html`;
const add = `${origin}/cart/add-to-cart/ref=dp_start-bbf_1_glance`;
const notebook = 'B00MNV8E0C';
const charger = 'B0787D6SGQ';
const unrelated = 'B012345678';

const job = (...items) => ({ items: items.map(([id, quantity]) => ({ id, quantity })) });
const row = ([id, quantity]) => `<div data-itemtype="active" data-asin="${id}" data-quantity="${quantity}"></div>`;
const cartPage = (...rows) => rows.length ?
  `<form id="activeCartViewForm"><div id="sc-active-cart">${rows.map(row).join('')}</div></form>` :
  '<div id="sc-empty-cart">Your Amazon Cart is empty</div>';
const listing = (id, { action = `${add}?tag=not-bare-20`, quantities = [1, 2, 3], actual = id, submitter = 'submit.add-to-cart' } = {}) => `
  <form method="post" action="/gp/product/handle-buy-box">
    <input type="hidden" name="anti-csrftoken-a2z" value="csrf1">
    <input type="hidden" name="anti-csrftoken-a2z" value="csrf2">
    <input type="hidden" name="items[0.base][asin]" value="${id}">
    <input type="hidden" name="ASIN" value="${actual}">
    <input type="hidden" name="offerListingID" value="amazon-native-offer">
    <input type="hidden" name="items[0.base][offerListingId]" value="amazon-native-offer">
    <input type="hidden" name="items[0.base][quantity]" value="1">
    <input type="hidden" name="tag" value="not-bare-20">
    <input type="hidden" name="linkCode" value="ll1">
    <input type="hidden" name="referrer" value="https://www.amazon.com/?tag=not-bare-20">
    <input type="hidden" name="isBuyNow" value="1">
    <select id="quantity" name="quantity">${quantities.map(value => `<option>${value}</option>`).join('')}</select>
    <input type="submit" name="submit.buy-now" value="Buy Now">
    <input type="submit" id="add-to-cart-button" name="${submitter}" value="Add to Cart" formaction="${action}">
  </form>`;

const page = (html, url) => ({ url, ok: true, text: async () => html });

async function boot(t, { value, url = cart, fetchMock, lock } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM('<main>Amazon cart</main>', { url, runScripts: 'outside-only', virtualConsole });
  t.after(() => dom.window.close());
  const { window } = dom;
  const calls = [];
  const messages = [];
  window.chrome = { runtime: { async sendMessage(message) { messages.push({ ...message }); return value; } } };
  if (lock) Object.defineProperty(window.navigator, 'locks', { value: { request: lock } });
  window.fetch = async (url, options) => {
    calls.push({ url, ...options });
    if (!fetchMock) throw new Error('Unmocked fetch');
    return fetchMock(url, options);
  };
  await window.eval(script);
  const panel = window.document.querySelector('#bare-cart-transfer');
  return { panel, status: panel?.querySelector('[role="status"]').textContent, calls, messages, errors };
}

test('claims once and takes no action when there is no job', async t => {
  const result = await boot(t, { url: `${origin}/cart` });
  assert.deepEqual(result.messages, [{ type: 'bare-cart:claim' }]);
  assert.deepEqual(result.calls, []);
  assert.equal(result.panel, null);
});

test('does not claim on a non-cart URL', async t => {
  const result = await boot(t, { url: `${origin}/gp/checkout`, value: job([notebook, 2]) });
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.calls, []);
  assert.equal(result.panel, null);
});

test('posts native quantities once, preserves existing cart quantities, and refreshes only after verification', async t => {
  let reads = 0;
  const locks = [];
  const result = await boot(t, {
    value: job([notebook, 2], [charger, 3]),
    lock: async (name, options, callback) => { locks.push([name, options.signal.aborted]); await callback(); },
    fetchMock(url, options) {
      if (url === cart) {
        return page(reads++ ? cartPage([notebook, 1], [notebook, 4], [unrelated, 7], [charger, 3]) :
          cartPage([notebook, 3], [unrelated, 7]), url);
      }
      if (options.method === 'POST') return { ok: true };
      if (url === `${origin}/dp/${notebook}`) return page(listing(notebook), url);
      if (url === `${origin}/dp/${charger}`) return page(listing(charger), url);
      throw new Error('Unexpected request');
    },
  });
  assert.deepEqual(result.messages, [{ type: 'bare-cart:claim' }]);
  assert.deepEqual(locks, [['bare-amazon-cart-transfer', false]]);
  assert.deepEqual(result.calls.map(call => call.url), [cart, `${origin}/dp/${notebook}`, add, `${origin}/dp/${charger}`, add, cart]);
  for (const call of result.calls) {
    assert.equal(call.mode, 'same-origin');
    assert.equal(call.credentials, 'same-origin');
    assert.equal(call.referrerPolicy, 'no-referrer');
    assert.equal(call.cache, 'no-store');
    assert.equal(call.signal.aborted, false);
    assert.equal(call.redirect, call.method === 'POST' ? 'manual' : 'error');
  }
  const posts = result.calls.filter(call => call.method === 'POST');
  for (const [index, id] of [notebook, charger].entries()) {
    const { body } = posts[index];
    assert.equal(body.get('ASIN'), id);
    assert.equal(body.get('items[0.base][asin]'), id);
    assert.equal(body.get('offerListingID'), 'amazon-native-offer');
    assert.deepEqual(body.getAll('anti-csrftoken-a2z'), ['csrf1', 'csrf2']);
    assert.equal(body.get('submit.add-to-cart'), 'Add to Cart');
    assert.deepEqual(body.getAll('quantity'), [String(index + 2)]);
    assert.deepEqual(body.getAll('items[0.base][quantity]'), [String(index + 2)]);
    assert.equal(body.has('isBuyNow'), false);
    assert.equal(body.has('submit.buy-now'), false);
    assert.doesNotMatch(body.toString(), /not-bare|linkCode|referrer/);
  }
  assert.match(result.status, /all requested quantities verified/i);
  assert.equal(result.panel.querySelector('li'), null);
  assert.ok(result.errors.some(error => /navigation/i.test(error.message)));
});

test('continues past a quantity cap and reports only the quantities not verified', async t => {
  let reads = 0;
  const result = await boot(t, {
    value: job([notebook, 3], [charger, 3]),
    fetchMock(url, options) {
      if (url === cart) return page(reads++ ? cartPage([charger, 5]) : cartPage([charger, 4]), url);
      if (options.method === 'POST') return { ok: true };
      if (url.endsWith(notebook)) return page(listing(notebook, { quantities: [1, 2] }), url);
      return page(listing(charger), url);
    },
  });
  const posts = result.calls.filter(call => call.method === 'POST');
  assert.deepEqual(posts.map(call => call.body.get('ASIN')), [charger]);
  assert.match(result.status, /couldn’t confirm every requested quantity/i);
  const items = [...result.panel.querySelectorAll('li')];
  assert.match(items[0].textContent, new RegExp(`3 × ${notebook}.*did not offer a quantity of 3`));
  assert.match(items[1].textContent, new RegExp(`2 × ${charger}.*did not show the full requested increase`));
  assert.deepEqual([...result.panel.querySelectorAll('a')].map(link => link.href),
    [`${origin}/dp/${notebook}`, `${origin}/dp/${charger}`, cart]);
  assert.deepEqual(result.errors, []);
});

test('rejects non-cart endpoints and mismatched or buy-now forms without posting', async t => {
  for (const [name, fields, reason = /unexpected/i] of [
    ['third-party action', { action: 'https://example.com/cart/add-to-cart' }],
    ['wrong Amazon endpoint', { action: '/gp/product/handle-buy-box' }],
    ['wrong ASIN', { actual: unrelated }],
    ['buy-now submitter', { submitter: 'submit.buy-now' }, /standard Add to Cart form/i],
  ]) {
    await t.test(name, async subtest => {
      const result = await boot(subtest, { value: job([notebook, 2]), fetchMock: url =>
        page(url === cart ? cartPage() : listing(notebook, fields), url) });
      assert.equal(result.calls.filter(call => call.method === 'POST').length, 0);
      assert.match(result.panel.querySelector('li').textContent, reason);
      assert.deepEqual(result.errors, []);
    });
  }
});

test('does not post when Amazon sign-in prevents reading the baseline', async t => {
  const result = await boot(t, { value: job([notebook, 2]), fetchMock: url =>
    page('<input id="ap_email">', url) });
  assert.deepEqual(result.calls.map(call => call.url), [cart]);
  assert.match(result.status, /nothing was submitted.*sign-in/i);
  assert.deepEqual(result.errors, []);
});

test('does not retry an ambiguous POST or declare success when sign-in prevents verification', async t => {
  let reads = 0;
  const result = await boot(t, {
    value: job([notebook, 2]),
    fetchMock(url, options) {
      if (url === cart) return reads++ ? page('<input id="ap_email">', `${origin}/ap/signin`) : page(cartPage(), url);
      if (options.method === 'POST') throw new Error('Timeout');
      return page(listing(notebook), url);
    },
  });
  assert.deepEqual(result.calls.map(call => call.url), [cart, `${origin}/dp/${notebook}`, add, cart]);
  assert.match(result.status, /couldn’t verify.*review your cart before adding manually/i);
  assert.match(result.panel.querySelector('li').textContent, /result of the add request is unknown/i);
  assert.deepEqual(result.errors, []);
});
