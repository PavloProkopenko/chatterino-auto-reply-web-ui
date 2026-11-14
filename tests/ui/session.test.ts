import { describe, expect, test } from 'vitest';
import { FileWriteError } from '../../src/ui/data/ports.ts';
import { Session } from '../../src/ui/state/session.svelte.ts';
import { fixtureText, makeSource, makeWorkspace, PermissionNeededError } from './fakes.ts';

let t = 0;
async function ready(over: Parameters<typeof makeSource>[0] = {}) {
  const fs = makeSource(over);
  const w = makeWorkspace(fs.source);
  const s = new Session({ workspace: w.ws, now: () => t });
  await s.start();
  return { s, fs, w };
}
const pluginSaves = (fs: ReturnType<typeof makeSource>, mutate: (c: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = JSON.parse(fs.file.text!);
  mutate(c);
  fs.file.pluginSaves(JSON.stringify(c, null, 2) + '\n');
};

describe('starting', () => {
  test('a remembered source loads and is clean', async () => {
    const { s } = await ready();
    expect(s.phase).toBe('ready');
    expect(s.dirty).toBe(false);
    expect(s.current?.channels).toEqual(['a']);
    expect(s.source).toMatchObject({ kind: 'folder', name: 'auto-reply', pluginVersion: '0.5.0', canSaveInPlace: true });
  });

  test('nothing remembered: the welcome screen', async () => {
    const w = makeWorkspace();
    const s = new Session({ workspace: w.ws });
    await s.start();
    expect(s.phase).toBe('welcome');
  });

  test('a remembered source with a lapsed permission waits for one click, which then opens it', async () => {
    const fs = makeSource();
    const w = makeWorkspace();
    w.answers.start = { status: 'needs-permission', name: 'auto-reply', kind: 'folder' };
    w.answers.grant = { status: 'ready', source: fs.source };
    const s = new Session({ workspace: w.ws });
    await s.start();
    expect(s.phase).toBe('needs-permission');
    expect(s.remembered).toEqual({ name: 'auto-reply', kind: 'folder' });
    await s.grantAccess();
    expect(s.phase).toBe('ready');
  });

  test('a refused re-grant goes back to the welcome screen', async () => {
    const w = makeWorkspace();
    w.answers.start = { status: 'needs-permission', name: 'auto-reply', kind: 'folder' };
    w.answers.grant = { status: 'denied' };
    const s = new Session({ workspace: w.ws });
    await s.start();
    await s.grantAccess();
    expect(s.phase).toBe('welcome');
  });

  test('losing permission in the middle of a session shows the permission screen; one click brings it back', async () => {
    const { s, fs } = await ready();
    let revoked = true;
    const real = fs.source.store.load;
    fs.override({ load: async () => { if (revoked) throw new PermissionNeededError(); return real(); } });
    await s.reloadFromDisk();
    expect(s.phase).toBe('needs-permission');
    revoked = false;
    await s.grantAccess();
    expect(s.phase).toBe('ready');
  });
});

describe('picking', () => {
  test('a good pick opens the source', async () => {
    const fs = makeSource();
    const w = makeWorkspace(fs.source);
    w.answers.start = { status: 'none' };
    const s = new Session({ workspace: w.ws });
    await s.start();
    await s.pickFolder();
    expect(s.phase).toBe('ready');
    expect(w.calls.folder).toBe(1);
  });

  test.each(['blocked', 'bad-selection'] as const)('%s stays on the welcome screen with the reason', async (status) => {
    const w = makeWorkspace();
    w.answers.pick = { status };
    const s = new Session({ workspace: w.ws });
    await s.start();
    await s.pickFolder();
    expect(s.phase).toBe('welcome');
    expect(s.pickProblem).toBe(status);
  });

  test('a folder that is not the plugin says which folder it was', async () => {
    const w = makeWorkspace();
    w.answers.pick = { status: 'not-plugin', name: 'Documents' };
    const s = new Session({ workspace: w.ws });
    await s.start();
    await s.pickFolder();
    expect(s.pickProblem).toBe('not-plugin');
    expect(s.pickedName).toBe('Documents');
  });

  test('closing the dialog changes nothing', async () => {
    const w = makeWorkspace();
    const s = new Session({ workspace: w.ws });
    await s.start();
    await s.pickFile();
    expect(s.phase).toBe('welcome');
    expect(s.pickProblem).toBeNull();
  });

  test('demo mode opens an in-memory sample that cannot save in place', async () => {
    const w = makeWorkspace();
    const s = new Session({ workspace: w.ws });
    await s.start();
    await s.startDemo();
    expect(s.phase).toBe('ready');
    expect(s.source?.kind).toBe('demo');
    expect(s.source?.canSaveInPlace).toBe(false);
  });

  test('leaving forgets the choice and returns to the welcome screen', async () => {
    const { s, w } = await ready();
    await s.leave();
    expect(s.phase).toBe('welcome');
    expect(s.current).toBeNull();
    expect(w.calls.forget).toBe(1);
  });
});

describe('missing and invalid files', () => {
  test('a missing file offers to create the default; creating loads it', async () => {
    const { s, fs } = await ready({ text: null });
    expect(s.phase).toBe('missing');
    await s.createDefault();
    expect(s.phase).toBe('ready');
    expect(JSON.parse(fs.file.text!)).toMatchObject({ version: 1, per_user_cooldown: 60 });
  });

  test('an invalid file is a read-only view with the error text; edits and saves do nothing', async () => {
    const { s, fs } = await ready({ text: '{half' });
    expect(s.phase).toBe('invalid');
    expect(s.invalid?.text).toBe('{half');
    s.edit((c) => (c.global_min_gap = 9));
    await s.save();
    expect(fs.file.writes).toBe(0);
  });
});

describe('editing, undo, redo, revert', () => {
  test('edit makes it dirty; revert restores the saved state', async () => {
    const { s } = await ready();
    s.edit((c) => (c.per_user_cooldown = 5));
    expect(s.dirty).toBe(true);
    expect(s.canLeave).toBe(false);
    s.revert();
    expect(s.dirty).toBe(false);
    expect(s.current?.per_user_cooldown).toBe(60);
  });

  test('undo and redo walk the history; a new edit drops the redo branch', async () => {
    const { s } = await ready();
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
    const { s } = await ready();
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

  test('reverting all edits can itself be undone; reverting a clean session adds nothing', async () => {
    const { s } = await ready();
    s.revert();
    expect(s.canUndo).toBe(false);
    s.edit((c) => (c.per_user_cooldown = 5));
    s.edit((c) => (c.global_min_gap = 9));
    s.revert();
    expect(s.dirty).toBe(false);
    s.undo();
    expect(s.current?.per_user_cooldown).toBe(5);
    expect(s.current?.global_min_gap).toBe(9);
  });
});

describe('saving', () => {
  test('writes the edit through the store, then is clean and asks for /autoreply reload', async () => {
    const { s, fs } = await ready();
    s.edit((c) => (c.per_user_cooldown = 5));
    await s.save();
    expect(JSON.parse(fs.file.text!).per_user_cooldown).toBe(5);
    expect(s.dirty).toBe(false);
    expect(s.needsReload).toBe(true);
    expect(s.canUndo).toBe(false);
    s.dismissReload();
    expect(s.needsReload).toBe(false);
  });

  test('a second save builds on the first (no stale base)', async () => {
    const { s, fs } = await ready();
    s.edit((c) => (c.per_user_cooldown = 5));
    await s.save();
    s.edit((c) => (c.per_user_cooldown = 6));
    await s.save();
    expect(JSON.parse(fs.file.text!).per_user_cooldown).toBe(6);
    expect(s.staleBase).toBe(false);
  });

  test('the plugin saved meanwhile in another field: merged, and the summary says so', async () => {
    const { s, fs } = await ready();
    s.edit((c) => (c.per_user_cooldown = 5));
    pluginSaves(fs, (c) => { c.timers[0].enabled = true; c.timers[0].started_at = 1700000000; });
    await s.save();
    const disk = JSON.parse(fs.file.text!);
    expect(disk.per_user_cooldown).toBe(5);
    expect(disk.timers[0]).toMatchObject({ enabled: true, started_at: 1700000000 });
    expect(s.lastSave?.merged).toBe(true);
  });

  test('saving with nothing changed does not touch the file', async () => {
    const { s, fs } = await ready();
    await s.save();
    expect(fs.file.writes).toBe(0);
  });

  test('stale-base keeps the edits and asks the user to reload', async () => {
    const { s, fs } = await ready();
    fs.override({ save: async () => ({ status: 'stale-base' }) });
    s.edit((c) => (c.per_user_cooldown = 5));
    await s.save();
    expect(s.staleBase).toBe(true);
    expect(s.dirty).toBe(true);
  });

  test('an unexpected failure is reported and edits are kept', async () => {
    const { s, fs } = await ready();
    fs.override({ save: async () => Promise.reject(new Error('boom')) });
    s.edit((c) => (c.per_user_cooldown = 5));
    await s.save();
    expect(s.error).toBe('boom');
    expect(s.dirty).toBe(true);
    expect(s.saving).toBe(false);
  });

  test('a file that cannot be written keeps the edits and offers the exact text as a download', async () => {
    const { s, fs, w } = await ready();
    fs.file.failWith = () => new FileWriteError('busy', 'locked');
    s.edit((c) => (c.per_user_cooldown = 5));
    await s.save();
    expect(s.dirty).toBe(true);
    expect(s.writeFailed?.reason).toBe('busy');
    expect(s.needsReload).toBe(false);
    s.downloadFailed();
    expect(w.calls.downloads).toHaveLength(1);
    expect(JSON.parse(w.calls.downloads[0]!.text).per_user_cooldown).toBe(5);
    // fixing the cause and saving again works and clears the notice
    fs.file.failWith = null;
    await s.save();
    expect(s.writeFailed).toBeNull();
    expect(JSON.parse(fs.file.text!).per_user_cooldown).toBe(5);
  });
});

describe('field errors block saving', () => {
  test('a field with an error disables saving until it is fixed', async () => {
    const { s, fs } = await ready();
    s.edit((c) => (c.per_user_cooldown = 5));
    expect(s.canSave).toBe(true);
    s.setFieldError('per_rule_cooldown', 'Введите число');
    expect(s.canSave).toBe(false);
    await s.save();
    expect(fs.file.writes).toBe(0);
    s.setFieldError('per_rule_cooldown', null);
    await s.save();
    expect(fs.file.writes).toBe(1);
  });

  test('errors are cleared when the edits are reverted', async () => {
    const { s } = await ready();
    s.edit((c) => (c.per_user_cooldown = 5));
    s.setFieldError('per_user_cooldown', 'bad');
    s.revert();
    expect(s.hasFieldErrors).toBe(false);
  });
});

describe('conflicts (the plugin changed what the user changed)', () => {
  async function conflicted() {
    const r = await ready();
    r.s.edit((c) => (c.rules[1]!.reply = 'я'));
    pluginSaves(r.fs, (c) => {
      c.rules[1].reply = 'плагин';
      c.timers[0].enabled = true;
      c.timers[0].started_at = 1700000000;
    });
    await r.s.save();
    return r;
  }

  test('a conflict opens the dialog and changes nothing', async () => {
    const { s, fs } = await conflicted();
    expect(s.conflict?.conflicts[0]!.path).toBe('rules[2].reply');
    expect(s.dirty).toBe(true);
    expect(s.current?.rules[1]!.reply).toBe('я');
    expect(fs.file.writes).toBe(0);
  });

  test("choosing 'mine' saves my value and keeps the plugin's live state", async () => {
    const { s, fs } = await conflicted();
    await s.resolveConflicts({ 'rules[2].reply': 'mine' });
    const disk = JSON.parse(fs.file.text!);
    expect(disk.rules[1].reply).toBe('я');
    expect(disk.timers[0]).toMatchObject({ enabled: true, started_at: 1700000000 });
    expect(s.conflict).toBeNull();
    expect(s.dirty).toBe(false);
  });

  test("choosing 'theirs' keeps the plugin's value", async () => {
    const { s } = await conflicted();
    await s.resolveConflicts({ 'rules[2].reply': 'theirs' });
    expect(s.current?.rules[1]!.reply).toBe('плагин');
  });

  test('an unresolved conflict keeps the dialog open and writes nothing', async () => {
    const { s, fs } = await conflicted();
    await s.resolveConflicts({});
    expect(s.conflict).not.toBeNull();
    expect(fs.file.writes).toBe(0);
  });

  test("cancelling the dialog keeps the user's edits", async () => {
    const { s } = await conflicted();
    s.cancelConflict();
    expect(s.conflict).toBeNull();
    expect(s.current?.rules[1]!.reply).toBe('я');
  });
});

describe('noticing what the plugin saved', () => {
  test('a clean session silently picks it up', async () => {
    const { s, fs } = await ready();
    pluginSaves(fs, (c) => (c.per_user_cooldown = 30));
    await s.refreshIfChanged();
    expect(s.current?.per_user_cooldown).toBe(30);
    expect(s.externalChange).toBe(false);
  });

  test('a dirty session is told, and keeps its edits (the save will merge)', async () => {
    const { s, fs } = await ready();
    s.edit((c) => (c.global_min_gap = 9));
    pluginSaves(fs, (c) => (c.per_user_cooldown = 30));
    await s.refreshIfChanged();
    expect(s.externalChange).toBe(true);
    expect(s.current?.global_min_gap).toBe(9);
  });

  test('an unchanged file is not even read (a cheap check first)', async () => {
    const { s, fs } = await ready();
    let loads = 0;
    const real = fs.source.store.load;
    fs.override({ load: async () => (loads++, real()) });
    await s.refreshIfChanged();
    await s.refreshIfChanged();
    expect(loads).toBe(0);
  });

  test('a file that vanishes or breaks switches to the matching screen', async () => {
    const a = await ready();
    a.fs.file.text = null;
    await a.s.refreshIfChanged();
    expect(a.s.phase).toBe('missing');
    const b = await ready();
    b.fs.file.pluginSaves('{broken');
    await b.s.refreshIfChanged();
    expect(b.s.phase).toBe('invalid');
  });

  test('reloadFromDisk discards the edits', async () => {
    const { s } = await ready();
    s.edit((c) => (c.global_min_gap = 9));
    await s.reloadFromDisk();
    expect(s.dirty).toBe(false);
    expect(s.staleBase).toBe(false);
  });
});

describe('history', () => {
  test('lists backups and restoring reloads the file, drops unsaved edits and asks for /autoreply reload', async () => {
    const { s, fs } = await ready();
    s.edit((c) => (c.per_user_cooldown = 5));
    await s.save();
    s.dismissReload();
    s.edit((c) => (c.global_min_gap = 9));
    const backups = await s.listBackups();
    expect(backups).toHaveLength(1);
    await s.restore(backups[0]!.id);
    expect(s.dirty).toBe(false);
    expect(s.needsReload).toBe(true);
    expect(JSON.parse(fs.file.text!).per_user_cooldown).toBeUndefined(); // back to the original: the default was never written
    expect(s.current?.per_user_cooldown).toBe(60);
  });
});

describe('plugin version and gating', () => {
  test('features follow the plugin version; unknown without info.json', async () => {
    const old = await ready({ version: '0.4.0' });
    expect(old.s.source?.features).toMatchObject({ skipUsers: false, timerConditions: true });
    const unknown = await ready({ kind: 'file', version: null });
    expect(unknown.s.source?.features.versionKnown).toBe(false);
  });
});

test('the fixture used here matches the shape the other suites use', () => {
  expect(JSON.parse(fixtureText()).version).toBe(1);
});

describe('download mode: re-open the current file before every download', () => {
  const upload = () => ready({ kind: 'upload', canSaveInPlace: false });
  const fileOf = (text: string) => new File([text], 'config.json');

  test('saving first asks for the current file and downloads nothing', async () => {
    const { s, fs } = await upload();
    s.edit((c) => void (c.per_user_cooldown = 5));
    await s.save();
    expect(s.askFreshFile).toBe(true);
    expect(fs.file.writes).toBe(0);
    expect(s.needsReload).toBe(false);
    s.cancelFreshFile();
    expect(s.askFreshFile).toBe(false);
    expect(s.dirty).toBe(true); // the edits are still there
  });

  test('live state and the plugin\'s own changes come from the fresh file, the user\'s edits on top', async () => {
    const { s, fs } = await upload();
    s.edit((c) => void (c.per_user_cooldown = 5));
    const fresh = JSON.parse(fs.file.text!);
    fresh.active_until = 'session';
    fresh.timers[0].enabled = true;
    fresh.channels = ['a', 'b'];
    await s.save();
    await s.saveWithFile(fileOf(JSON.stringify(fresh, null, 2) + '\n'));
    expect(s.askFreshFile).toBe(false);
    expect(fs.file.writes).toBe(1);
    const out = JSON.parse(fs.file.text!);
    expect(out.per_user_cooldown).toBe(5);
    expect(out.active_until).toBe('session');
    expect(out.timers[0].enabled).toBe(true);
    expect(out.channels).toEqual(['a', 'b']);
    expect(s.needsReload).toBe(true);
    expect(s.lastSave?.merged).toBe(true);
  });

  test('a file that cannot be read keeps the dialog open with a reason and downloads nothing', async () => {
    const { s, fs } = await upload();
    s.edit((c) => void (c.per_user_cooldown = 5));
    await s.save();
    await s.saveWithFile(fileOf('{nope'));
    expect(s.askFreshFile).toBe(true);
    expect(s.freshProblem).toBe('unreadable');
    expect(fs.file.writes).toBe(0);
  });

  test('every download needs its own re-open', async () => {
    const { s, fs } = await upload();
    s.edit((c) => void (c.per_user_cooldown = 5));
    await s.save();
    await s.saveWithFile(fileOf(fs.file.text!));
    expect(fs.file.writes).toBe(1);
    s.edit((c) => void (c.per_user_cooldown = 6));
    await s.save();
    expect(s.askFreshFile).toBe(true);
    expect(fs.file.writes).toBe(1);
  });

  test('a conflict with the fresh file goes through the usual choices, then downloads', async () => {
    const { s, fs } = await upload();
    s.edit((c) => void (c.per_user_cooldown = 5));
    const fresh = JSON.parse(fs.file.text!);
    fresh.per_user_cooldown = 99;
    await s.save();
    await s.saveWithFile(fileOf(JSON.stringify(fresh, null, 2) + '\n'));
    expect(s.conflict).not.toBeNull();
    expect(fs.file.writes).toBe(0);
    const key = s.conflict!.conflicts[0]!.path;
    await s.resolveConflicts({ [key]: 'mine' });
    expect(fs.file.writes).toBe(1);
    expect(JSON.parse(fs.file.text!).per_user_cooldown).toBe(5);
  });

  test('the sample and in-place sources save at once, without asking', async () => {
    for (const o of [{ kind: 'demo', canSaveInPlace: false }, { kind: 'folder' }] as const) {
      const { s } = await ready(o);
      s.edit((c) => void (c.per_user_cooldown = 5));
      await s.save();
      expect(s.askFreshFile).toBe(false);
      expect(s.needsReload).toBe(true);
    }
  });
});

describe('info.json opened after config.json', () => {
  const infoFile = (name: string, version = '0.5.0') => new File([JSON.stringify({ name, version })], 'info.json');

  test('the version becomes known and the settings it allows turn on', async () => {
    const { s } = await ready({ kind: 'upload', canSaveInPlace: false, version: null });
    expect(s.source?.features.versionKnown).toBe(false);
    await s.openInfo(infoFile('Auto Reply'));
    expect(s.source).toMatchObject({ pluginVersion: '0.5.0' });
    expect(s.source?.features.versionKnown).toBe(true);
    expect(s.infoProblem).toBeNull();
  });

  test('a wrong file is explained and the version stays unknown', async () => {
    const { s } = await ready({ kind: 'upload', canSaveInPlace: false, version: null });
    await s.openInfo(infoFile('Something Else'));
    expect(s.infoProblem).toBe('not-plugin');
    expect(s.source?.features.versionKnown).toBe(false);
    await s.openInfo(infoFile('Auto Reply'));
    expect(s.infoProblem).toBeNull();
  });

  test('edits made before are kept', async () => {
    const { s } = await ready({ kind: 'upload', canSaveInPlace: false, version: null });
    s.edit((c) => void (c.per_user_cooldown = 5));
    await s.openInfo(infoFile('Auto Reply'));
    expect(s.current?.per_user_cooldown).toBe(5);
    expect(s.dirty).toBe(true);
  });
});
