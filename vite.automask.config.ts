import { defineConfig } from 'vite';

// Registered with chrome.scripting.registerContentScripts under a fixed file
// name. A hashed asset name would have to be rewritten into that call.
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
      entry: 'src/content/automask.ts',
      formats: ['iife'],
      name: 'DOMGuardAutoMask',
      fileName: () => 'automask.js',
    },
  },
}));
