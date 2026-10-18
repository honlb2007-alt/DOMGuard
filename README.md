# DOMGuard

Chrome extension for privacy masking and anti-prompt injection.

Manifest V3 extension (TypeScript + Vite + `@crxjs/vite-plugin` + Tailwind CSS) for masking sensitive data and stripping hidden text before a screenshot.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Load the generated `dist` folder as an unpacked extension. Vite will rebuild on change.

`npm run dev` only covers the popup and service worker. The on-demand content script is a separate
bundle, so run this in a second terminal if you are iterating on it:

```bash
npx vite build --config vite.content.config.ts --watch
```

## Production build

```bash
npm run build
```

Output is written to `dist/`. The build runs twice: `@crxjs` bundles everything the manifest
references, then `vite.content.config.ts` emits `dist/content.js` — a single classic script with a
stable name that the service worker injects with `chrome.scripting.executeScript`. The content
script is deliberately absent from the manifest, so it would otherwise never be bundled.

## Load in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this project’s `dist` folder

Permissions stay `activeTab`, `storage`, and `scripting`. The only host permission is `https://extensionpay.com/*`, which the service worker uses to talk to ExtensionPay.

The manifest also registers one content script, and only for `https://extensionpay.com/*` at `document_start`. ExtPay needs that script so `onPaid` can tell that a payment finished. It does not run on any other site. DOMGuard's own content script is still injected into the current tab only after a popup action (`chrome.scripting.executeScript`), never from the manifest.

The ExtensionPay sample extension also injects a script on every `http`/`https` page. That entry is their demo, not a requirement for payments. This project does not include it.

## Pro and the free screenshot allowance

Register the extension at [extensionpay.com](https://extensionpay.com), then replace `EXTPAY_ID` in `src/shared/config.ts` (it starts as `your-extension-id`). Unpaid installs get `FREE_DAILY_SCREENSHOTS` plain screenshots per local day (3). Those captures skip hidden-text removal and pixel denoising. Scan & Mask and Scan Hidden Text require Pro. The manual picker, clearing masks, and changing mask style stay free.

The service worker is the only place that decides Pro or quota. A field on a popup message cannot grant either.

While `npm run dev` is running, the Pro path can be forced without paying. In the extension's service worker console:

```js
chrome.storage.local.set({ devForcePro: true })
```

Set it back to `false` to return to the free allowance. `npm run build` removes this switch. After a production build, this must print nothing:

```bash
rg "devForcePro" dist
```

## Safe screenshot

**Safe Screenshot** uses `chrome.tabs.captureVisibleTab`, which captures only the area currently visible in the tab. Content below the fold, other tabs, and the browser chrome are not included. The hint under the button says the same thing.

Before the capture, hidden text found by the DOM pass is set to `visibility: hidden`, then the content script waits two animation frames so the page has actually repainted. DOMGuard masks stay on the page (they live in a closed shadow host and are never part of that pass) so the screenshot shows them. The page is restored afterwards, including when the capture fails.

A pixel pass then flattens near-background noise. It lives in `src/background/pixel-clean.ts`. Adjust it there:

- `DEFAULT_THRESHOLD` (default `12`) is the RGB distance below which a pixel is rewritten to the block's background colour. A pixel at exactly this distance is kept. Raise it to remove more faint noise; that also risks softening real edges and antialiasing. Lower it to change fewer pixels, leaving subtler near-background text in place.
- `DEFAULT_BLOCK_SIZE` (default `8`) is the square used to decide the background colour. A block is only cleaned when one colour covers more than half of its pixels.

## Test page

`test/sample.html` holds fake sensitive data (email, Taiwan mobile number, Luhn-valid test card,
`sk-` key, JWT) plus eight hidden-text samples for the Task B detector. Open it with `file://` and
enable **Allow access to file URLs** on the extension's details page, otherwise `activeTab`
injection is blocked on local files.
