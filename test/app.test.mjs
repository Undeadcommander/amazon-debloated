import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as core from '../public/core.js';

async function boot(savedState) {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  if (savedState) w.localStorage.setItem(core.STORAGE_KEY, JSON.stringify(savedState));
  w.__core = core;
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import \{([^}]+)\} from '.\/core.js';/, 'const {$1} = window.__core;');
  w.eval(source);
  const q = selector => w.document.querySelector(selector);
  const click = selector => { const node = q(selector); assert.ok(node, `Missing ${selector}`); node.click(); };
  const fill = (selector, value) => { q(selector).value = value; q(selector).dispatchEvent(new w.Event('input', { bubbles: true })); };
  const submit = selector => q(selector).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const navigate = async hash => { w.location.hash = hash; await new Promise(resolve => w.setTimeout(resolve, 15)); };
  const stored = () => JSON.parse(w.localStorage.getItem(core.STORAGE_KEY));
  return { dom, w, q, click, fill, submit, navigate, stored };
}

test('keyless journey: import, details, list, cart, quantities, persistence', async t => {
  const app = await boot(); t.after(() => app.dom.window.close());
  const { q, click, fill, submit, navigate, stored } = app;
  assert.equal(app.w.document.querySelectorAll('.product').length, 8);
  click('[data-action="import"]');
  fill('[name="link"]', 'https://www.amazon.com/dp/B012345678?tag=tracking');
  fill('[name="title"]', 'My desk lamp');
  fill('[name="price"]', '29.99');
  fill('[name="note"]', 'Warm white');
  submit('#import-form');
  await navigate('/product/B012345678');
  assert.equal(q('h1').textContent, 'My desk lamp');
  assert.equal(q('.detail-info a[target="_blank"]').href, 'https://www.amazon.com/dp/B012345678');
  click('[data-action="save"]');
  click('[data-action="new-list"]');
  fill('[name="name"]', 'Desk setup');
  submit('#list-form');
  const list = stored().lists.find(l => l.name === 'Desk setup');
  assert.deepEqual(list.items, ['B012345678']);
  click('[data-action="add-cart"]');
  assert.equal(q('#cart-count').textContent, '1');
  await navigate('/cart');
  click('[data-delta="1"]');
  assert.equal(stored().cart[0].quantity, 2);
  assert.match(q('.summary-total').textContent, /59.98/);
  assert.equal(q('[data-action="checkout"]').disabled, false);
  const transfer = new URL(core.checkoutUrl(stored().cart, stored().products));
  assert.equal(transfer.searchParams.get('ASIN.1'), 'B012345678');
  assert.equal(transfer.searchParams.get('Quantity.1'), '2');
  const reload = await boot(stored()); t.after(() => reload.dom.window.close());
  assert.equal(reload.q('#cart-count').textContent, '2');
  assert.equal(reload.w.document.querySelectorAll('.product').length, 9);
  await navigate(`/lists/${list.id}`);
  assert.equal(q('.product-title').textContent, 'My desk lamp');
  click('[data-action="remove-list-item"]');
  assert.equal(stored().lists.find(l => l.id === list.id).items.length, 0);
  assert.equal(stored().cart.length, 1);
});

test('sample cart is blocked; live search, empty states, and sorting work', async t => {
  const app = await boot(); t.after(() => app.dom.window.close());
  const { q, click, fill, navigate } = app;
  fill('#search', 'headphones');
  assert.equal(app.w.document.querySelectorAll('.product').length, 1);
  assert.equal(new URL(q('#amazon-search').href).searchParams.get('k'), 'headphones');
  click('[data-action="add-cart"]');
  await navigate('/cart');
  assert.equal(q('[data-action="checkout"]').disabled, true);
  assert.match(q('.warning').textContent, /Sample products/);
  click('[data-action="remove-samples"]');
  assert.equal(q('#cart-count').textContent, '0');
  assert.match(q('.empty').textContent, /Nothing extra/);
  await navigate('/');
  click('[data-category="Imported"]');
  assert.ok(q('.empty'));
  click('[data-category="All"]');
  fill('#search', 'does not exist');
  assert.ok(q('.empty'));
  fill('#search', '');
  q('#sort').value = 'price-low'; q('#sort').dispatchEvent(new app.w.Event('change', { bubbles: true }));
  assert.match(q('.product-title').textContent, /Pocket notebook/);
});

test('unsafe links are rejected and product/list content is rendered as text', async t => {
  const app = await boot(); t.after(() => app.dom.window.close());
  const { q, click, fill, submit, navigate, stored } = app;
  click('[data-action="import"]');
  fill('[name="link"]', 'https://amazon.com.evil.test/dp/B012345678');
  submit('#import-form');
  assert.match(q('#form-error').textContent, /Use an https/);
  fill('[name="link"]', 'B012345678');
  fill('[name="title"]', '<img src=x onerror=alert(1)>');
  submit('#import-form');
  await navigate('/product/B012345678');
  assert.equal(q('h1').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(q('main img'), null);
  click('[data-action="edit-product"]');
  fill('[name="title"]', 'Updated');
  submit('#import-form');
  assert.equal(q('h1').textContent, 'Updated');
  assert.equal(stored().products.length, 1);
  click('[data-action="delete-product"]');
  click('[data-action="confirm-delete-product"]');
  await navigate('/');
  assert.equal(stored().products.length, 0);
});

test('list rename, duplicate name validation, delete, and cross-tab clearing', async t => {
  const app = await boot(); t.after(() => app.dom.window.close());
  const { w, q, click, fill, submit, navigate, stored } = app;
  await navigate('/lists');
  click('[data-action="new-list"]'); fill('[name="name"]', 'Saved for later'); submit('#list-form');
  assert.match(q('#form-error').textContent, /already/);
  fill('[name="name"]', 'Weekend'); submit('#list-form');
  const list = stored().lists.find(l => l.name === 'Weekend');
  await navigate(`/lists/${list.id}`);
  click('[data-action="rename-list"]'); fill('[name="name"]', 'Next weekend'); submit('#list-form');
  assert.equal(q('h1').textContent, 'Next weekend');
  click('[data-action="delete-list"]'); click('[data-action="confirm-delete-list"]'); await navigate('/lists');
  assert.equal(stored().lists.length, 1);
  w.dispatchEvent(new w.StorageEvent('storage', { key: null, newValue: null }));
  assert.equal(w.document.querySelectorAll('.list-card').length, 1);
});

test('delete all requires confirmation, clears every item, and stays empty after reload', async t => {
  const original = {
    products: [{ id: 'B012345678', title: 'My desk lamp', price: 29.99 }],
    lists: [{ id: 'desk', name: 'Desk setup', items: ['B012345678', 'sample-1'] }],
    cart: [{ id: 'B012345678', quantity: 2 }, { id: 'sample-2', quantity: 1 }],
  };
  const app = await boot(original); t.after(() => app.dom.window.close());
  const { w, q, click, fill, submit, navigate, stored } = app;
  w.localStorage.setItem('bare-theme-v1', 'ocean');
  // The action clears the whole catalog even when the user has filtered it.
  fill('#search', 'desk lamp');
  click('[data-action="delete-all"]');
  assert.match(q('#dialog').textContent, /all 9 products/);
  assert.equal(w.document.activeElement, q('.form-actions [data-action="close-dialog"]'));
  click('.form-actions [data-action="close-dialog"]');
  assert.deepEqual(stored(), original);
  assert.equal(q('#cart-count').textContent, '3');
  click('[data-action="delete-all"]');
  click('[data-action="confirm-delete-all"]');
  assert.deepEqual(stored().products, []);
  assert.deepEqual(stored().cart, []);
  assert.deepEqual(stored().lists, [{ id: 'desk', name: 'Desk setup', items: [] }]);
  assert.equal(stored().samplesHidden, true);
  assert.equal(w.localStorage.getItem('bare-theme-v1'), 'ocean');
  assert.equal(q('#cart-count').textContent, '0');
  assert.equal(w.document.querySelectorAll('.product').length, 0);
  assert.equal(q('#search').value, '');
  assert.equal(q('[data-action="delete-all"]').disabled, true);
  assert.doesNotMatch(q('#result-count').textContent, /samples/);
  const reload = await boot(stored()); t.after(() => reload.dom.window.close());
  assert.equal(reload.w.document.querySelectorAll('.product').length, 0);
  await reload.navigate('/product/sample-1');
  assert.equal(reload.q('.detail'), null);
  await navigate('/cart');
  assert.ok(q('.empty'));
  await navigate('/lists/desk');
  assert.equal(q('h1').textContent, 'Desk setup');
  assert.ok(q('.empty'));
  // New imports work without bringing back samples.
  await navigate('/');
  click('[data-action="import"]');
  fill('[name="link"]', 'B087654321'); fill('[name="title"]', 'New product');
  submit('#import-form');
  await navigate('/');
  assert.equal(w.document.querySelectorAll('.product').length, 1);
  assert.equal(stored().samplesHidden, true);
});

test('delete all leaves items intact when saving the deletion fails', async t => {
  const app = await boot({ products: [{ id: 'B012345678', title: 'Lamp' }], cart: [{ id: 'B012345678', quantity: 1 }] });
  t.after(() => app.dom.window.close());
  const before = app.stored();
  app.click('[data-action="delete-all"]');
  const prototype = Object.getPrototypeOf(app.w.localStorage);
  const originalSetItem = prototype.setItem;
  prototype.setItem = () => { throw new Error('Quota exceeded'); };
  try { app.click('[data-action="confirm-delete-all"]'); }
  finally { prototype.setItem = originalSetItem; }
  assert.deepEqual(app.stored(), before);
  assert.equal(app.q('#dialog').open, true);
  assert.match(app.q('#delete-all-error').textContent, /Could not save/);
  assert.equal(app.q('#cart-count').textContent, '1');
  assert.equal(app.w.document.querySelectorAll('.product').length, 9);
});

test('a deletion from another tab empties visible products and closes stale dialogs', async t => {
  const app = await boot(); t.after(() => app.dom.window.close());
  app.click('[data-action="save"]');
  app.w.dispatchEvent(new app.w.StorageEvent('storage', {
    key: core.STORAGE_KEY,
    newValue: JSON.stringify({ ...core.emptyState(), samplesHidden: true }),
  }));
  assert.equal(app.q('#dialog').open, false);
  assert.equal(app.w.document.querySelectorAll('.product').length, 0);
  assert.equal(app.q('#cart-count').textContent, '0');
});
