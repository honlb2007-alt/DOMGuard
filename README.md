# DOMGuard

DOMGuard hides sensitive information in the current tab before you take a screenshot, and finds hidden text that can steer an AI reading that page.

On a Pro install, **Auto Scan and Mask** covers secrets such as API keys, email addresses, card numbers, and tokens with a black or blurred mask. While those automatic masks are on, hold Alt to peek at the original text. **Show Hidden Text** marks text that is invisible to a person but still present in the page, including text that could steer an AI prompt. That instruction mark is a best guess, not a guarantee. **Capture visible area** then hides that text, captures the tab, flattens near-background pixels, and copies the picture to the clipboard. An unpaid install can copy a limited number of plain screenshots. The manual picker, clearing masks, and changing mask style stay free.

Scanning, masking, and the pixel pass run in the browser. DOMGuard does not upload page text or screenshots.

## Scope and limitations

DOMGuard works on web pages in the browser only. It does not process other desktop apps.

Chrome does not allow extensions on `chrome://` pages, the Chrome Web Store, the New Tab page, or the built-in PDF viewer. On those pages the popup says Chrome blocks extensions there.

Protect all sites does not look inside iframes, and it cannot see a closed shadow tree. An open shadow tree is watched up to a small depth and a small number of roots. A stylesheet change, a closed shadow tree, a frame, or a burst over the time budget can leave hidden text briefly, and some of it may not be found.

Screenshots include only the visible area of the current tab. They do not include the browser UI, other tabs, or other windows, and they do not change a picture already copied.

Detection is best-effort. It cannot guarantee that every secret or every hidden instruction is found. Review the screen before sharing.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | After you open DOMGuard, capture the visible area of that tab and inject the masker into it. This is not a standing permission to read every site. |
| `storage` | Save settings, the last custom capture width and height, and the daily free-screenshot count in `chrome.storage.local`. ExtensionPay uses `chrome.storage.sync` for its purchase record, described below. Page text and screenshot bytes are not stored. |
| `scripting` | Inject `content.js` into the active tab when you use a feature. Protect all sites registers `protect-all.js` and `automask.js` at runtime, only after you turn that feature on. Those scripts are not listed as manifest content scripts. |
| `host_permissions`: `https://extensionpay.com/*` | Let the service worker talk to ExtensionPay. No other host is listed. |
| Optional `optional_host_permissions`: `<all_urls>` | Requested only when a paid install turns on Protect all sites. Turning the feature off removes it when nothing else needs it. It is not requested at install. |

The only manifest content script matches `https://extensionpay.com/*` at `document_start`. ExtensionPay needs it so a finished payment can notify the extension. It does not run on other sites. The ExtensionPay sample that injects a script on every page is not included. The built manifest also lists that script's chunk under `web_accessible_resources`, with the same `https://extensionpay.com/*` match.

The service worker is the only place that decides Pro access and the free screenshot allowance. A field on a popup message cannot grant either.

## ExtensionPay

Register the extension at [extensionpay.com](https://extensionpay.com). `EXTPAY_ID` in `src/shared/config.ts` is `domguard`. Pro is a one-time purchase through ExtensionPay and Stripe. The popup shows `$4.99`. That figure is the popup label, not a price read back from ExtensionPay.

When ExtensionPay checks the install, it saves the user record in `chrome.storage.sync` under `extensionpay_user`. That record can include the payer's email, along with payment fields returned by ExtensionPay. It also stores `extensionpay_api_key` and `extensionpay_installed_at`. DOMGuard's own paid check is kept in the service worker's memory and is not written to storage.

## Screenshots

**Capture visible area** uses `chrome.tabs.captureVisibleTab`, then copies the picture to the clipboard. Paste it with Ctrl+V (Command+V on Mac). It captures only the area currently visible in the tab. Content below the fold, other tabs, and the browser chrome are not included.

On Pro, hidden text found in the page is set to `visibility: hidden` and the capture waits two animation frames so the page can repaint. Masks stay in the image. The page is restored afterwards, including when the capture fails. A pixel pass then rewrites pixels that sit strictly closer than `DEFAULT_THRESHOLD` (default `12`) to a block background. Tune `DEFAULT_THRESHOLD` and `DEFAULT_BLOCK_SIZE` in `src/background/pixel-clean.ts`. Raising the threshold removes more faint noise and can also soften real edges. Lowering it leaves more near-background text in place.

An unpaid install gets `FREE_DAILY_SCREENSHOTS` plain screenshots per local day (3). Those captures do not remove hidden text and do not run the pixel pass. The count lives in `chrome.storage.local` on this machine, so it is not a security boundary. The allowance is counted only after the picture is copied to the clipboard. A failed copy does not use a slot.

## Keyboard shortcuts

Suggested keys come from `manifest.json`. The popup and the welcome page read the live binding with `chrome.commands.getAll()`, so a shortcut you change is what they show. Chrome allows at most four suggested shortcuts. DOMGuard suggests three. The Mac key on Capture area is a platform override of that same command, not a fourth shortcut.

| Action | Suggested shortcut |
| --- | --- |
| Turn Protect all sites on or off | Alt+Shift+P |
| Mask sensitive data on this page | Alt+Shift+M |
| Capture an area of the page | Ctrl+Shift+S (Command+Shift+S on Mac) |
| Open DOMGuard | Not set. Chrome may report this toolbar command on the welcome page. The manifest does not suggest a key. |

Change them at `chrome://extensions/shortcuts`.

**Capture area** starts a drag. Arrow keys move an 8-pixel box, and Shift plus an arrow changes its size. Enter captures that box once it is at least 8 pixels on each side. Enter before any arrow still captures the visible area. Press the same shortcut again while that tool is open to capture the visible area. The second press does not copy by itself. Dragging copies when the pointer release is allowed to write the clipboard. If the copy does not happen, the card says to press Copy, or to open a normal website and try again.

## Development rules

[docs/DEV_RULES.md](docs/DEV_RULES.md) is the source of truth. In short: English UI and comments; no `innerHTML` or remote code; permissions stay `activeTab`, `storage`, and `scripting`, with `https://extensionpay.com/*` plus the optional `<all_urls>` grant; Pro checks and message checks live in the service worker; storage holds settings, counts, and hostnames, not page text or screenshots; overlays use a closed shadow root; production builds must not contain `devForcePro` or diagnostic logs. Do not commit unless asked.

## Development

```bash
npm install
npm run dev
```

Load `dist` as an unpacked extension (`chrome://extensions`, Developer mode, **Load unpacked**). `npm run dev` covers the popup and service worker. The on-demand content script and the Protect all sites script are a separate bundle. `protect-all.js` keeps that exact file name, with no content hash, so the service worker can register it:

```bash
npx vite build --config vite.content.config.ts --watch
npx vite build --config vite.protect.config.ts --watch
npx vite build --config vite.automask.config.ts --watch
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

This builds `dist`, then writes `domguard-1.1.0.zip` in the project root. That zip is the Chrome Web Store package for version 1.1.0. It contains the files inside `dist`, with `manifest.json` at the archive root. Production builds do not emit source maps. `dist/`, `node_modules/`, and `privacy-site/` stay out of git. The privacy policy that matches this release is [docs/privacy.html](docs/privacy.html).
