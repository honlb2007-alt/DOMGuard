# DOMGuard

DOMGuard hides sensitive information in the current tab before you take a screenshot, and finds hidden text that can steer an AI reading that page.

On a Pro install, **Auto Scan & Mask** covers secrets such as API keys, email addresses, card numbers, and tokens with a black or blurred mask. **Scan Hidden Text** lists text that is invisible to a person but still present in the page, including text that could hijack an AI prompt. **Safe Screenshot** then hides that text, captures the tab, and flattens near-background pixels. An unpaid install can take a limited number of plain screenshots. The manual picker, clearing masks, and changing mask style stay free.

Scanning, masking, and the pixel pass run in the browser. DOMGuard does not upload page text or screenshots.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | After you open DOMGuard, capture the visible area of that tab and inject the masker into it. This is not a standing permission to read every site. |
| `storage` | Remember how many free screenshots were used today, on this machine. ExtensionPay also uses storage for its payment record, described below. Matched secrets and screenshot bytes are not stored. |
| `scripting` | Inject `content.js` into the active tab only when you use a feature. That script is not registered for every site. |
| `host_permissions`: `https://extensionpay.com/*` | Let the service worker talk to ExtensionPay. No other host is listed. |

One content script is registered, and only for `https://extensionpay.com/*` at `document_start`. ExtensionPay needs it so a finished payment can notify the extension. It does not run on other sites. The ExtensionPay sample that injects a script on every page is not included.

The service worker is the only place that decides Pro access and the free screenshot allowance. A field on a popup message cannot grant either.

## ExtensionPay

Register the extension at [extensionpay.com](https://extensionpay.com), then replace `EXTPAY_ID` in `src/shared/config.ts`. It starts as `your-extension-id`. Pro is a one-time purchase through ExtensionPay and Stripe.

When ExtensionPay checks the install, it saves the user record in `chrome.storage.sync` under `extensionpay_user`. That record can include the payer's email, along with payment fields returned by ExtensionPay. It also stores `extensionpay_api_key` and `extensionpay_installed_at`. DOMGuard's own paid check is kept in the service worker's memory and is not written to storage.

## Screenshots

**Safe Screenshot** uses `chrome.tabs.captureVisibleTab`. It captures only the area currently visible in the tab. Content below the fold, other tabs, and the browser chrome are not included.

On Pro, hidden text found in the page is set to `visibility: hidden` and the capture waits two animation frames so the page can repaint. Masks stay in the image. The page is restored afterwards, including when the capture fails. A pixel pass then rewrites pixels that sit strictly closer than `DEFAULT_THRESHOLD` (default `12`) to a block background. Tune `DEFAULT_THRESHOLD` and `DEFAULT_BLOCK_SIZE` in `src/background/pixel-clean.ts`. Raising the threshold removes more faint noise and can also soften real edges. Lowering it leaves more near-background text in place.

An unpaid install gets `FREE_DAILY_SCREENSHOTS` plain screenshots per local day (3). Those captures do not remove hidden text and do not run the pixel pass. The count lives in `chrome.storage.local` on this machine, so it is not a security boundary.

## Development

```bash
npm install
npm run dev
```

Load `dist` as an unpacked extension (`chrome://extensions`, Developer mode, **Load unpacked**). `npm run dev` covers the popup and service worker. The on-demand content script is a separate bundle:

```bash
npx vite build --config vite.content.config.ts --watch
```

```bash
npm test
npm run build
```

While `npm run dev` is running, the Pro path can be forced without paying. In the extension's service worker console:

```js
chrome.storage.local.set({ devForcePro: true })
```

Set it back to `false` to return to the free allowance. A production build removes this switch.

`test/sample.html` holds fake secrets and hidden-text samples. Open it with `file://` and enable **Allow access to file URLs** on the extension's details page.

## Package a release

```bash
npm run package
```

This builds `dist`, then writes `domguard-1.0.0.zip` in the project root. The zip contains the files inside `dist`, with `manifest.json` at the archive root. Production builds do not emit source maps.
