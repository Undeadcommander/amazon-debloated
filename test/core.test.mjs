import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAsin, amazonProductUrl, amazonSearchUrl, checkoutUrl, normalizeState, filterProducts, cartSummary, samples } from '../public/core.js';

const product = { id: 'B012345678', title: 'Desk lamp', price: 12.34, category: 'Imported', brand: 'Your product' };
test('extracts ASINs from supported Amazon US links and raw IDs', () => {
  for (const value of ['b012345678', 'https://www.amazon.com/title/dp/B012345678/ref=abc?tag=test', 'https://amazon.com/gp/product/B012345678', 'https://m.amazon.com/gp/aw/d/B012345678']) assert.equal(parseAsin(value), product.id);
  assert.equal(amazonProductUrl(product.id), 'https://www.amazon.com/dp/B012345678');
});
test('rejects deceptive hosts, unsupported regions, short links, and malformed IDs', () => {
  for (const value of ['https://amazon.com.evil.test/dp/B012345678', 'https://www.amazon.com@evil.test/dp/B012345678', 'https://evil.test@www.amazon.com/dp/B012345678', 'javascript:alert(1)', 'http://www.amazon.com/dp/B012345678', 'https://amazon.co.uk/dp/B012345678', 'https://a.co/d/abc', 'https://amazon.com/dp/B0123456789', 'https://amazon.com/s?k=chair', 'https://amazon.com:8080/dp/B012345678', 'invalid']) assert.throws(() => parseAsin(value), undefined, value);
});
test('builds an encoded Amazon discovery link', () => {
  assert.equal(new URL(amazonSearchUrl('lamp & desk')).searchParams.get('k'), 'lamp & desk');
});
test('checkout preserves every ASIN and quantity without affiliate tracking', () => {
  const other = { ...product, id: 'B087654321' };
  const url = new URL(checkoutUrl([{ id: product.id, quantity: 2 }, { id: other.id, quantity: 3 }], [product, other]));
  assert.equal(url.origin, 'https://www.amazon.com');
  assert.equal(url.pathname, '/gp/aws/cart/add.html');
  assert.deepEqual(Object.fromEntries(url.searchParams), { 'ASIN.1': product.id, 'Quantity.1': '2', 'ASIN.2': other.id, 'Quantity.2': '3' });
});
test('checkout rejects samples, missing products, and invalid quantities', () => {
  assert.throws(() => checkoutUrl([], []));
  assert.throws(() => checkoutUrl([{ id: samples[0].id, quantity: 1 }], samples));
  assert.throws(() => checkoutUrl([{ id: product.id, quantity: 1 }], []));
  for (const quantity of [0, -1, 100, 1.5, NaN, '1']) assert.throws(() => checkoutUrl([{ id: product.id, quantity }], [product]));
});
test('stored state is normalized and drops unsafe or dangling fields', () => {
  const state = normalizeState({ products: [null, { ...product, sample: true, kind: '"><script>', price: -2 }, product, { id: 'bad' }], lists: [{ id: 'one', name: 'Desk', items: [product.id, product.id, 'missing', 'sample-1', {}] }, { id: 'bad"id', name: 'bad' }], cart: [{ id: product.id, quantity: 999 }, { id: product.id, quantity: 1 }, { id: 'sample-1', quantity: -1 }, { id: 'missing', quantity: 1 }] });
  assert.equal(state.products.length, 1);
  assert.equal(state.products[0].kind, 'package');
  assert.equal(state.products[0].sample, undefined);
  assert.equal(state.products[0].price, null);
  assert.deepEqual(state.lists[0].items, [product.id, 'sample-1']);
  assert.equal(state.lists.length, 1);
  assert.deepEqual(state.cart, [{ id: product.id, quantity: 99 }, { id: 'sample-1', quantity: 1 }]);
});
test('corrupt storage values safely produce usable defaults', () => {
  for (const input of [null, undefined, false, 42, {}, { products: {}, lists: [null], cart: 'bad' }]) {
    const state = normalizeState(input);
    assert.deepEqual(state.products, []);
    assert.deepEqual(state.cart, []);
    assert.equal(state.lists[0].name, 'Saved for later');
  }
});
test('local search matches all query terms, categories, and ASINs', () => {
  const products = [product, ...samples];
  assert.deepEqual(filterProducts(products, { query: 'desk LAMP' }), [product]);
  assert.deepEqual(filterProducts(products, { query: 'B012345678' }), [product]);
  assert.deepEqual(filterProducts(products, { query: 'lamp', category: 'Office' }), []);
  assert.equal(filterProducts(products, { category: 'Imported' }).length, 1);
});
test('unknown prices sort last in both directions without mutating products', () => {
  const products = [{ ...product, price: null }, { ...product, price: 20 }, { ...product, price: 5 }];
  assert.deepEqual(filterProducts(products, { sort: 'price-low' }).map(p => p.price), [5, 20, null]);
  assert.deepEqual(filterProducts(products, { sort: 'price-high' }).map(p => p.price), [20, 5, null]);
  assert.equal(products[0].price, null);
});
test('cart totals use integer cents and flag unpriced items', () => {
  assert.deepEqual(cartSummary([{ id: product.id, quantity: 3 }, { id: 'B000000000', quantity: 2 }], [product, { id: 'B000000000', price: null }]), { count: 5, total: 3702, unknown: 2 });
});
