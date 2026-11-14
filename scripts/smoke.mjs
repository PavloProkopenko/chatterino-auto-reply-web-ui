// End-to-end smoke test of the built executable: node scripts/smoke.mjs <executable>
// Starts it against a synthetic plugin install, then: page, security rejections, discover, select, load, save, read back.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2];
if (!exe) throw new Error('usage: node scripts/smoke.mjs <executable>');

const tmp = mkdtempSync(join(tmpdir(), 'smoke-'));
const plugin = join(tmp, 'roots', 'Chatterino', 'Plugins', 'auto-reply');
mkdirSync(join(plugin, 'data'), { recursive: true });
writeFileSync(join(plugin, 'info.json'), JSON.stringify({ name: 'Auto Reply', version: '0.5.0' }));
const configPath = join(plugin, 'data', 'config.json');
const original = JSON.stringify({ version: 1, channels: {}, next_rule_id: 2, rules: [{ id: 1, enabled: true, reply: 'один', channels: {}, conditions: [{ type: 'word', match: 'x' }] }] }, null, 2) + '\n';
writeFileSync(configPath, original);

const child = spawn(exe, [], { env: { ...process.env, AUTO_REPLY_WEB_ROOTS: join(tmp, 'roots'), AUTO_REPLY_WEB_DATA: join(tmp, 'app-data') } });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));

const url = await new Promise((resolve, reject) => {
  child.stdout.once('data', (d) => resolve(String(d).split('\n')[0]));
  child.on('error', reject);
  setTimeout(() => reject(new Error('no startup output; stderr: ' + stderr)), 10000);
});
const { port, hash: token } = (() => {
  const u = new URL(url);
  return { port: Number(u.port), hash: u.hash.slice(1) };
})();

const call = (path, { method = 'GET', body, host, auth = true } = {}) =>
  new Promise((resolve, reject) => {
    const headers = {};
    if (host) headers.host = host;
    if (auth) headers['x-session-token'] = token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });

let failed = false;
const check = (name, ok) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
};

try {
  check('page is served without a token', (await call('/', { auth: false })).status === 200);
  check('foreign Host rejected', (await call('/api/discover', { host: 'evil.example' })).status === 421);
  check('missing token rejected', (await call('/api/discover', { auth: false })).status === 403);
  const discovered = JSON.parse((await call('/api/discover')).text);
  check('synthetic config discovered', discovered.candidates?.[0]?.configPath === configPath);
  check('config locked until confirmed', JSON.parse((await call('/api/config')).text).status === 'no-config-selected');
  check('select confirms the path', (await call('/api/config/select', { method: 'POST', body: { path: configPath } })).status === 200);
  const loaded = JSON.parse((await call('/api/config')).text);
  check('config loads', loaded.status === 'ok' && loaded.config.rules[0].reply === 'один');
  loaded.config.rules[0].reply = 'новый';
  const saved = await call('/api/config/save', { method: 'POST', body: { baseHash: loaded.snapshot.hash, config: loaded.config } });
  check('save succeeds', saved.status === 200);
  check('only the edit changed on disk', readFileSync(configPath, 'utf8') === original.replace('"один"', '"новый"'));
  check('a backup was made next to the config', readdirSync(join(plugin, 'data')).some((n) => n.startsWith('config.json.bak-')));
} finally {
  child.kill();
  rmSync(tmp, { recursive: true, force: true });
}
if (failed) {
  console.error(stderr);
  process.exit(1);
}
console.log('smoke OK');
