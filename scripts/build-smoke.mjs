// Build smoke: compile the real server (with the production UI) into a single executable and run the API smoke on it.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildExe, root } from './build-exe.mjs';

const exe = buildExe('auto-reply-web-smoke');
execFileSync(process.execPath, [join(root, 'scripts', 'smoke.mjs'), exe], { stdio: 'inherit' });
console.log('build smoke OK');
