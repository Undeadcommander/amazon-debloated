(() => {
  const key = 'bare-theme-v1';
  const colors = { light: '#f8f8f5', dark: '#181d1b', sand: '#f6efdf', ocean: '#edf5f8' };
  const normalize = value => value === 'system' || Object.hasOwn(colors, value) ? value : 'system';
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { preference = normalize(localStorage.getItem(key)); } catch { /* Use system appearance when storage is unavailable. */ }

  function apply() {
    const theme = preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[theme]);
    const picker = document.getElementById('theme');
    if (picker) picker.value = preference;
  }

  // Apply in the head so returning visitors see their saved colors immediately.
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme')?.addEventListener('change', event => {
      preference = normalize(event.target.value);
      apply();
      try { localStorage.setItem(key, preference); } catch { /* Keep the selected theme for this session. */ }
    });
  }, { once: true });
  media?.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = normalize(event.newValue);
    apply();
  });
})();
