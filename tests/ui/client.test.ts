import { describe, expect, test } from 'vitest';
import { OfflineError } from '../../src/shared/api-types.ts';
import { createClient } from '../../src/ui/data/client.ts';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fakeFetch = (handler: (path: string, init: RequestInit) => Response | Promise<Response>) => (async (path: string, init: RequestInit) => handler(path, init)) as unknown as typeof fetch;

describe('api client', () => {
  test('sends the token on every call and JSON bodies with the right header', async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const c = createClient('tok', fakeFetch((path, init) => (seen.push({ path, init }), reply(200, { candidates: [], selected: null }))));
    await c.discover();
    expect((seen[0]!.init.headers as Record<string, string>)['x-session-token']).toBe('tok');
    const post = createClient('tok', fakeFetch((path, init) => (seen.push({ path, init }), reply(200, { ok: true, path: '/c/config.json', exists: true, pluginVersion: null, warnings: [] }))));
    await post.select('/c/config.json');
    const h = seen[1]!.init.headers as Record<string, string>;
    expect(h['content-type']).toBe('application/json');
    expect(JSON.parse(seen[1]!.init.body as string)).toEqual({ path: '/c/config.json' });
  });

  test('no token, a rejected token or a dead server all mean offline', async () => {
    await expect(createClient(null, fakeFetch(() => reply(200, {}))).discover()).rejects.toBeInstanceOf(OfflineError);
    await expect(createClient('t', fakeFetch(() => reply(403, { error: 'bad-token' }))).discover()).rejects.toBeInstanceOf(OfflineError);
    await expect(createClient('t', fakeFetch(() => reply(421, { error: 'bad-host' }))).discover()).rejects.toBeInstanceOf(OfflineError);
    await expect(createClient('t', fakeFetch(() => Promise.reject(new TypeError('fetch failed')))).discover()).rejects.toBeInstanceOf(OfflineError);
  });

  test('"no config selected" is a normal state, a bad path is a result, a conflict is returned as data', async () => {
    expect(await createClient('t', fakeFetch(() => reply(200, { status: 'no-config-selected' }))).loadConfig()).toEqual({ status: 'no-config-selected' });
    expect(await createClient('t', fakeFetch(() => reply(400, { error: 'not-config-json' }))).select('/x')).toEqual({ ok: false, error: 'not-config-json' });
    const conflict = { status: 'conflict', conflicts: [], theirs: {}, snapshot: { hash: 'h', mtimeMs: 1, size: 1 } };
    expect(await createClient('t', fakeFetch(() => reply(409, conflict))).save('a'.repeat(64), {} as never)).toEqual(conflict);
  });

  test('an unexpected status is an error that names the status and code, not the body', async () => {
    await expect(createClient('t', fakeFetch(() => reply(500, { error: 'internal' }))).loadConfig()).rejects.toThrow('server answered 500: internal');
  });
});
