import { defaultConfigText, normalise, parseDoc, render, type Config } from '../../shared/config.ts';
import { mergeConfigs, type Conflict, type MergeNote } from '../../shared/merge.ts';
import { FileWriteError, type BackupInfo, type BackupStore, type FileAccess, type WriteFailure } from './ports.ts';

// This module never logs: config contents (private channel names, links) must not reach any log.

export interface Snapshot {
  /** SHA-256 of the file text; the source of truth for "did it change". */
  hash: string;
  mtimeMs: number;
  size: number;
}

export type LoadResult =
  | { status: 'ok'; snapshot: Snapshot; config: Config; /** false: a save will re-lay-out the file */ exact: boolean }
  | { status: 'missing' }
  | { status: 'invalid'; snapshot: Snapshot; text: string; error: string };

export type SaveResult =
  | { status: 'saved'; snapshot: Snapshot; config: Config; notes: MergeNote[]; merged: boolean; backup: string | null }
  | { status: 'conflict'; conflicts: Conflict[]; theirs: Config; snapshot: Snapshot }
  | { status: 'invalid'; error: string }
  | { status: 'stale-base' }
  /** The file could not be written; `text` is exactly what should have been written (offer it as a download). */
  | { status: 'write-failed'; reason: WriteFailure; text: string };

export type RestoreResult = { status: 'restored'; snapshot: Snapshot; backup: string | null } | { status: 'invalid'; error: string };

export interface StoreOptions {
  file: FileAccess;
  backups: BackupStore;
  now?: () => number;
  keepBackups?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Test-only seam. */
  hooks?: { beforeCommit?: () => Promise<void> };
}

export interface ConfigStore {
  load(): Promise<LoadResult>;
  /** Save `mine` (an edit of the version with hash `baseHash`), merging with whatever is in the file now. */
  save(baseHash: string, mine: Config): Promise<SaveResult>;
  /** Cheap check for "did the file change": modified time and size, or null when it is gone. */
  peek(): Promise<{ modified: number; size: number } | null>;
  listBackups(): Promise<BackupInfo[]>;
  /** Put a backup back as the config. Live state (master switch, timer state) stays as it is in the file now. */
  restore(backupId: string): Promise<RestoreResult>;
  /** Create the plugin's default config; never overwrites. */
  createDefault(): Promise<{ status: 'created'; snapshot: Snapshot } | { status: 'exists' }>;
}

const BACKOFF_MS = [25, 50, 100, 200, 400, 800];
const MAX_COMMIT_ATTEMPTS = 3;
const KEEP_BASES = 20;

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createConfigStore(opts: StoreOptions): ConfigStore {
  const { file, backups } = opts;
  const now = opts.now ?? Date.now;
  const keep = opts.keepBackups ?? 20;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // Texts the UI has loaded, by hash: the "base" of a three-way merge. Oldest are dropped first.
  const bases = new Map<string, string>();
  const remember = (hash: string, text: string) => {
    bases.delete(hash);
    bases.set(hash, text);
    while (bases.size > KEEP_BASES) bases.delete(bases.keys().next().value as string);
  };

  const snapshotOf = async (text: string, modified: number, size: number): Promise<Snapshot> => ({ hash: await sha256(text), mtimeMs: modified, size });

  async function readSnapshot(): Promise<{ text: string; snapshot: Snapshot } | null> {
    const r = await file.read();
    return r ? { text: r.text, snapshot: await snapshotOf(r.text, r.modified, r.size) } : null;
  }

  /** Back up, ignoring failures: a full or blocked backup store must not stop the user from saving. */
  async function backup(text: string): Promise<string | null> {
    try {
      const id = await backups.add(text, now());
      await backups.prune(keep);
      return id;
    } catch {
      return null;
    }
  }

  /** Write with a few retries for a busy file. Returns the failure instead of throwing. */
  async function writeWithRetry(text: string): Promise<{ ok: true } | { ok: false; reason: WriteFailure }> {
    for (let i = 0; ; i++) {
      try {
        await file.write(text);
        return { ok: true };
      } catch (e) {
        const reason = e instanceof FileWriteError ? e.reason : 'other';
        if (reason !== 'busy' || i >= BACKOFF_MS.length) return { ok: false, reason };
        await sleep(BACKOFF_MS[i]!);
      }
    }
  }

  async function load(): Promise<LoadResult> {
    const cur = await readSnapshot();
    if (!cur) return { status: 'missing' };
    const parsed = parseDoc(cur.text);
    if (!parsed.ok) return { status: 'invalid', snapshot: cur.snapshot, text: cur.text, error: parsed.error };
    remember(cur.snapshot.hash, cur.text);
    return { status: 'ok', snapshot: cur.snapshot, config: normalise(parsed.doc.base), exact: parsed.doc.exact };
  }

  async function save(baseHash: string, mine: Config): Promise<SaveResult> {
    let base = baseHash;
    let edit = mine;
    let mergedBefore = false;
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
      const cur = await readSnapshot();
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
        if (!m.ok) {
          remember(cur.snapshot.hash, cur.text); // the UI will re-save against this version after the user's choices
          return { status: 'conflict', conflicts: m.conflicts, theirs: m.theirs, snapshot: cur.snapshot };
        }
        result = m.config;
        notes = m.notes;
      }

      const text = render(parsed.doc, result);
      await opts.hooks?.beforeCommit?.();
      // Last check right before the write: if the plugin saved in the meantime, merge again against what we read.
      const again = await file.read();
      if (again?.text !== cur.text) {
        remember(cur.snapshot.hash, cur.text);
        base = cur.snapshot.hash;
        edit = result;
        mergedBefore = true;
        continue;
      }
      const backupId = await backup(cur.text);
      const written = await writeWithRetry(text);
      if (!written.ok) return { status: 'write-failed', reason: written.reason, text };
      const after = await readSnapshot();
      const snapshot = after?.snapshot ?? (await snapshotOf(text, now(), new TextEncoder().encode(text).length));
      remember(snapshot.hash, text);
      return { status: 'saved', snapshot, config: normalise(JSON.parse(text) as Record<string, unknown>), notes, merged, backup: backupId };
    }
    // The file kept changing underneath us: do not fight the plugin, ask the UI to reload.
    return { status: 'stale-base' };
  }

  async function restore(backupId: string): Promise<RestoreResult> {
    const backupText = await backups.get(backupId);
    if (backupText === null) throw new Error('unknown backup');
    const picked = parseDoc(backupText);
    if (!picked.ok) return { status: 'invalid', error: picked.error };
    const cur = await readSnapshot();
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
    const name = cur ? await backup(cur.text) : null;
    const written = await writeWithRetry(text);
    if (!written.ok) throw new FileWriteError(written.reason, 'could not write the restored file');
    const after = await readSnapshot();
    const snapshot = after?.snapshot ?? (await snapshotOf(text, now(), new TextEncoder().encode(text).length));
    remember(snapshot.hash, text);
    return { status: 'restored', snapshot, backup: name };
  }

  async function createDefault() {
    if (await file.stat()) return { status: 'exists' as const };
    const text = defaultConfigText();
    const written = await writeWithRetry(text);
    if (!written.ok) throw new FileWriteError(written.reason, 'could not create the file');
    const after = await readSnapshot();
    const snapshot = after?.snapshot ?? (await snapshotOf(text, now(), new TextEncoder().encode(text).length));
    remember(snapshot.hash, text);
    return { status: 'created' as const, snapshot };
  }

  return { load, save, peek: () => file.stat(), listBackups: () => backups.list(), restore, createDefault };
}
