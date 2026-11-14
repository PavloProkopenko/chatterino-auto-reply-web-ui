import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The svelte plugin compiles `.svelte.ts` state modules (runes) so they can be unit-tested without a DOM.
  plugins: [svelte()],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 15000 },
});
