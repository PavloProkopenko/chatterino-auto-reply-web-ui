// Build smoke: compile the spike server into a single executable with Bun and run the HTTP smoke test on it.
// Phase 1 replaces the spike server with the real app entry point.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'spikes', 'server', 'dist');
const exe = join(out, process.platform === 'win32' ? 'smoke-server.exe' : 'smoke-server');
mkdirSync(out, { recursive: true });
// pnpm only creates .cmd shims on Windows, so use the real binary the bun package installs there (UNVERIFIED until CI runs).
const bun = process.platform === 'win32'
  ? join(root, 'node_modules', 'bun', 'bin', 'bun.exe')
  : join(root, 'node_modules', '.bin', 'bun');
execFileSync(bun, ['build', '--compile', join(root, 'spikes', 'server', 'server.mjs'), '--outfile', exe], { stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'spikes', 'server', 'smoke.mjs'), exe], { stdio: 'inherit' });
console.log('build smoke OK');
