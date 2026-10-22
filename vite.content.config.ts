import { defineConfig } from 'vite';

// Injected on demand with chrome.scripting.executeScript, so it is not part of
// the manifest and @crxjs never bundles or hashes it. fileName() keeps the
// path stable. Runs after the main build, hence emptyOutDir: false.
export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.DEV': mode === 'development' ? 'true' : 'false',
  },
  build: {
    outDir: mode === 'development' ? 'dist-dev' : 'dist',
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
}));
