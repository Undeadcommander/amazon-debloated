(async () => {
  const origin = 'https://www.amazon.com';
  const cartUrl = `${origin}/gp/cart/view.html`;
  const cartPaths = new Set(['/gp/cart/view.html', '/cart', '/cart/']);
  if (location.origin !== origin || !cartPaths.has(location.pathname)) return;

  const asinPattern = /^[A-Z0-9]{10}$/;
  const endpointPattern = /^\/cart\/add-to-cart(?:\/ref=[A-Za-z0-9_-]+)?$/;
  const quantityFields = ['quantity', 'items[0.base][quantity]'];
  const nativeFields = new Set([
    'anti-csrftoken-a2z', 'items[0.base][customerVisiblePrice][amount]',
    'items[0.base][customerVisiblePrice][currencyCode]', 'items[0.base][customerVisiblePrice][displayString]',
    'items[0.base][asin]', 'clientName', 'items[0.base][offerListingId]', 'pageLoadTimestampUTC',
    'offerListingID', 'session-id', 'ASIN', 'isMerchantExclusive', 'merchantID', 'isAddon', 'nodeID',
    'sellingCustomerID', 'qid', 'sr', 'storeID', 'tagActionCode', 'viewID', 'rebateId', 'ctaDeviceType',
    'ctaPageType', 'usePrimeHandler', 'smokeTestEnabled', 'rsid', 'sourceCustomerOrgListID',
    'sourceCustomerOrgListItemID', 'wlPopCommand', 'submit.add-to-cart', 'pipelineType',
    'isEligibilityLogicDisabled', ...quantityFields,
  ]);

  function element(tag, text) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }

  function overlay() {
    const panel = element('section');
    const title = element('h2', 'Bare cart transfer');
    const status = element('p', 'Preparing to add items to your Amazon cart…');
    const details = element('div');
    panel.id = 'bare-cart-transfer';
    title.id = 'bare-cart-transfer-title';
    panel.setAttribute('aria-labelledby', title.id);
    status.setAttribute('role', 'status');
    panel.append(title, status, details);
    document.body.append(panel);
    return { status, details };
  }

  function report(view, status, remaining) {
    view.status.textContent = status;
    const list = element('ul');
    for (const { id, quantity, reason } of remaining) {
      const row = element('li');
      const listing = element('a', `Open Amazon listing for ${id}`);
      listing.href = `${origin}/dp/${id}`;
      listing.target = '_blank';
      listing.rel = 'noopener noreferrer';
      row.append(`${quantity} × ${id} not confirmed. ${reason} `, listing);
      list.append(row);
    }
    const refresh = element('a', 'See refreshed Amazon cart');
    refresh.href = cartUrl;
    view.details.replaceChildren(list, refresh);
  }

  function amazonFetch(url, options = {}) {
    return fetch(url, {
      mode: 'same-origin', credentials: 'same-origin', cache: 'no-store',
      redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000),
      ...options,
    });
  }

  async function readPage(url, acceptsPath) {
    const response = await amazonFetch(url);
    if (!response.ok) throw new Error('Amazon page unavailable');
    const finalUrl = new URL(response.url);
    if (finalUrl.origin !== origin || !acceptsPath(finalUrl.pathname)) throw new Error('Unexpected Amazon page');
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (page.querySelector('#ap_email, #signInSubmit, #captchacharacters')) throw new Error('Amazon needs attention');
    return page;
  }

  async function readCart() {
    const page = await readPage(cartUrl, path => cartPaths.has(path));
    const active = page.querySelector('#sc-active-cart');
    const rows = active?.querySelectorAll('[data-itemtype="active"]') ?? [];
    if (!rows.length) {
      if (page.querySelector('#sc-empty-cart')) return new Map();
      throw new Error('Could not identify the Amazon cart contents');
    }
    if (!page.querySelector('#activeCartViewForm')) throw new Error('Could not identify the Amazon cart form');
    const quantities = new Map();
    for (const row of rows) {
      const { asin, quantity } = row.dataset;
      const count = Number(quantity);
      const total = (quantities.get(asin) ?? 0) + count;
      if (!asinPattern.test(asin) || !/^\d+$/.test(quantity) || count < 1 || !Number.isSafeInteger(total)) {
        throw new Error('Could not read an active Amazon cart line');
      }
      quantities.set(asin, total);
    }
    return quantities;
  }

  async function prepareItem({ id, quantity }) {
    const productPath = `/dp/${id}`;
    const productUrl = `${origin}${productPath}`;
    let page;
    try {
      page = await readPage(productUrl, path => path === productPath || path.startsWith(`${productPath}/ref=`));
    } catch {
      throw new Error('Could not read the Amazon listing.');
    }

    const button = page.querySelector('#add-to-cart-button');
    const form = button?.form;
    if (!form || button.matches(':disabled') || button.name !== 'submit.add-to-cart' ||
        (button.getAttribute('formmethod') ?? form.method).toLowerCase() !== 'post') {
      throw new Error('Amazon did not offer its standard Add to Cart form.');
    }

    const action = button.getAttribute('formaction') ?? form.getAttribute('action') ?? '';
    const endpoint = URL.parse(action, productUrl);
    if (!endpoint || endpoint.origin !== origin || endpoint.username || endpoint.password ||
        !endpointPattern.test(endpoint.pathname)) {
      throw new Error('Amazon returned an unexpected Add to Cart address.');
    }

    const data = new FormData(form, button);
    if (!['ASIN', 'items[0.base][asin]'].every(field =>
      data.getAll(field).length === 1 && data.get(field) === id) ||
      !data.get('anti-csrftoken-a2z') ||
      !(data.get('offerListingID') || data.get('items[0.base][offerListingId]'))) {
      throw new Error('Amazon returned an unexpected product or checkout form.');
    }

    const picker = form.querySelector('select#quantity[name="quantity"]');
    if (!picker || picker.matches(':disabled') || !Array.from(picker.options).some(option =>
      option.value === String(quantity) && !option.matches(':disabled') && !option.closest('optgroup[disabled]'))) {
      throw new Error(`Amazon did not offer a quantity of ${quantity}.`);
    }

    // Amazon's shared form can include isBuyNow=1 even for this Add to Cart button.
    // Forward only the approved cart fields, leaving the Buy Now flag out.
    const body = new URLSearchParams();
    for (const [key, value] of data) {
      if (nativeFields.has(key) && typeof value === 'string') body.append(key, value);
    }
    for (const field of quantityFields) body.set(field, String(quantity));
    return { url: `${origin}${endpoint.pathname}`, body };
  }

  async function transfer(view, items) {
    view.status.textContent = 'Checking your existing Amazon cart…';
    let baseline;
    try {
      baseline = await readCart();
    } catch {
      return report(view, 'Bare couldn’t read your Amazon cart. Nothing was submitted. Check Amazon for a sign-in or verification prompt.',
        items.map(item => ({ ...item, reason: 'Not submitted.' })));
    }

    const outcomes = [];
    for (const [index, item] of items.entries()) {
      view.status.textContent = `Adding item ${index + 1} of ${items.length} to Amazon…`;
      let request;
      try {
        request = await prepareItem(item);
      } catch (error) {
        outcomes.push({ ...item, submitted: false, reason: error.message });
        continue;
      }

      let reason = 'Amazon did not show the full requested increase.';
      try {
        const response = await amazonFetch(request.url, { method: 'POST', body: request.body, redirect: 'manual' });
        if (!response.ok) reason = 'Amazon did not confirm the add request.';
      } catch {
        reason = 'The add request did not complete; check the cart before adding manually.';
      }
      outcomes.push({ ...item, submitted: true, reason });
    }

    view.status.textContent = 'Verifying quantities in your Amazon cart…';
    let final;
    try {
      final = await readCart();
    } catch {
      return report(view, 'Bare couldn’t verify the updated Amazon cart. Check Amazon for a sign-in or verification prompt, and review your cart before adding manually.',
        outcomes.map(item => item.submitted ? { ...item, reason: 'The result of the add request is unknown.' } : item));
    }

    const remaining = [];
    for (const item of outcomes) {
      const increase = (final.get(item.id) ?? 0) - (baseline.get(item.id) ?? 0);
      const verified = item.submitted ? Math.max(0, increase) : 0;
      if (verified < item.quantity) remaining.push({ ...item, quantity: item.quantity - verified });
    }
    if (remaining.length) {
      return report(view, 'Bare couldn’t confirm every requested quantity. Review your Amazon cart before adding the remaining items manually.', remaining);
    }
    view.status.textContent = 'All requested quantities verified. Refreshing your Amazon cart…';
    location.reload();
  }

  let job;
  try { job = await chrome.runtime.sendMessage({ type: 'bare-cart:claim' }); } catch { return; }
  const items = job?.items;
  if (!Array.isArray(items) || !items.length || items.some(item =>
    typeof item?.id !== 'string' || !asinPattern.test(item.id) ||
    !Number.isSafeInteger(item.quantity) || item.quantity < 1) ||
    new Set(items.map(item => item.id)).size !== items.length) return;

  const view = overlay();
  let started = false;
  try {
    const run = () => {
      started = true;
      return transfer(view, items);
    };
    if (navigator.locks) {
      view.status.textContent = 'Waiting for access to your Amazon cart…';
      await navigator.locks.request('bare-amazon-cart-transfer', { signal: AbortSignal.timeout(60000) }, run);
    } else {
      await run();
    }
  } catch {
    report(view, started ? 'Bare couldn’t finish the transfer. Review your Amazon cart before adding manually.' :
      'Bare couldn’t access your Amazon cart. Nothing was submitted.', items.map(item => ({ ...item,
      reason: started ? 'Check the cart for the final quantity.' : 'Not submitted.',
    })));
  }
})();
