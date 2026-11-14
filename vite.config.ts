import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The built UI is embedded into the executable (scripts/build-ui.mjs) and served under a strict CSP:
// no inline scripts, no inline <style>, no style="" attributes (use classes), no external hosts.
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/ui'),
  plugins: [svelte()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/ui'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    sourcemap: false,
  },
  worker: { format: 'es' },
});
