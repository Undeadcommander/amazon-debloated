export const STORAGE_KEY = 'bare-shopping-v1';
export const MAX_ITEMS = 50;
export const MAX_QUANTITY = 99;
export const emptyState = () => ({ products: [], lists: [{ id: 'saved', name: 'Saved for later', items: [] }], cart: [], samplesHidden: false });

export function parseAsin(input) {
  const value = String(input).trim();
  if (/^[A-Z0-9]{10}$/i.test(value)) return value.toUpperCase();
  let url;
  try { url = new URL(value); } catch { throw new Error('Paste a 10-character ASIN or a full Amazon.com product link.'); }
  if (url.protocol !== 'https:' || !['amazon.com', 'www.amazon.com', 'smile.amazon.com', 'm.amazon.com'].includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Use an https://www.amazon.com product link. Short links need to be opened on Amazon first.');
  }
  const match = url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i);
  if (!match) throw new Error('This link does not contain a product ASIN. Open the product on Amazon and copy its full link.');
  return match[1].toUpperCase();
}

export function amazonProductUrl(asin) { return `https://www.amazon.com/dp/${parseAsin(asin)}`; }
export function amazonSearchUrl(query) { return `https://www.amazon.com/s?${new URLSearchParams({ k: query.trim() || 'everyday essentials' })}`; }

export function checkoutUrl(cart, products) {
  if (!cart.length) throw new Error('Your cart is empty.');
  if (cart.length > MAX_ITEMS) throw new Error(`Transfer up to ${MAX_ITEMS} different products at a time.`);
  const url = new URL('https://www.amazon.com/gp/aws/cart/add.html');
  cart.forEach((item, index) => {
    const product = products.find(p => p.id === item.id);
    if (!product || product.sample) throw new Error('Remove sample products before continuing to Amazon.');
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) throw new Error('Invalid product quantity.');
    url.searchParams.set(`ASIN.${index + 1}`, parseAsin(product.id));
    url.searchParams.set(`Quantity.${index + 1}`, String(item.quantity));
  });
  return url.href;
}

export function normalizeState(input) {
  if (!input || typeof input !== 'object') return emptyState();
  const products = [];
  for (const p of (Array.isArray(input.products) ? input.products.slice(0, 1000) : [])) {
    if (!p || typeof p.id !== 'string' || !/^[A-Z0-9]{10}$/.test(p.id) || products.some(x => x.id === p.id)) continue;
    products.push({ id: p.id, title: String(p.title || `Amazon product ${p.id}`).slice(0, 180), brand: 'Your product', category: 'Imported', kind: 'package', price: typeof p.price === 'number' && Number.isFinite(p.price) && p.price >= 0 && p.price <= 1000000 ? p.price : null, note: String(p.note || '').slice(0, 500) });
  }
  const samplesHidden = input.samplesHidden === true;
  const validId = id => typeof id === 'string' && (products.some(p => p.id === id) || (!samplesHidden && /^sample-[1-8]$/.test(id)));
  const lists = [];
  for (const l of (Array.isArray(input.lists) ? input.lists.slice(0, 100) : [])) {
    if (!l || typeof l.id !== 'string' || !/^[\w-]{1,60}$/.test(l.id) || lists.some(x => x.id === l.id)) continue;
    lists.push({ id: l.id, name: String(l.name || 'Untitled list').slice(0, 60), items: [...new Set((Array.isArray(l.items) ? l.items : []).filter(validId))].slice(0, 1000) });
  }
  const cart = [];
  for (const c of (Array.isArray(input.cart) ? input.cart : [])) {
    if (!c || !validId(c.id) || cart.some(x => x.id === c.id) || cart.length >= MAX_ITEMS) continue;
    cart.push({ id: c.id, quantity: Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(Number(c.quantity)) || 1)) });
  }
  return { products, lists: lists.length ? lists : emptyState().lists, cart, samplesHidden };
}

export function filterProducts(products, { query = '', category = 'All', sort = 'default' } = {}) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const result = products.filter(p => (category === 'All' || p.category === category) && terms.every(term => `${p.title} ${p.brand} ${p.category} ${p.id} ${p.note || ''}`.toLowerCase().includes(term)));
  if (sort === 'price-low') result.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  if (sort === 'price-high') result.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
  if (sort === 'name') result.sort((a, b) => a.title.localeCompare(b.title));
  return result;
}

export function cartSummary(cart, products) {
  return cart.reduce((sum, item) => {
    const p = products.find(p => p.id === item.id);
    sum.count += item.quantity;
    if (p?.price != null) sum.total += Math.round(p.price * 100) * item.quantity;
    else sum.unknown += item.quantity;
    return sum;
  }, { count: 0, total: 0, unknown: 0 });
}

export const samples = [
  { id: 'sample-1', title: 'Wireless over-ear headphones', brand: 'Sound, simplified', category: 'Electronics', kind: 'headphones', price: 79.99, note: 'A little less noise. A little more focus.' },
  { id: 'sample-2', title: 'Everyday insulated bottle', brand: 'Take it with you', category: 'Home & kitchen', kind: 'bottle', price: 24.00, note: 'A reusable companion for your everyday routine.' },
  { id: 'sample-3', title: 'Compact mechanical keyboard', brand: 'A better workspace', category: 'Electronics', kind: 'keyboard', price: 89.00, note: 'Everything you need, with a little more desk space.' },
  { id: 'sample-4', title: 'Minimal canvas daypack', brand: 'Pack light', category: 'Everyday carry', kind: 'bag', price: 45.00, note: 'Room for the essentials, wherever the day goes.' },
  { id: 'sample-5', title: 'Stoneware coffee mug', brand: 'Slow mornings', category: 'Home & kitchen', kind: 'mug', price: 18.00, note: 'A simple home for your morning coffee.' },
  { id: 'sample-6', title: 'Adjustable reading lamp', brand: 'Light on demand', category: 'Home & kitchen', kind: 'lamp', price: 39.99, note: 'A warm pool of light for your favorite corner.' },
  { id: 'sample-7', title: 'Pocket notebook, set of 3', brand: 'Make a little space', category: 'Office', kind: 'notebook', price: 12.00, note: 'For ideas that deserve a place off-screen.' },
  { id: 'sample-8', title: 'Portable wireless speaker', brand: 'Good company', category: 'Electronics', kind: 'speaker', price: 49.99, note: 'A small soundtrack for the everyday.' },
].map(p => ({ ...p, sample: true }));
