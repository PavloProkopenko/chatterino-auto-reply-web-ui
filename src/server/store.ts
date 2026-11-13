import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { defaultConfigText, normalise, parseDoc, render, type Config } from '../shared/config.ts';
import { mergeConfigs, type Conflict, type MergeNote } from '../shared/merge.ts';

// This module never logs: config contents (private channel names, links) must not reach any log.

export interface Snapshot {
  /** SHA-256 of the file text; the source of truth for "did it change". */
  hash: string;
  mtimeMs: number;
  size: number;
}

export type LoadResult =
  | { status: 'ok'; snapshot: Snapshot; text: string; config: Config; /** false: a save will reformat the file */ exact: boolean }
  | { status: 'missing' }
  | { status: 'invalid'; snapshot: Snapshot; text: string; error: string };

export type SaveResult =
  | { status: 'saved'; snapshot: Snapshot; config: Config; notes: MergeNote[]; merged: boolean; backup: string | null }
  | { status: 'conflict'; conflicts: Conflict[]; theirs: Config; snapshot: Snapshot }
  | { status: 'invalid'; error: string }
  | { status: 'stale-base' };

export interface BackupInfo {
  name: string;
  mtimeMs: number;
  size: number;
}

export interface StoreOptions {
  now?: () => number;
  keepBackups?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Replace-by-rename; injectable so Windows sharing violations can be simulated. */
  renameFile?: (from: string, to: string) => Promise<void>;
  /** Test-only seams. */
  hooks?: { beforeCommit?: () => Promise<void> };
}

export interface Store {
  load(path: string): Promise<LoadResult>;
  /** Save `mine` (an edit of the version with hash `baseHash`), merging with whatever is on disk now. */
  save(path: string, baseHash: string, mine: Config): Promise<SaveResult>;
  listBackups(path: string): Promise<BackupInfo[]>;
  /** Put a backup back as the config. Live state (master switch, timer state) stays as it is on disk. */
  restore(path: string, backupName: string): Promise<{ status: 'restored'; snapshot: Snapshot; backup: string } | { status: 'invalid'; error: string }>;
  /** Create the plugin's default config; never overwrites. */
  createDefault(path: string): Promise<{ status: 'created'; snapshot: Snapshot } | { status: 'exists' }>;
}

const CONFIG_NAME = 'config.json';
const BACKUP_PREFIX = `${CONFIG_NAME}.bak-`;
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const BACKOFF_MS = [25, 50, 100, 200, 400, 800];
const MAX_COMMIT_ATTEMPTS = 3;
const KEEP_BASES = 20;

const BACKUP_NAME = /^config\.json\.bak-[0-9TZ]+-[0-9]{3}$/;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function assertConfigPath(path: string): void {
  if (basename(path) !== CONFIG_NAME) throw new Error(`refusing to touch "${basename(path)}": only a file named ${CONFIG_NAME} is allowed`);
}

async function readText(path: string): Promise<{ text: string; snapshot: Snapshot } | null> {
  try {
    const [text, st] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { text, snapshot: { hash: sha256(text), mtimeMs: st.mtimeMs, size: st.size } };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export function createStore(opts: StoreOptions = {}): Store {
  const now = opts.now ?? Date.now;
  const keep = opts.keepBackups ?? 20;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const renameFile = opts.renameFile ?? rename;
  // Texts the UI has loaded, by hash: the "base" of a three-way merge. Oldest are dropped first.
  const bases = new Map<string, string>();
  const remember = (hash: string, text: string) => {
    bases.delete(hash);
    bases.set(hash, text);
    while (bases.size > KEEP_BASES) bases.delete(bases.keys().next().value as string);
  };
  let backupSeq = 0;

  async function renameWithRetry(from: string, to: string): Promise<void> {
    for (let i = 0; ; i++) {
      try {
        return await renameFile(from, to);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (!code || !RETRYABLE.has(code) || i >= BACKOFF_MS.length) throw e;
        await sleep(BACKOFF_MS[i]!);
      }
    }
  }

  async function backup(path: string, text: string): Promise<string> {
    const stamp = new Date(now()).toISOString().replace(/[-:]/g, '').replace('.', '');
    const name = `${BACKUP_PREFIX}${stamp}-${String(backupSeq++ % 1000).padStart(3, '0')}`;
    await writeFile(join(dirname(path), name), text, { flag: 'wx' });
    const old = (await readdir(dirname(path))).filter((n) => n.startsWith(BACKUP_PREFIX)).sort().reverse().slice(keep);
    await Promise.all(old.map((n) => unlink(join(dirname(path), n)).catch(() => undefined)));
    return name;
  }

  async function load(path: string): Promise<LoadResult> {
    assertConfigPath(path);
    const cur = await readText(path);
    if (!cur) return { status: 'missing' };
    const parsed = parseDoc(cur.text);
    if (!parsed.ok) return { status: 'invalid', snapshot: cur.snapshot, text: cur.text, error: parsed.error };
    remember(cur.snapshot.hash, cur.text);
    return { status: 'ok', snapshot: cur.snapshot, text: cur.text, config: normalise(parsed.doc.base), exact: parsed.doc.exact };
  }

  async function save(path: string, baseHash: string, mine: Config): Promise<SaveResult> {
    assertConfigPath(path);
    let base = baseHash;
    let edit = mine;
    let mergedBefore = false;
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
      const cur = await readText(path);
      if (!cur) return { status: 'stale-base' }; // the file vanished: the UI must reload and decide
      const parsed = parseDoc(cur.text);
      if (!parsed.ok) return { status: 'invalid', error: parsed.error };

      let result: Config = edit;
      let notes: MergeNote[] = [];
      const merged = mergedBefore || cur.snapshot.hash !== base;
      if (cur.snapshot.hash !== base) {
        const baseText = bases.get(base);
        const baseDoc = baseText === undefined ? null : parseDoc(baseText);
        if (!baseDoc?.ok) return { status: 'stale-base' };
        const m = mergeConfigs(normalise(baseDoc.doc.base), normalise(parsed.doc.base), edit);
        if (!m.ok) return { status: 'conflict', conflicts: m.conflicts, theirs: m.theirs, snapshot: cur.snapshot };
        result = m.config;
        notes = m.notes;
      }

      const text = render(parsed.doc, result);
      const tmp = join(dirname(path), `.${CONFIG_NAME}.tmp-${randomBytes(6).toString('hex')}`);
      try {
        await writeFile(tmp, text, { flag: 'wx' });
        await opts.hooks?.beforeCommit?.();
        // Last check right before the swap: if the plugin saved in the meantime, merge again against what we read.
        const again = await readText(path);
        if (again?.snapshot.hash !== cur.snapshot.hash) {
          remember(cur.snapshot.hash, cur.text);
          base = cur.snapshot.hash;
          edit = result;
          mergedBefore = true;
          continue;
        }
        const backupName = await backup(path, cur.text);
        await renameWithRetry(tmp, path);
        const snap = (await readText(path))!.snapshot;
        remember(snap.hash, text);
        return { status: 'saved', snapshot: snap, config: normalise(JSON.parse(text) as Record<string, unknown>), notes, merged, backup: backupName };
      } finally {
        await unlink(tmp).catch(() => undefined);
      }
    }
    // The file kept changing underneath us: do not fight the plugin, ask the UI to reload.
    return { status: 'stale-base' };
  }

  async function listBackups(path: string): Promise<BackupInfo[]> {
    assertConfigPath(path);
    const names = (await readdir(dirname(path)).catch(() => [] as string[])).filter((n) => BACKUP_NAME.test(n)).sort().reverse();
    return Promise.all(names.map(async (name) => ({ name, ...(await stat(join(dirname(path), name)).then((s) => ({ mtimeMs: s.mtimeMs, size: s.size }))) })));
  }

  async function restore(path: string, backupName: string) {
    assertConfigPath(path);
    if (!BACKUP_NAME.test(backupName)) throw new Error('invalid backup name');
    const picked = parseDoc(await readFile(join(dirname(path), backupName), 'utf8'));
    if (!picked.ok) return { status: 'invalid' as const, error: picked.error };
    const cur = await readText(path);
    const curDoc = cur ? parseDoc(cur.text) : null;
    const restored = normalise(picked.doc.base);
    if (curDoc?.ok) {
      // Live state belongs to the running plugin: take it from the current file, not from the old backup.
      const live = normalise(curDoc.doc.base);
      if ('active_until' in live) restored.active_until = live.active_until;
      else delete restored.active_until;
      for (const t of restored.timers) {
        const now = live.timers.find((x) => x.id === t.id);
        for (const k of ['enabled', 'started_at', 'game_id'] as const) {
          if (now && k in now) (t as Record<string, unknown>)[k] = now[k];
          else if (now) delete (t as Record<string, unknown>)[k];
        }
      }
    }
    const text = curDoc?.ok ? render({ ...picked.doc, style: curDoc.doc.style }, restored) : render(picked.doc, restored);
    const tmp = join(dirname(path), `.${CONFIG_NAME}.tmp-${randomBytes(6).toString('hex')}`);
    try {
      await writeFile(tmp, text, { flag: 'wx' });
      const name = cur ? await backup(path, cur.text) : backupName;
      await renameWithRetry(tmp, path);
      const snapshot = (await readText(path))!.snapshot;
      remember(snapshot.hash, text);
      return { status: 'restored' as const, snapshot, backup: name };
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }

  async function createDefault(path: string) {
    assertConfigPath(path);
    await mkdir(dirname(path), { recursive: true });
    const text = defaultConfigText();
    try {
      await writeFile(path, text, { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { status: 'exists' as const };
      throw e;
    }
    const snapshot = (await readText(path))!.snapshot;
    remember(snapshot.hash, text);
    return { status: 'created' as const, snapshot };
  }

  return { load, save, listBackups, restore, createDefault };
}
