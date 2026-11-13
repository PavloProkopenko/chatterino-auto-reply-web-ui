// usage: node smoke.mjs <executable> [args...]  — starts it, exercises the API, kills it.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'smoke-'));
const target = join(dir, 'config.json');
const [cmd, ...args] = process.argv.slice(2);
const p = spawn(cmd, args, { env: { ...process.env, SPIKE_TARGET: target } });
const info = await new Promise((res, rej) => {
  p.stdout.once('data', (d) => res(JSON.parse(d.toString().split('\n')[0])));
  p.on('error', rej); setTimeout(() => rej(new Error('no startup output')), 8000);
});
const req = (path, { method = 'GET', headers = {}, body, host } = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port: info.port, path, method, headers: { ...(host ? { host } : {}), ...headers } },
    (m) => { let b = ''; m.on('data', (c) => (b += c)); m.on('end', () => res({ s: m.statusCode, b })); });
  r.on('error', rej); if (body) r.write(body); r.end();
});
const T = { 'x-session-token': info.token };
const results = {
  page: (await req('/')).s === 200,
  badHost: (await req('/', { host: 'evil.example' })).s === 421,
  noToken: (await req('/api/ping')).s === 403,
  ping: (await req('/api/ping', { headers: T })).s === 200,
  write: (await req('/api/write', { method: 'POST', headers: T, body: '{"x":"привет"}' })).s === 200
    && readFileSync(target, 'utf8') === '{"x":"привет"}',
};
p.kill();
console.log(JSON.stringify(results));
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
