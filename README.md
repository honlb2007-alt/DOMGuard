# DOMGuard

Chrome extension for privacy masking and anti-prompt injection.

This repository currently contains a Manifest V3 skeleton (TypeScript + Vite + `@crxjs/vite-plugin` + Tailwind CSS). Feature logic is not implemented yet.

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

Permissions are limited to `activeTab`, `storage`, and `scripting`. The content script is not auto-injected on every site; it is meant to be injected into the current tab after a popup action (via `chrome.scripting.executeScript`).

## Test page

`test/sample.html` holds fake sensitive data (email, Taiwan mobile number, Luhn-valid test card,
`sk-` key, JWT) plus eight hidden-text samples for the Task B detector. Open it with `file://` and
enable **Allow access to file URLs** on the extension's details page, otherwise `activeTab`
injection is blocked on local files.
