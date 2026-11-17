# Bare — Amazon, simplified

A minimal Amazon US shopping workspace. Plain HTML, CSS, and JavaScript; no frontend framework, analytics, third-party fonts, or runtime dependencies. The Node server serves compressed static assets from memory.

## Run

Install Node.js 22 or newer, then:

```sh
npm start
```

Open http://127.0.0.1:3000. No dependency installation is needed to run the app. `npm run dev` restarts the server when files change; refresh the page after editing. Set `PORT` and `HOST` to override the default loopback listener.

On the Windows machine used to build this project, a checksum-verified portable Node installation is available. Run `./start.ps1` in PowerShell if Node is not on PATH.

## What works without an API key

- Search the local catalog instantly, filter by category, and sort by reference price or name.
- Import a full Amazon.com product URL or a 10-character ASIN. Optionally enter a product name, price, and notes. Duplicate imports update the existing product.
- Open clean product detail pages and follow direct links to Amazon.
- Create, rename, and delete lists; save products to multiple lists.
- Add products to a persistent local cart, adjust quantities, and transfer ASINs and quantities to Amazon using its add-to-cart URL.
- Keep products, lists, and cart in browser `localStorage`, including cross-tab updates. No account or backend database.
- Choose Light, Dark, Sand, or Ocean from the header's Theme menu, or follow your device with System. The choice is saved separately on this device and syncs across open tabs.
- Explore eight clearly labeled sample products with local SVG illustrations. Samples cannot be transferred to Amazon.
- Use “Delete all items” beside “Add product” to permanently remove all imported and sample products from this device, empty every list, and clear the local cart after confirmation. Sample products stay removed after reload; list names and your theme remain. This does not change your Amazon cart.

## Limits to understand

**This is not a live Amazon catalog search engine.** The search field searches products already in this browser plus the sample catalog. “Search Amazon” opens the Amazon homepage in a new tab. Paste the chosen product link back into Bare. Names, notes, and reference prices are entered manually; images, reviews, inventory, and current prices are not fetched or fabricated. Imported products use a neutral package illustration.

The app supports Amazon US only. Open shortened links such as `a.co` on Amazon first and copy the resulting full product URL. Choose the exact product variant before copying its link.

The cart uses `https://www.amazon.com/gp/aws/cart/add.html` with numbered `ASIN.n` and `Quantity.n` parameters, as described in Amazon's [add-to-cart documentation](https://g-ecx.images-amazon.com/images/G/09/associates/paapi/dg/AddToCartForm.html). No affiliate tag is added. Amazon controls acceptance, sign-in, confirmation, price, and availability. The app does not read or synchronize the user's existing Amazon cart, reserve inventory, or place orders. Transfer is capped at 50 distinct products and 99 units per product. The local cart remains intact after handoff. If Amazon rejects a transfer, use each product's direct Amazon link to add items there.

**Amazon-side transfer has not been verified with a signed-in account.** Tests verify the exact outbound ASIN and quantity encoding, not Amazon's current handling of it.

All saved data belongs to this browser origin. Clearing site data, changing the port, or switching browsers changes the available data. Stored data is not encrypted. If storage is unavailable, the app warns and continues for the current session. This version intentionally has no cloud synchronization.

## Future live catalog integration

Amazon's [Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/) is the current official product data API; [PA-API 5 is deprecated](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation). Live search requires access to that API or a suitable licensed third-party provider. There is no keyless live-search backend in this project.

Once access is available, add a server-side provider for search and item lookup, keep credentials out of browser code, return only the fields needed by the interface, and respect the provider's display and caching requirements. Keep imported ASINs and list membership separate from expiring catalog content. This avoids tying the interface to a particular provider or presenting saved prices as live offers.

## Verify

```sh
npm ci
npm run check
npm test
```

Tests cover URL validation, state recovery, search/sorting, integer-cent totals, cart transfer construction, HTTP delivery/security, and DOM shopping flows through jsdom. jsdom is a development-only dependency. No test contacts Amazon or changes a real Amazon cart. DOM tests do not replace visual verification in a real browser.

## Structure

| File | Purpose |
| --- | --- |
| `public/index.html` | App shell and accessible navigation |
| `public/app.js` | Hash routes, rendering, dialogs, and interactions |
| `public/core.js` | Validation, search, state normalization, and cart logic |
| `public/styles.css` | Responsive interface and reduced-motion support |
| `public/theme.js` | Saved color themes and system appearance, applied before rendering |
| `public/products.svg` | Local sample illustrations |
| `server.mjs` | Zero-dependency static HTTP server, gzip, ETags, and CSP |
| `test/` | Unit, HTTP, and DOM integration tests |

Static hosting is also possible: serve the contents of `public/` at a domain root or a subdirectory. Hash routes need no server-side rewrites. The GitHub Pages workflow publishes `public/` whenever `main` changes. Configure equivalent security and compression headers on other hosts where supported.
