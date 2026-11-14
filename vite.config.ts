import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The site is static (Vercel serves `dist`). It runs under a strict CSP (src/shared/security-headers.ts):
// no inline scripts, no inline <style>, no style="" attributes (use classes), no Svelte transitions, no external hosts.
export default defineConfig(({ mode }) => ({
  root: resolve(import.meta.dirname, 'src/ui'),
  envDir: import.meta.dirname, // .env.e2e lives at the repo root
  plugins: [svelte({ configFile: resolve(import.meta.dirname, 'svelte.config.js') })],
  build: {
    // `--mode e2e` builds a copy with the test seam (window.__e2e) into its own folder, never into `dist`
    outDir: resolve(import.meta.dirname, mode === 'e2e' ? 'dist-e2e' : 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    sourcemap: false,
  },
  worker: { format: 'es' },
}));
