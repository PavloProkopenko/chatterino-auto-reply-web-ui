// Build smoke: compile the real server entry point into a single executable with Bun and run the e2e smoke on it.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const exe = join(out, process.platform === 'win32' ? 'auto-reply-web-smoke.exe' : 'auto-reply-web-smoke');
mkdirSync(out, { recursive: true });
// pnpm only creates .cmd shims on Windows, so use the real binary the bun package installs there (UNVERIFIED until CI runs).
const bun = process.platform === 'win32'
  ? join(root, 'node_modules', 'bun', 'bin', 'bun.exe')
  : join(root, 'node_modules', '.bin', 'bun');
execFileSync(bun, ['build', '--compile', join(root, 'src', 'server', 'main.ts'), '--outfile', exe], { stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'scripts', 'smoke.mjs'), exe], { stdio: 'inherit' });
console.log('build smoke OK');
