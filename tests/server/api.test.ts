import http from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { startServer, type RunningServer } from '../../src/server/app.ts';

const TOKEN_HEADER = 'x-session-token';
const SECRET = 'СЕКРЕТНЫЙ-КАНАЛ-123';

let root: string;
let dataDir: string;
let configPath: string;
let srv: RunningServer;
let logs: string[];

const configText = (over: Record<string, unknown> = {}) =>
  JSON.stringify(
    {
      version: 1,
      active_until: 'forever',
      channels: [SECRET],
      ignore_users: {},
      next_rule_id: 2,
      rules: [{ id: 1, enabled: true, reply: 'один', channels: {}, conditions: [{ type: 'word', match: 'x' }] }],
      next_timer_id: 1,
      timers: {},
      ...over,
    },
    null,
    2,
  ) + '\n';

async function makePlugin(version = '0.5.0', withConfig = true) {
  const dir = join(root, 'Chatterino', 'Plugins', 'auto-reply');
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'info.json'), JSON.stringify({ name: 'Auto Reply', version }));
  const p = join(dir, 'data', 'config.json');
  if (withConfig) await writeFile(p, configText());
  return p;
}

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: () => any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
function request(path: string, init: { method?: string; headers?: Record<string, string>; body?: string; host?: string; token?: string | null } = {}): Promise<Res> {
  const { port } = srv;
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.host) headers.host = init.host;
  if (init.token !== null) headers[TOKEN_HEADER] = init.token ?? srv.token;
  if (init.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body, json: () => JSON.parse(body) }));
    });
    req.on('error', reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}
const post = (path: string, data: unknown) => request(path, { method: 'POST', body: JSON.stringify(data) });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'api-'));
  dataDir = await mkdtemp(join(tmpdir(), 'api-data-'));
  logs = [];
  configPath = await makePlugin();
  srv = await startServer({ roots: [root], settingsDir: dataDir, log: (m) => logs.push(m), assets: new Map([['/', { type: 'text/html; charset=utf-8', body: '<!doctype html><title>t</title>' }]]) });
});
afterEach(async () => {
  await srv.close();
  await rm(root, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

describe('security', () => {
  test('the page needs no token and carries a strict CSP; no CORS headers anywhere', async () => {
    const r = await request('/', { token: null });
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect(r.headers['cache-control']).toBe('no-store');
  });

  test('binds to loopback only', () => {
    expect(srv.address).toBe('127.0.0.1');
  });

  test.each(['evil.example', 'evil.example:' + 1, '127.0.0.1.evil.example', '[::1]:80'])('a foreign Host header (%s) is rejected', async (host) => {
    const r = await request('/api/discover', { host });
    expect(r.status).toBe(421);
  });

  test('localhost with the right port is accepted', async () => {
    expect((await request('/api/discover', { host: `localhost:${srv.port}` })).status).toBe(200);
  });

  test('every API call needs the session token', async () => {
    expect((await request('/api/discover', { token: null })).status).toBe(403);
    expect((await request('/api/discover', { token: 'wrong' })).status).toBe(403);
    expect((await request('/api/discover', { token: srv.token.slice(0, -1) })).status).toBe(403);
    expect((await request('/api/config', { token: null })).status).toBe(403);
    expect((await request('/api/config/save', { method: 'POST', token: null, body: '{}' })).status).toBe(403);
  });

  test('a cross-site Origin is rejected even with a valid token', async () => {
    const r = await request('/api/discover', { headers: { origin: 'https://evil.example' } });
    expect(r.status).toBe(403);
    const ok = await request('/api/discover', { headers: { origin: `http://127.0.0.1:${srv.port}` } });
    expect(ok.status).toBe(200);
  });

  test('POST must be application/json (blocks form-style cross-site posts)', async () => {
    const r = await request('/api/config/select', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(r.status).toBe(415);
  });

  test('oversized bodies are refused with 413', async () => {
    await srv.close();
    srv = await startServer({ roots: [], settingsDir: dataDir, log: () => {}, assets: new Map(), maxBodyBytes: 1024 });
    const r = await request('/api/config/select', { method: 'POST', body: JSON.stringify({ path: 'x'.repeat(4096) }) });
    expect(r.status).toBe(413);
  });

  test('unknown API paths, odd methods and traversal attempts get 404/405 and no file contents', async () => {
    expect((await request('/api/nope')).status).toBe(404);
    expect((await request('/api/discover', { method: 'DELETE' })).status).toBe(405);
    expect((await request('/..%2f..%2fetc%2fpasswd', { token: null })).status).toBe(404);
    expect((await request('/vendor/plugin/rules.lua', { token: null })).status).toBe(404);
  });

  test('nothing from the config reaches the log', async () => {
    await post('/api/config/select', { path: configPath });
    await request('/api/config');
    expect(logs.join('\n')).not.toContain(SECRET);
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe('discovery and selection', () => {
  test('discover lists candidates found by content', async () => {
    const r = await request('/api/discover');
    expect(r.status).toBe(200);
    expect(r.json().candidates).toEqual([expect.objectContaining({ configPath, pluginVersion: '0.5.0', configExists: true })]);
  });

  test('config is unavailable until a path is confirmed (auto-detect alone is not confirmation)', async () => {
    const r = await request('/api/config');
    expect(r.status).toBe(409);
    expect(r.json().error).toBe('no-config-selected');
  });

  test('select rejects a path not named config.json, and never touches the file', async () => {
    const r = await post('/api/config/select', { path: join(root, 'passwd') });
    expect(r.status).toBe(400);
  });

  test('select remembers the choice in the app settings, outside the plugin folder', async () => {
    const r = await post('/api/config/select', { path: configPath });
    expect(r.status).toBe(200);
    expect(JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8')).configPath).toBe(configPath);
    expect((await readdir(join(configPath, '..'))).sort()).toEqual(['config.json']);
  });

  test('a remembered path is used on the next start', async () => {
    await post('/api/config/select', { path: configPath });
    await srv.close();
    srv = await startServer({ roots: [], settingsDir: dataDir, log: () => {}, assets: new Map() });
    expect((await request('/api/config')).status).toBe(200);
  });
});

describe('config read and save', () => {
  beforeEach(async () => {
    await post('/api/config/select', { path: configPath });
  });

  test('GET /api/config returns the normalised config, the hash and the feature gates', async () => {
    const r = await request('/api/config');
    const j = r.json();
    expect(r.status).toBe(200);
    expect(j.status).toBe('ok');
    expect(j.snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(j.config.ignore_users).toEqual([]);
    expect(j.features).toMatchObject({ names: true, skipUsers: true });
    expect(j.pluginVersion).toBe('0.5.0');
  });

  test('an older plugin gets gated features', async () => {
    await makePlugin('0.2.0');
    expect((await request('/api/config')).json().features).toMatchObject({ names: false, skipUsers: false });
  });

  test('save writes the edit and returns the new snapshot', async () => {
    const j = (await request('/api/config')).json();
    j.config.rules[0].reply = 'новый';
    const r = await post('/api/config/save', { baseHash: j.snapshot.hash, config: j.config });
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({ status: 'saved', merged: false });
    expect(await readFile(configPath, 'utf8')).toBe(configText().replace('"один"', '"новый"'));
  });

  test('a conflicting plugin save gives 409 with the conflicts and leaves the file alone', async () => {
    const j = (await request('/api/config')).json();
    const theirs = JSON.parse(configText());
    theirs.rules[0].reply = 'плагин';
    const theirsText = JSON.stringify(theirs, null, 2) + '\n';
    await writeFile(configPath, theirsText);
    j.config.rules[0].reply = 'я';
    const r = await post('/api/config/save', { baseHash: j.snapshot.hash, config: j.config });
    expect(r.status).toBe(409);
    expect(r.json()).toMatchObject({ status: 'conflict', conflicts: [{ path: 'rules[1].reply' }] });
    expect(await readFile(configPath, 'utf8')).toBe(theirsText);
  });

  test('a stale base hash the server does not know asks for a reload', async () => {
    const j = (await request('/api/config')).json();
    await writeFile(configPath, configText({ per_user_cooldown: 1 }));
    const r = await post('/api/config/save', { baseHash: 'a'.repeat(64), config: j.config });
    expect(r.status).toBe(409);
    expect(r.json().status).toBe('stale-base');
  });

  test('malformed save bodies are 400 and write nothing', async () => {
    const before = await readFile(configPath, 'utf8');
    for (const body of [{}, { baseHash: 'x', config: {} }, { baseHash: 'a'.repeat(64) }, { baseHash: 'a'.repeat(64), config: [] }, { baseHash: 'a'.repeat(64), config: 'str' }]) {
      expect((await post('/api/config/save', body)).status).toBe(400);
    }
    expect((await request('/api/config/save', { method: 'POST', body: '{not json' })).status).toBe(400);
    expect(await readFile(configPath, 'utf8')).toBe(before);
  });

  test('a save request cannot name another file: unknown fields are ignored, the confirmed path is used', async () => {
    const other = join(root, 'other', 'config.json');
    await mkdir(join(root, 'other'), { recursive: true });
    await writeFile(other, 'untouched');
    const j = (await request('/api/config')).json();
    j.config.rules[0].reply = 'изменено';
    await post('/api/config/save', { baseHash: j.snapshot.hash, config: j.config, path: other });
    expect(await readFile(other, 'utf8')).toBe('untouched');
  });

  test('invalid JSON on disk: read-only view with the error, saves are refused, file untouched', async () => {
    await writeFile(configPath, '{half');
    const r = await request('/api/config');
    expect(r.json()).toMatchObject({ status: 'invalid', readOnly: true });
    const s = await post('/api/config/save', { baseHash: 'a'.repeat(64), config: { version: 1 } });
    expect(s.status).toBe(409);
    expect(await readFile(configPath, 'utf8')).toBe('{half');
  });
});

describe('missing config and backups', () => {
  test('missing file is reported and a default can be created on request only', async () => {
    await rm(configPath);
    const missing = configPath;
    await post('/api/config/select', { path: missing });
    expect((await request('/api/config')).json().status).toBe('missing');
    const created = await post('/api/config/create-default', {});
    expect(created.status).toBe(201);
    expect(JSON.parse(await readFile(missing, 'utf8'))).toMatchObject({ version: 1, per_user_cooldown: 60 });
    expect((await post('/api/config/create-default', {})).status).toBe(409);
  });

  test('writes are refused until a path is confirmed', async () => {
    expect((await post('/api/config/save', { baseHash: 'a'.repeat(64), config: { version: 1 } })).status).toBe(409);
    expect((await post('/api/config/create-default', {})).status).toBe(409);
    expect((await post('/api/backups/restore', { name: 'config.json.bak-20260101T000000000Z-000' })).status).toBe(409);
  });

  test('backups are listed and restored; bad names are 400', async () => {
    await post('/api/config/select', { path: configPath });
    const j = (await request('/api/config')).json();
    j.config.rules[0].reply = 'после';
    await post('/api/config/save', { baseHash: j.snapshot.hash, config: j.config });
    const list = (await request('/api/backups')).json().backups as { name: string }[];
    expect(list).toHaveLength(1);
    const r = await post('/api/backups/restore', { name: list[0]!.name });
    expect(r.status).toBe(200);
    expect(await readFile(configPath, 'utf8')).toBe(configText());
    expect((await post('/api/backups/restore', { name: '../config.json' })).status).toBe(400);
  });
});
