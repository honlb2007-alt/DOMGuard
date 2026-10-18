import { defineConfig } from 'vite';

// The content script is injected on demand with chrome.scripting.executeScript,
// so it is not part of the manifest and @crxjs never bundles it. Build it here
// as a single classic script with a stable name the service worker can inject.
// Runs after the main build, hence emptyOutDir: false.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome111',
    sourcemap: false,
    lib: {
      entry: 'src/content/index.ts',
      formats: ['iife'],
      name: 'DOMGuardContent',
      fileName: () => 'content.js',
    },
  },
});
