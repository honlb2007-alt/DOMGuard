import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// A full page, not a content script. Built after the main extension so
// emptyOutDir stays false and the popup build is left in place.
export default defineConfig(({ mode }) => ({
  base: '',
  define: {
    'import.meta.env.DEV': mode === 'development' ? 'true' : 'false',
  },
  build: {
    outDir: mode === 'development' ? 'dist-dev' : 'dist',
    emptyOutDir: false,
    sourcemap: false,
    target: 'chrome111',
    rollupOptions: {
      input: fileURLToPath(new URL('./src/welcome/index.html', import.meta.url)),
    },
  },
}));
