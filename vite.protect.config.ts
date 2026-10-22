import { defineConfig } from 'vite';

// Registered with chrome.scripting.registerContentScripts. The output name is
// fixed, so a hashed asset filename never has to be copied into the call.
// Runs after the main build, hence emptyOutDir: false.
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
      entry: 'src/content/protect-all.ts',
      formats: ['iife'],
      name: 'DOMGuardProtectAll',
      fileName: () => 'protect-all.js',
    },
  },
}));
