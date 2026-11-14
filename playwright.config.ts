import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// The browser lives in .tools/ (installed by scripts/prepare.sh), never in the repo or a global cache.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(import.meta.dirname, '.tools', 'browsers');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { browserName: 'chromium', locale: 'ru-RU', colorScheme: 'dark', baseURL: 'http://127.0.0.1:4173' },
  webServer: [
    // the production build (made by `pnpm test:e2e`, mode e2e) with the production security headers
    { command: './node_modules/.bin/vite preview --mode e2e', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 30_000 },
    // the dev server, for tests that import source modules or check that `pnpm dev` renders
    { command: './node_modules/.bin/vite --port 5199 --strictPort', url: 'http://127.0.0.1:5199', reuseExistingServer: false, timeout: 30_000 },
  ],
});
