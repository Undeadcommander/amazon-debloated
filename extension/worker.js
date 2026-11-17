const AMAZON_CART = 'https://www.amazon.com/gp/cart/view.html';
const SESSION = chrome.storage.session;
const JOB_LIFETIME = 2 * 60_000;
const jobKey = tabId => 'bare-cart:' + tabId;
const claiming = new Set();

function senderUrl(sender) {
  if (sender.frameId != null && sender.frameId !== 0) return null;
  try {
    const url = new URL(sender.url);
    return sender.origin && sender.origin !== url.origin ? null : url;
  } catch { return null; }
}

function isBarePage(url) {
  if (!url) return false;
  if (url.origin === 'https://undeadcommander.github.io') {
    return ['/amazon-debloated/', '/amazon-debloated/index.html'].includes(url.pathname);
  }
  return ['http://127.0.0.1:3000', 'http://localhost:3000'].includes(url.origin) &&
    ['/', '/index.html'].includes(url.pathname);
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) return null;
  const clean = [];
  const seen = new Set();
  for (const item of items) {
    const { id, quantity } = item ?? {};
    if (typeof id !== 'string' || !/^[A-Z0-9]{10}$/.test(id) || seen.has(id) ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return null;
    seen.add(id);
    clean.push({ id, quantity });
  }
  return clean;
}

async function openAmazonCart(items) {
  // Attach the job before navigating, so even a fast cart page can claim it.
  const tab = await chrome.tabs.create({ url: 'about:blank' });
  const key = jobKey(tab.id);
  try {
    await SESSION.set({ [key]: { items, expires: Date.now() + JOB_LIFETIME } });
    await chrome.tabs.update(tab.id, { url: AMAZON_CART });
    return { opened: true };
  } catch (error) {
    await Promise.allSettled([SESSION.remove(key), chrome.tabs.remove(tab.id)]);
    throw error;
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!isBarePage(senderUrl(sender))) return;
  if (message?.type === 'bare-cart:ping') {
    respond({ ready: true });
    return;
  }
  if (message?.type !== 'bare-cart:open') return;
  const items = validateItems(message.items);
  if (!items) {
    respond({ opened: false });
    return;
  }
  openAmazonCart(items).then(respond, () => respond({ opened: false }));
  return true;
});

async function claimJob(key) {
  if (claiming.has(key)) return null;
  claiming.add(key);
  try {
    const { [key]: job } = await SESSION.get(key);
    if (!job) return null;
    await SESSION.remove(key);
    return job.expires >= Date.now() ? { items: job.items } : null;
  } finally { claiming.delete(key); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'bare-cart:claim' || !Number.isInteger(sender.tab?.id)) return;
  const url = senderUrl(sender);
  if (url?.origin !== 'https://www.amazon.com' || !['/gp/cart/view.html', '/cart', '/cart/'].includes(url.pathname)) return;
  claimJob(jobKey(sender.tab.id)).then(respond, () => respond(null));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => { SESSION.remove(jobKey(tabId)).catch(() => {}); });
