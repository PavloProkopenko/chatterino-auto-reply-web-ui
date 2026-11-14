// Builds the executable the Playwright tests run against. Same code as production plus the VITE_E2E test seam.
import { buildExe } from './build-exe.mjs';

console.log(buildExe('auto-reply-web-e2e', { VITE_E2E: '1' }));
