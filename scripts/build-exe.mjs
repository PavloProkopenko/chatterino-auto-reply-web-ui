// Shared by build-smoke and build-e2e: build the UI, then compile the server into a single executable with Bun.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} name executable base name; @param {Record<string,string>} env extra env for the UI build (VITE_*) */
export function buildExe(name, env = {}) {
  const out = join(root, 'dist');
  const exe = join(out, process.platform === 'win32' ? `${name}.exe` : name);
  mkdirSync(out, { recursive: true });
  execFileSync(process.execPath, [join(root, 'scripts', 'build-ui.mjs')], { stdio: 'inherit', env: { ...process.env, ...env } });
  // pnpm only creates .cmd shims on Windows, so use the real binary the bun package installs there (UNVERIFIED until CI runs).
  const bun = process.platform === 'win32' ? join(root, 'node_modules', 'bun', 'bin', 'bun.exe') : join(root, 'node_modules', '.bin', 'bun');
  execFileSync(bun, ['build', '--compile', join(root, 'src', 'server', 'main.ts'), '--outfile', exe], { stdio: 'inherit' });
  return exe;
}
