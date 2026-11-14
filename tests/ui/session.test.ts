import { describe, expect, test } from 'vitest';
import { normalise, type Config } from '../../src/shared/config.ts';
import { OfflineError, type Api, type ConfigResponse, type SaveResponse } from '../../src/shared/api-types.ts';
import { featuresFor } from '../../src/shared/features.ts';
import { Session } from '../../src/ui/state/session.svelte.ts';

const hash = (c: string) => c.repeat(64).slice(0, 64);
const rule = (id: number, reply = 'r') => ({ id, enabled: true, reply, channels: [], conditions: [{ type: 'word', match: 'x' }] });
const base = (over: Record<string, unknown> = {}): Config => normalise({ channels: ['a'], rules: [rule(1), rule(2)], next_rule_id: 3, ...over });
const info = { path: '/p/config.json', pluginVersion: '0.5.0', features: featuresFor('0.5.0') };
const ok = (config: Config, h = 'a'): ConfigResponse => ({ status: 'ok', ...info, snapshot: { hash: hash(h), mtimeMs: 1, size: 1 }, config, exact: true });

function fakeApi(over: Partial<Api> = {}) {
  const calls: { save: [string, Config][]; select: string[]; restore: string[] } = { save: [], select: [], restore: [] };
  const api: Api = {
    discover: async () => ({ candidates: [], selected: '/p/config.json' }),
    select: async (path) => (calls.select.push(path), { ok: true, path, exists: true, pluginVersion: '0.5.0', warnings: [] }),
    loadConfig: async () => ok(base()),
    save: async (h, c) => (
      calls.save.push([h, c]),
      { status: 'saved', snapshot: { hash: hash('b'), mtimeMs: 2, size: 2 }, config: c, notes: [], merged: false, backup: 'config.json.bak-x' } as SaveResponse
    ),
    createDefault: async () => ({ status: 'created' }),
    backups: async () => [],
    restore: async (name) => (calls.restore.push(name), { status: 'restored', snapshot: { hash: hash('c'), mtimeMs: 3, size: 3 }, backup: 'b' }),
    ...over,
  };
  return { api, calls };
}
let t = 0;
const make = (over: Partial<Api> = {}) => {
  const f = fakeApi(over);
  return { ...f, s: new Session({ api: f.api, now: () => t }) };
};

describe('starting', () => {
  test('a remembered config loads and is clean', async () => {
    const { s } = make();
    await s.start();
    expect(s.phase).toBe('ready');
    expect(s.dirty).toBe(false);
    expect(s.current?.channels).toEqual(['a']);
    expect(s.info?.pluginVersion).toBe('0.5.0');
  });

  test('no confirmed config: offers the discovered installs and waits for a choice', async () => {
    const cand = { configPath: '/p/config.json', pluginDir: '/p', appFolder: 'Chatterino', pluginVersion: '0.5.0', configExists: true, mtimeMs: 1 };
    let selected = false;
    const { s } = make({
      loadConfig: async () => (selected ? ok(base()) : { status: 'no-config-selected' }),
      discover: async () => ({ candidates: [cand], selected: null }),
      select: async (p) => ((selected = true), { ok: true, path: p, exists: true, pluginVersion: '0.5.0', warnings: [] }),
    });
    await s.start();
    expect(s.phase).toBe('unselected');
    expect(s.candidates).toEqual([cand]);
    await s.choose('/p/config.json');
    expect(s.phase).toBe('ready');
  });

  test('choosing a bad path reports the error and stays on the picker', async () => {
    const { s } = make({
      loadConfig: async () => ({ status: 'no-config-selected' }),
      select: async () => ({ ok: false, error: 'not-config-json' }),
    });
    await s.start();
    await s.choose('/x/passwd');
    expect(s.phase).toBe('unselected');
    expect(s.pickError).toBe('not-config-json');
  });

  test('a missing file offers to create the default; creating loads it', async () => {
    let created = false;
    const { s } = make({
      loadConfig: async () => (created ? ok(base()) : { status: 'missing', ...info }),
      createDefault: async () => ((created = true), { status: 'created' as const }),
    });
    await s.start();
    expect(s.phase).toBe('missing');
    await s.createDefault();
    expect(s.phase).toBe('ready');
  });

  test('an invalid file is a read-only view with the error text; edits and saves do nothing', async () => {
    const { s, calls } = make({
      loadConfig: async () => ({ status: 'invalid', readOnly: true, ...info, snapshot: { hash: hash('d'), mtimeMs: 1, size: 1 }, error: 'Unexpected token', text: '{half' }),
    });
    await s.start();
    expect(s.phase).toBe('invalid');
    expect(s.invalid).toEqual({ error: 'Unexpected token', text: '{half' });
    s.edit((c) => (c.global_min_gap = 9));
    await s.save();
    expect(calls.save).toEqual([]);
  });

  test('an unreachable server puts the app offline', async () => {
    const { s } = make({ loadConfig: async () => Promise.reject(new OfflineError()) });
    await s.start();
    expect(s.phase).toBe('offline');
  });
});

describe('editing, undo, redo, revert', () => {
  test('edit makes it dirty; revert restores the saved state', async () => {
    const { s } = make();
    await s.start();
    s.edit((c) => (c.per_user_cooldown = 5));
    expect(s.dirty).toBe(true);
    expect(s.canLeave).toBe(false);
    s.revert();
    expect(s.dirty).toBe(false);
    expect(s.current?.per_user_cooldown).toBe(60);
  });

  test('undo and redo walk the history; a new edit drops the redo branch', async () => {
    const { s } = make();
    await s.start();
    s.edit((c) => (c.per_user_cooldown = 5));
    s.edit((c) => (c.per_user_cooldown = 6));
    s.undo();
    expect(s.current?.per_user_cooldown).toBe(5);
    s.undo();
    expect(s.current?.per_user_cooldown).toBe(60);
    expect(s.canUndo).toBe(false);
    s.redo();
    expect(s.current?.per_user_cooldown).toBe(5);
    s.edit((c) => (c.per_user_cooldown = 7));
    expect(s.canRedo).toBe(false);
  });

  test('typing in one field is one undo step (coalescing within a short window)', async () => {
    const { s } = make();
    await s.start();
    for (const v of [1, 12, 120]) {
      t += 100;
      s.edit((c) => (c.per_user_cooldown = v), 'per_user_cooldown');
    }
    s.undo();
    expect(s.current?.per_user_cooldown).toBe(60);
    t += 5000;
    s.edit((c) => (c.per_user_cooldown = 1), 'per_user_cooldown');
    t += 5000;
    s.edit((c) => (c.per_user_cooldown = 2), 'per_user_cooldown');
    s.undo();
    expect(s.current?.per_user_cooldown).toBe(1);
  });
});

describe('saving', () => {
  test('sends the loaded hash and the edit, then is clean and asks for /autoreply reload', async () => {
    const { s, calls } = make();
    await s.start();
    s.edit((c) => (c.per_user_cooldown = 5));
    await s.save();
    expect(calls.save[0]![0]).toBe(hash('a'));
    expect(calls.save[0]![1].per_user_cooldown).toBe(5);
    expect(s.dirty).toBe(false);
    expect(s.needsReload).toBe(true);
    expect(s.canUndo).toBe(false);
    s.dismissReload();
    expect(s.needsReload).toBe(false);
  });

  test('the next save uses the hash the server returned', async () => {
    const { s, calls } = make();
    await s.start();
    s.edit((c) => (c.per_user_cooldown = 5));
    await s.save();
    s.edit((c) => (c.per_user_cooldown = 6));
    await s.save();
    expect(calls.save[1]![0]).toBe(hash('b'));
  });

  test('a merged save shows what was merged', async () => {
    const { s } = make({
      save: async (_h, c) => ({ status: 'saved', snapshot: { hash: hash('b'), mtimeMs: 2, size: 2 }, config: c, notes: [{ path: 'timers[1].enabled', note: 'live value taken from disk' }], merged: true, backup: null }),
    });
    await s.start();
    s.edit((c) => (c.per_user_cooldown = 5));
    await s.save();
    expect(s.lastSave).toMatchObject({ merged: true, notes: [{ path: 'timers[1].enabled' }] });
  });

  test('saving with nothing changed does not call the server', async () => {
    const { s, calls } = make();
    await s.start();
    await s.save();
    expect(calls.save).toEqual([]);
  });

  test('stale-base keeps the edits and asks the user to reload', async () => {
    const { s } = make({ save: async () => ({ status: 'stale-base' }) });
    await s.start();
    s.edit((c) => (c.per_user_cooldown = 5));
    await s.save();
    expect(s.staleBase).toBe(true);
    expect(s.dirty).toBe(true);
  });

  test('an unexpected failure is reported and edits are kept', async () => {
    const { s } = make({ save: async () => Promise.reject(new Error('boom')) });
    await s.start();
    s.edit((c) => (c.per_user_cooldown = 5));
    await s.save();
    expect(s.error).toBe('boom');
    expect(s.dirty).toBe(true);
    expect(s.saving).toBe(false);
  });
});

describe('conflicts', () => {
  const theirs = base({ rules: [rule(1), rule(2, 'плагин')] });
  const conflictApi = (sink: { saves: [string, Config][] }) => ({
    save: async (h: string, c: Config): Promise<SaveResponse> => {
      sink.saves.push([h, c]);
      if (sink.saves.length === 1) {
        return { status: 'conflict', conflicts: [{ path: 'rules[2].reply', base: 'r', theirs: 'плагин', mine: 'я' }], theirs, snapshot: { hash: hash('e'), mtimeMs: 5, size: 5 } };
      }
      return { status: 'saved', snapshot: { hash: hash('f'), mtimeMs: 6, size: 6 }, config: c, notes: [], merged: false, backup: 'b' };
    },
  });

  test('a conflict opens the dialog and changes nothing', async () => {
    const sink = { saves: [] as [string, Config][] };
    const { s } = make(conflictApi(sink));
    await s.start();
    s.edit((c) => (c.rules[1]!.reply = 'я'));
    await s.save();
    expect(s.conflict?.conflicts[0]!.path).toBe('rules[2].reply');
    expect(s.dirty).toBe(true);
    expect(s.current?.rules[1]!.reply).toBe('я');
  });

  test("choosing 'mine' re-saves against the plugin's version with my value", async () => {
    const sink = { saves: [] as [string, Config][] };
    const { s } = make(conflictApi(sink));
    await s.start();
    s.edit((c) => (c.rules[1]!.reply = 'я'));
    await s.save();
    await s.resolveConflicts({ 'rules[2].reply': 'mine' });
    expect(sink.saves[1]![0]).toBe(hash('e'));
    expect(sink.saves[1]![1].rules[1]!.reply).toBe('я');
    expect(s.conflict).toBeNull();
    expect(s.dirty).toBe(false);
  });

  test("choosing 'theirs' keeps the plugin's value", async () => {
    const sink = { saves: [] as [string, Config][] };
    const { s } = make(conflictApi(sink));
    await s.start();
    s.edit((c) => (c.rules[1]!.reply = 'я'));
    await s.save();
    await s.resolveConflicts({ 'rules[2].reply': 'theirs' });
    expect(s.current?.rules[1]!.reply).toBe('плагин');
  });

  test('an unresolved conflict keeps the dialog open', async () => {
    const sink = { saves: [] as [string, Config][] };
    const { s } = make(conflictApi(sink));
    await s.start();
    s.edit((c) => (c.rules[1]!.reply = 'я'));
    await s.save();
    await s.resolveConflicts({});
    expect(s.conflict).not.toBeNull();
    expect(sink.saves).toHaveLength(1);
  });

  test("cancelling the dialog keeps the user's edits", async () => {
    const sink = { saves: [] as [string, Config][] };
    const { s } = make(conflictApi(sink));
    await s.start();
    s.edit((c) => (c.rules[1]!.reply = 'я'));
    await s.save();
    s.cancelConflict();
    expect(s.conflict).toBeNull();
    expect(s.current?.rules[1]!.reply).toBe('я');
  });
});

describe('external changes and reload from disk', () => {
  test('a clean session silently picks up what the plugin saved', async () => {
    let live = ok(base(), 'a');
    const { s } = make({ loadConfig: async () => live });
    await s.start();
    live = ok(base({ per_user_cooldown: 30 }), 'z');
    await s.refreshIfChanged();
    expect(s.current?.per_user_cooldown).toBe(30);
    expect(s.externalChange).toBe(false);
  });

  test('a dirty session is told, and keeps its edits (the save will merge)', async () => {
    let live = ok(base(), 'a');
    const { s } = make({ loadConfig: async () => live });
    await s.start();
    s.edit((c) => (c.global_min_gap = 9));
    live = ok(base({ per_user_cooldown: 30 }), 'z');
    await s.refreshIfChanged();
    expect(s.externalChange).toBe(true);
    expect(s.current?.global_min_gap).toBe(9);
  });

  test('reloadFromDisk discards the edits', async () => {
    const { s } = make();
    await s.start();
    s.edit((c) => (c.global_min_gap = 9));
    await s.reloadFromDisk();
    expect(s.dirty).toBe(false);
    expect(s.staleBase).toBe(false);
  });
});

describe('restore', () => {
  test('restoring reloads the file and drops unsaved edits', async () => {
    const { s, calls } = make();
    await s.start();
    s.edit((c) => (c.global_min_gap = 9));
    await s.restore('config.json.bak-20260101T000000000Z-000');
    expect(calls.restore).toEqual(['config.json.bak-20260101T000000000Z-000']);
    expect(s.dirty).toBe(false);
    expect(s.needsReload).toBe(true);
  });
});

describe('field errors block saving', () => {
  test('a field with an error disables saving until it is fixed; nothing reaches the server meanwhile', async () => {
    const { s, calls } = make();
    await s.start();
    s.edit((c) => (c.per_user_cooldown = 5));
    expect(s.canSave).toBe(true);
    s.setFieldError('per_rule_cooldown', 'Введите число');
    expect(s.canSave).toBe(false);
    await s.save();
    expect(calls.save).toEqual([]);
    s.setFieldError('per_rule_cooldown', null);
    expect(s.canSave).toBe(true);
    await s.save();
    expect(calls.save).toHaveLength(1);
  });

  test('errors are cleared when the edits are reverted or the file is reloaded', async () => {
    const { s } = make();
    await s.start();
    s.edit((c) => (c.per_user_cooldown = 5));
    s.setFieldError('per_user_cooldown', 'bad');
    s.revert();
    expect(s.canSave).toBe(false);
    expect(s.hasFieldErrors).toBe(false);
  });
});

describe('revert is undoable', () => {
  test('reverting all edits can itself be undone', async () => {
    const { s } = make();
    await s.start();
    s.edit((c) => (c.per_user_cooldown = 5));
    s.edit((c) => (c.global_min_gap = 9));
    s.revert();
    expect(s.dirty).toBe(false);
    expect(s.canUndo).toBe(true);
    s.undo();
    expect(s.current?.per_user_cooldown).toBe(5);
    expect(s.current?.global_min_gap).toBe(9);
    expect(s.dirty).toBe(true);
  });
  test('reverting a clean session adds nothing to the history', async () => {
    const { s } = make();
    await s.start();
    s.revert();
    expect(s.canUndo).toBe(false);
  });
});
