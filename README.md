# DOMGuard

Manifest V3 Chrome extension skeleton (TypeScript + Vite + `@crxjs/vite-plugin` + Tailwind CSS). Feature logic is not implemented yet.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Load the generated `dist` folder as an unpacked extension. Vite will rebuild on change.

## Production build

```bash
npm run build
```

Output is written to `dist/`.

## Load in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this project’s `dist` folder

Permissions are limited to `activeTab`, `storage`, and `scripting`. The content script is not auto-injected on every site; it is meant to be injected into the current tab after a popup action (via `chrome.scripting.executeScript`).
