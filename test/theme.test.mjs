import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../public/theme.js', import.meta.url), 'utf8');
const key = 'bare-theme-v1';

function boot(t, { saved, dark = false, unavailableStorage = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://example.test/amazon-debloated/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  let onSystemChange;
  const media = { matches: dark, addEventListener: (name, callback) => { if (name === 'change') onSystemChange = callback; } };
  w.matchMedia = () => media;
  if (saved !== undefined) w.localStorage.setItem(key, saved);
  const shopping = '{"cart":[{"id":"B012345678","quantity":2}]}';
  w.localStorage.setItem('bare-shopping-v1', shopping);
  if (unavailableStorage) Object.defineProperty(w, 'localStorage', { get() { throw new Error('Storage denied'); } });
  w.eval(source);
  const initialTheme = w.document.documentElement.dataset.theme;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const picker = w.document.getElementById('theme');
  return {
    w, picker, initialTheme, shopping,
    theme: () => w.document.documentElement.dataset.theme,
    choose(value) { picker.value = value; picker.dispatchEvent(new w.Event('change', { bubbles: true })); },
    system(value) { media.matches = value; onSystemChange(); },
  };
}

test('defaults to system appearance and follows live system changes', t => {
  const app = boot(t, { dark: true });
  assert.equal(app.initialTheme, 'dark');
  assert.equal(app.picker.value, 'system');
  app.system(false);
  assert.equal(app.theme(), 'light');
  app.choose('dark');
  app.system(true); app.system(false);
  assert.equal(app.theme(), 'dark');
  app.choose('system');
  assert.equal(app.theme(), 'light');
});

test('every explicit theme persists, restores before page rendering, and preserves cart data', t => {
  for (const theme of ['light', 'dark', 'sand', 'ocean']) {
    const app = boot(t);
    app.choose(theme);
    assert.equal(app.theme(), theme);
    assert.equal(app.w.localStorage.getItem(key), theme);
    assert.equal(app.w.localStorage.getItem('bare-shopping-v1'), app.shopping);
    const reload = boot(t, { saved: theme, dark: true });
    assert.equal(reload.initialTheme, theme);
    assert.equal(reload.picker.value, theme);
    assert.match(reload.w.document.querySelector('meta[name="theme-color"]').content, /^#[a-f0-9]{6}$/);
  }
});

test('theme storage events sync other tabs and clearing preferences restores system appearance', t => {
  const app = boot(t, { saved: 'sand', dark: true });
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key, newValue: 'ocean' }));
  assert.equal(app.theme(), 'ocean');
  assert.equal(app.picker.value, 'ocean');
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key: 'unrelated', newValue: 'light' }));
  assert.equal(app.theme(), 'ocean');
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key: null, newValue: null }));
  assert.equal(app.theme(), 'dark');
  assert.equal(app.picker.value, 'system');
});

test('invalid saved values and unavailable storage leave theme controls usable', t => {
  for (const saved of ['__proto__', 'invalid']) {
    const app = boot(t, { saved, dark: true });
    assert.equal(app.theme(), 'dark');
    assert.equal(app.picker.value, 'system');
  }
  const app = boot(t, { unavailableStorage: true });
  assert.equal(app.theme(), 'light');
  assert.doesNotThrow(() => app.choose('ocean'));
  assert.equal(app.theme(), 'ocean');
});
