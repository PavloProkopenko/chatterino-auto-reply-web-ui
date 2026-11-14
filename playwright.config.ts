import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// The browser lives in .tools/ (installed by scripts/prepare.*), never in the repo or a global cache.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(import.meta.dirname, '.tools', 'browsers');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { browserName: 'chromium', locale: 'ru-RU', colorScheme: 'dark' },
});
