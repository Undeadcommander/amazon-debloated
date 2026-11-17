import { STORAGE_KEY, MAX_ITEMS, MAX_QUANTITY, emptyState, normalizeState, samples, parseAsin, amazonProductUrl, amazonSearchUrl, checkoutUrl, cartSummary, filterProducts } from './core.js';

const $ = selector => document.querySelector(selector);
const main = $('#main');
const dialog = $('#dialog');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="./icons.svg#${name}"/></svg>`;
const art = p => `<svg aria-hidden="true" viewBox="0 0 300 230"><use href="./products.svg#${p.kind}"/></svg>`;
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
let storageProblem = false;
let state;
try { state = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
catch { state = emptyState(); storageProblem = true; }
let filters = { query: '', category: 'All', sort: 'default' };
let toastTimer;
const allProducts = () => [...state.products, ...samples];
const productById = id => allProducts().find(p => p.id === id);
const saved = id => state.lists.some(l => l.items.includes(id));
const route = () => {
  const [path, query = ''] = (location.hash.slice(1) || '/').split('?');
  return { path, query: new URLSearchParams(query).get('q') || '' };
};
const currentList = () => state.lists.find(l => route().path === `/lists/${l.id}`);

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3600);
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageProblem = false; }
  catch { storageProblem = true; toast('Device storage is unavailable. Changes will last only for this session.'); }
  updateNav();
}

function updateNav() {
  $('#cart-count').textContent = String(state.cart.reduce((n, p) => n + p.quantity, 0));
  const path = route().path;
  document.querySelectorAll('[data-nav]').forEach(a => {
    const active = a.dataset.nav === (path.startsWith('/lists') ? 'lists' : path === '/cart' ? 'cart' : 'shop');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

const priceHtml = p => p.price == null ? '<span class="price">Price on Amazon<span class="price-note">Not fetched automatically</span></span>' : `<span class="price">${money(p.price)}<span class="price-note">${p.sample ? 'Example price' : 'Your reference price'}</span></span>`;

function card(p, listId) {
  return `<article class="product">
    <a class="product-art" href="#/product/${p.id}" aria-label="View ${esc(p.title)}">${art(p)}</a>
    ${p.sample ? '<span class="sample-label">Sample</span>' : ''}
    <button class="icon-button save ${saved(p.id) ? 'saved' : ''}" data-action="save" data-id="${p.id}" aria-label="Save ${esc(p.title)} to a list">${icon('bookmark')}</button>
    <p class="product-brand">${esc(p.brand)}</p>
    <a class="product-title" href="#/product/${p.id}">${esc(p.title)}</a>
    <div class="product-bottom">${priceHtml(p)}<button class="add-cart" data-action="add-cart" data-id="${p.id}" aria-label="Add ${esc(p.title)} to cart">${icon('plus')} Add to cart</button></div>
    ${listId ? `<button class="text-button remove-from-list" data-action="remove-list-item" data-list="${listId}" data-id="${p.id}">Remove from list</button>` : ''}
  </article>`;
}

function empty(title, text, actions = '', symbol = 'search') {
  return `<div class="empty">${icon(symbol)}<h2>${esc(title)}</h2><p>${esc(text)}</p>${actions}</div>`;
}

function renderShop() {
  filters.query = route().query;
  main.innerHTML = `<section class="hero">
    <div class="eyebrow">A little less Amazon. A lot less noise.</div>
    <h1>Find your thing.<br class="sr-only"> Skip the everything.</h1>
    <p>Your products, your lists, your pace. Nothing in the way.</p>
    <form class="search-form" id="search-form" role="search">${icon('search')}<label for="search" class="sr-only">Search your products and samples</label><input id="search" type="search" name="q" placeholder="Search your products…" value="${esc(filters.query)}" autocomplete="off" maxlength="200"><kbd aria-hidden="true">/</kbd><button class="button" type="submit">Search ${icon('arrow')}</button></form>
    <div class="search-hint"><span>Looking for something new?</span><a id="amazon-search" href="${esc(amazonSearchUrl(filters.query))}" target="_blank" rel="noopener noreferrer">Search Amazon ↗</a><span>then paste the product link here.</span></div>
  </section>
  <div class="notice">${icon('leaf')}<span><strong>Your quiet corner of Amazon.</strong> No account or API key. Browse samples, or add your own product links.</span><button class="text-button" data-action="import">Add a product ↗</button></div>
  <section aria-labelledby="catalog-title"><div class="catalog-head"><div class="catalog-heading"><h2 id="catalog-title">The essentials</h2><span id="result-count" role="status" aria-live="polite"></span></div><div class="catalog-tools"><label class="sr-only" for="sort">Sort products</label><select id="sort"><option value="default">Recently added</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name: A to Z</option></select><button class="button secondary" data-action="import">${icon('plus')} Add product</button></div></div>
  <div class="chips" aria-label="Product categories">${['All', 'Imported', 'Electronics', 'Home & kitchen', 'Everyday carry', 'Office'].map(c => `<button class="chip" data-action="category" data-category="${esc(c)}" aria-pressed="${filters.category === c}">${c === 'Imported' ? 'My products' : c === 'All' ? 'All products' : c}</button>`).join('')}</div>
  <div id="products" class="grid"></div></section>
  <p class="end-note">${icon('check')} No ads. No rabbit holes. Just what you came for.</p>`;
  $('#sort').value = filters.sort;
  renderResults();
}

function renderResults() {
  const products = filterProducts(allProducts(), filters);
  $('#result-count').textContent = `${products.length} ${products.length === 1 ? 'product' : 'products'}${filters.category === 'All' ? ' · includes samples' : ''}`;
  $('#catalog-title').textContent = filters.query ? `Results for “${filters.query}”` : filters.category === 'Imported' ? 'Your products' : 'The essentials';
  $('#products').innerHTML = products.length ? products.map(p => card(p)).join('') : empty('A little too quiet here.', 'Search your saved products, or find something on Amazon and paste its product link here.', `<button class="button" data-action="import">${icon('plus')} Add a product</button><a class="button secondary" href="${esc(amazonSearchUrl(filters.query))}" target="_blank" rel="noopener noreferrer">Search Amazon ${icon('external')}</a>`);
  $('#amazon-search').href = amazonSearchUrl(filters.query);
  document.querySelectorAll('[data-action="category"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.category === filters.category)));
}

function renderLists() {
  main.innerHTML = `<div class="page-head"><div><div class="eyebrow muted">A place for later</div><h1>Your lists.</h1><p>A few good things, neatly kept. Saved on this device.</p></div><button class="button" data-action="new-list">${icon('plus')} New list</button></div>
    <div class="list-grid">${state.lists.map(l => `<a href="#/lists/${l.id}" class="list-card"><h3>${esc(l.name)}</h3><div class="list-preview">${l.items.length ? l.items.slice(0, 3).map(id => productById(id)).filter(Boolean).map(art).join('') : `${icon('bookmark')}<span> &nbsp; Room for your next find</span>`}</div><p>${l.items.length} ${l.items.length === 1 ? 'product' : 'products'} <span aria-hidden="true">↗</span></p></a>`).join('')}</div>`;
}

function renderList(list) {
  main.innerHTML = `<a class="back" href="#/lists">← All lists</a><div class="page-head"><div><h1>${esc(list.name)}</h1><p>${list.items.length} products · Saved on this device</p></div><div class="catalog-tools"><button class="button secondary" data-action="rename-list" data-id="${list.id}">Rename</button><button class="text-button muted" data-action="delete-list" data-id="${list.id}">Delete list</button></div></div>
    <div class="grid">${list.items.length ? list.items.map(productById).filter(Boolean).map(p => card(p, list.id)).join('') : empty('Good things go here.', 'Use the bookmark on any product to save it to this list.', '<a class="button" href="#/">Browse products</a>', 'bookmark')}</div>`;
}

function renderDetail(p) {
  main.innerHTML = `<a class="back" href="#/">← Browse products</a><section class="detail"><div class="product-art">${art(p)}</div><div class="detail-info"><span class="eyebrow muted">${esc(p.category)}${p.sample ? ' · Sample product' : ''}</span><h1>${esc(p.title)}</h1><p>${esc(p.note || 'Saved from Amazon. Open the original listing for current photos, specifications, reviews, and availability.')}</p><div class="price">${p.price == null ? 'Price on Amazon' : money(p.price)}<span class="price-note">${p.sample ? 'Illustrative price. This is a sample, not a live listing.' : 'Manually saved information. Confirm the current price on Amazon.'}</span></div><div class="detail-actions"><button class="button" data-action="add-cart" data-id="${p.id}">${icon('plus')} Add to cart</button><button class="button secondary" data-action="save" data-id="${p.id}">${icon('bookmark')} Save to list</button></div><a class="button secondary" href="${esc(p.sample ? amazonSearchUrl(p.title) : amazonProductUrl(p.id))}" target="_blank" rel="noopener noreferrer">${p.sample ? 'Find similar on Amazon' : 'View on Amazon'} ${icon('external')}</a>
    <div class="detail-meta"><span>${p.sample ? 'Sample illustration · Not a purchasable listing' : `ASIN: ${p.id} · Amazon US`}</span>${!p.sample ? `<button class="text-button" data-action="edit-product" data-id="${p.id}">Edit details</button><button class="text-button" data-action="delete-product" data-id="${p.id}">Remove product</button>` : ''}</div></div></section>`;
}

function renderCart() {
  const summary = cartSummary(state.cart, allProducts());
  const hasSamples = state.cart.some(c => productById(c.id)?.sample);
  main.innerHTML = `<div class="page-head"><div><div class="eyebrow muted">Only what you need</div><h1>Your cart.</h1><p>${summary.count} ${summary.count === 1 ? 'item' : 'items'}. One easy handoff to Amazon.</p></div><a class="button secondary" href="#/">Keep browsing</a></div>`;
  if (!state.cart.length) {
    main.innerHTML += empty('Nothing extra. Nothing yet.', 'Add a product to start your cart. When you’re ready, continue to Amazon to review and pay.', '<a class="button" href="#/">Browse products</a><button class="button secondary" data-action="import">Add a product link</button>', 'bag');
    return;
  }
  main.innerHTML += `<div class="cart-layout"><section aria-label="Cart items">${state.cart.map(c => {
    const p = productById(c.id);
    return `<article class="cart-item"><a href="#/product/${p.id}" class="product-art" aria-label="View ${esc(p.title)}">${art(p)}</a><div><p class="product-brand">${p.sample ? 'Sample product' : `ASIN ${p.id}`}</p><a href="#/product/${p.id}"><h3>${esc(p.title)}</h3></a><div class="item-actions"><div class="quantity" role="group" aria-label="Quantity for ${esc(p.title)}"><button data-action="quantity" data-id="${p.id}" data-delta="-1" aria-label="Decrease quantity of ${esc(p.title)}" ${c.quantity <= 1 ? 'disabled' : ''}>−</button><span aria-live="polite">${c.quantity}</span><button data-action="quantity" data-id="${p.id}" data-delta="1" aria-label="Increase quantity of ${esc(p.title)}" ${c.quantity >= MAX_QUANTITY ? 'disabled' : ''}>+</button></div><button class="text-button" data-action="remove-cart" data-id="${p.id}">Remove</button><button class="text-button" data-action="save" data-id="${p.id}">Save to list</button></div></div>${priceHtml(p)}</article>`;
  }).join('')}</section><aside class="summary" aria-label="Cart summary"><h2>A quick look</h2><div class="summary-row"><span>Items</span><span>${summary.count}</span></div><div class="summary-row summary-total"><span>${summary.unknown ? 'Known subtotal' : 'Reference subtotal'}</span><span>${money(summary.total / 100)}</span></div>${summary.unknown ? `<p>${summary.unknown} ${summary.unknown === 1 ? 'item has' : 'items have'} no saved price and ${summary.unknown === 1 ? 'is' : 'are'} excluded from this subtotal.</p>` : ''}<p>Saved prices are estimates. Amazon confirms prices, availability, shipping, and taxes.</p>${hasSamples ? '<p class="warning">Sample products cannot be sent to Amazon. Remove them and add real product links to check out.</p><button class="text-button" data-action="remove-samples">Remove sample items</button>' : ''}<button class="button accent" data-action="checkout" ${hasSamples ? 'disabled' : ''}>Continue to Amazon ${icon('external')}</button><p>You’ll review the items on Amazon before paying. Your local cart stays here until you remove items.</p></aside></div>`;
}

function render({ focus = false } = {}) {
  const { path } = route();
  const list = currentList();
  const product = path.startsWith('/product/') ? productById(path.slice(9)) : null;
  if (path === '/') renderShop();
  else if (path === '/lists') renderLists();
  else if (list) renderList(list);
  else if (path === '/cart') renderCart();
  else if (product) renderDetail(product);
  else main.innerHTML = `<div class="page-head"><h1>Nothing here.</h1></div>${empty('This page has moved on.', 'The product or list may have been removed from this device.', '<a class="button" href="#/">Back to browsing</a>')}`;
  document.title = `${product?.title || list?.name || (path === '/cart' ? 'Your cart' : path === '/lists' ? 'Your lists' : 'Amazon, simplified')} — Bare`;
  updateNav();
  if (focus) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}

function openDialog(title, body) {
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div>${body}`;
  if (!dialog.open) dialog.showModal();
  const field = dialog.querySelector('input:not([readonly])');
  if (field) field.focus();
}

function importDialog(product) {
  openDialog(product ? 'Edit your product' : 'A good find? Keep it.', `<p>Paste an Amazon US product link or ASIN. Add a name to make it easy to find later. Details stay on this device.</p><form id="import-form" data-edit="${product?.id || ''}"><label>Amazon link or ASIN<input name="link" required maxlength="2000" placeholder="https://www.amazon.com/dp/…" value="${product?.id || ''}" ${product ? 'readonly' : ''}><small>Short links like a.co need to be opened first.</small></label><label>Product name <span class="muted">(optional)</span><input name="title" maxlength="180" placeholder="e.g. The headphones I’ve been looking for" value="${esc(product?.title || '')}"></label><label>Reference price in USD <span class="muted">(optional)</span><input name="price" type="number" inputmode="decimal" min="0" max="1000000" step="0.01" placeholder="0.00" value="${product?.price ?? ''}"></label><label>A note for later <span class="muted">(optional)</span><textarea name="note" maxlength="500" placeholder="Color, size, or why you liked it…">${esc(product?.note || '')}</textarea></label><p class="form-error" role="alert" id="form-error"></p><div class="form-actions"><button class="button secondary" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit">${product ? 'Save changes' : 'Add product'} ${icon('arrow')}</button></div></form>`);
}

function listDialog(list, productId = '') {
  openDialog(list ? 'Rename your list' : 'Make a little space.', `<form id="list-form" data-id="${list?.id || ''}" data-product="${productId}"><label>List name<input name="name" required maxlength="60" placeholder="e.g. A better desk" value="${esc(list?.name || '')}"></label><p class="form-error" role="alert" id="form-error"></p><div class="form-actions"><button class="button secondary" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit">${list ? 'Save name' : 'Create list'}</button></div></form>`);
}

function saveDialog(id) {
  const p = productById(id);
  openDialog('Save to a list', `<p>${esc(p.title)}</p>${state.lists.map(l => `<button class="list-choice" data-action="toggle-list" data-id="${id}" data-list="${l.id}" aria-pressed="${l.items.includes(id)}"><span>${esc(l.name)}</span>${icon(l.items.includes(id) ? 'check' : 'plus')}</button>`).join('')}<div class="form-actions"><button class="button secondary" data-action="new-list" data-product="${id}">${icon('plus')} New list</button><button class="button" data-action="close-dialog">Done</button></div>`);
}

function confirmDialog(title, message, action, id) {
  openDialog(title, `<p>${esc(message)}</p><div class="form-actions"><button class="button secondary" data-action="close-dialog">Cancel</button><button class="button accent" data-action="${action}" data-id="${id}">Remove</button></div>`);
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, id, list: listId } = button.dataset;
  if (action === 'close-dialog') dialog.close();
  if (action === 'import') importDialog();
  if (action === 'edit-product') importDialog(productById(id));
  if (action === 'category') { filters.category = button.dataset.category; renderResults(); }
  if (action === 'add-cart') {
    const entry = state.cart.find(c => c.id === id);
    if (!entry && state.cart.length >= MAX_ITEMS) return toast(`Your cart can hold up to ${MAX_ITEMS} different products.`);
    if (entry?.quantity >= MAX_QUANTITY) return toast(`Maximum quantity is ${MAX_QUANTITY}.`);
    if (entry) entry.quantity++; else state.cart.push({ id, quantity: 1 });
    persist();
    if (!storageProblem) toast('Added to your cart.');
  }
  if (action === 'save') saveDialog(id);
  if (action === 'new-list') listDialog(null, button.dataset.product || '');
  if (action === 'rename-list') listDialog(state.lists.find(l => l.id === id));
  if (action === 'toggle-list') {
    const list = state.lists.find(l => l.id === listId);
    if (list.items.includes(id)) list.items = list.items.filter(item => item !== id); else list.items.push(id);
    persist(); render(); saveDialog(id);
    dialog.querySelector(`[data-list="${listId}"]`)?.focus();
  }
  if (action === 'remove-list-item') {
    const list = state.lists.find(l => l.id === listId);
    list.items = list.items.filter(item => item !== id);
    persist(); render();
  }
  if (action === 'delete-list') confirmDialog('Remove this list?', 'The products will stay in your catalog and cart.', 'confirm-delete-list', id);
  if (action === 'confirm-delete-list') {
    state.lists = state.lists.filter(l => l.id !== id);
    if (!state.lists.length) state.lists = emptyState().lists;
    persist(); dialog.close(); location.hash = '/lists';
  }
  if (action === 'delete-product') confirmDialog('Remove this product?', 'It will also be removed from your lists and local cart.', 'confirm-delete-product', id);
  if (action === 'confirm-delete-product') {
    state.products = state.products.filter(p => p.id !== id);
    state.cart = state.cart.filter(c => c.id !== id);
    state.lists.forEach(l => l.items = l.items.filter(item => item !== id));
    persist(); dialog.close(); location.hash = '/';
  }
  if (action === 'quantity') {
    const entry = state.cart.find(c => c.id === id);
    entry.quantity = Math.max(1, Math.min(MAX_QUANTITY, entry.quantity + Number(button.dataset.delta)));
    persist(); renderCart();
    main.querySelector(`[data-id="${id}"][data-delta="${button.dataset.delta}"]`)?.focus();
  }
  if (action === 'remove-cart' || action === 'remove-samples') {
    state.cart = state.cart.filter(c => action === 'remove-samples' ? !productById(c.id)?.sample : c.id !== id);
    persist(); renderCart();
  }
  if (action === 'checkout') {
    try { window.location.assign(checkoutUrl(state.cart, allProducts())); }
    catch (error) { toast(error.message); }
  }
  if (action === 'about') openDialog('Shopping, with some space.', `<p>Bare is a small, independent workspace for Amazon US. No login, no ads, no tracking.</p><div class="about-step"><h3>01 / Find something worth keeping</h3><p>Search your local catalog instantly. For new finds, search Amazon and bring back the full product link. No live Amazon catalog is connected.</p></div><div class="about-step"><h3>02 / Make it yours</h3><p>Add a name, a reference price, and a note. Organize products into lists. Everything stays in this browser; clearing site data removes your saved items.</p></div><div class="about-step"><h3>03 / Finish on Amazon</h3><p>Build your cart here, then continue to Amazon. Amazon controls the transfer and may ask you to confirm items or sign in. Check the exact variant, price, and availability there. If the transfer fails, each product has a direct Amazon link.</p></div><div class="about-step"><h3>A note about samples</h3><p>Sample products, illustrations, and prices show how the app works. They are not actual listings and cannot be sent to Amazon.</p></div><div class="form-actions"><button class="button" data-action="close-dialog">Got it</button></div>`);
});

document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  filters.query = event.target.value;
  const hash = filters.query ? `#/?${new URLSearchParams({ q: filters.query })}` : '#/';
  history.replaceState(null, '', hash);
  renderResults();
});
document.addEventListener('change', event => {
  if (event.target.id === 'sort') { filters.sort = event.target.value; renderResults(); }
});

document.addEventListener('submit', event => {
  const form = event.target;
  if (!['search-form', 'import-form', 'list-form'].includes(form.id)) return;
  event.preventDefault();
  if (form.id === 'search-form') { renderResults(); return; }
  const data = new FormData(form);
  if (form.id === 'import-form') {
    try {
      const id = parseAsin(data.get('link'));
      const existing = state.products.find(p => p.id === id);
      if (!existing && state.products.length >= 1000) throw new Error('This device already has 1,000 products. Remove a product before adding another.');
      const priceText = String(data.get('price')).trim();
      const price = priceText ? Number(priceText) : null;
      if (price != null && (!Number.isFinite(price) || price < 0 || price > 1000000)) throw new Error('Enter a valid price between 0 and 1,000,000.');
      const editing = Boolean(form.dataset.edit);
      const product = { id, title: String(data.get('title')).trim() || (editing ? `Amazon product ${id}` : existing?.title || `Amazon product ${id}`), price: !editing && !priceText && existing ? existing.price : price == null ? null : Math.round(price * 100) / 100, note: String(data.get('note')).trim() || (!editing ? existing?.note || '' : ''), category: 'Imported', brand: 'Your product', kind: 'package' };
      if (existing) Object.assign(existing, product); else state.products.unshift(product);
      persist(); dialog.close();
      if (route().path === `/product/${id}`) render(); else location.hash = `/product/${id}`;
      if (!storageProblem) toast(existing ? 'Product updated.' : 'Your product is ready.');
    } catch (error) { $('#form-error').textContent = error.message; }
  }
  if (form.id === 'list-form') {
    const name = String(data.get('name')).trim();
    if (!name) { $('#form-error').textContent = 'Give your list a name.'; return; }
    if (!form.dataset.id && state.lists.length >= 100) { $('#form-error').textContent = 'You can keep up to 100 lists on this device.'; return; }
    if (state.lists.some(l => l.name.toLowerCase() === name.toLowerCase() && l.id !== form.dataset.id)) { $('#form-error').textContent = 'A list already has that name.'; return; }
    const list = form.dataset.id ? state.lists.find(l => l.id === form.dataset.id) : { id: crypto.randomUUID(), name, items: [] };
    list.name = name;
    if (form.dataset.product) list.items.push(form.dataset.product);
    if (!form.dataset.id) state.lists.push(list);
    persist(); dialog.close(); render();
    if (!storageProblem) toast(form.dataset.product ? `Saved to ${name}.` : 'List saved.');
  }
});

dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !dialog.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    if (route().path !== '/') { location.hash = '/'; setTimeout(() => $('#search')?.focus(), 0); }
    else $('#search')?.focus();
  }
});
window.addEventListener('hashchange', () => { if (dialog.open) dialog.close(); render({ focus: true }); });
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  try { state = normalizeState(JSON.parse(event.newValue)); render(); if (dialog.open) dialog.close(); toast('Updated from another tab.'); } catch { /* Keep current state if another tab writes malformed data. */ }
});
render();
if (storageProblem) toast('Saved data could not be read. Changes may only last for this session.');
