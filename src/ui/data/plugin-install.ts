import { compareVersions } from '../../shared/features.ts';
import type { PluginDir } from './ports.ts';
import { sha256 } from './store.ts';

// Installs and updates the plugin's own files (Lua source + info.json) in a folder the user picked.
// Never touches the config in data/ (only the data/.external and data/.plugin-update markers), .backup/, subfolders such as tests/, or files it does not know.
// Never logs: nothing here needs file contents in a log.

export interface PluginBundle {
  version: string;
  /** Runtime files at the top level of the plugin folder: name -> text and SHA-256 of that text. */
  files: Record<string, { text: string; hash: string }>;
}

export type PluginState =
  /** Empty (or not existing) folder: the plugin can be installed. */
  | 'missing'
  /** Not empty and not this plugin: never written to. */
  | 'foreign'
  | 'current'
  | 'older'
  | 'newer'
  /** Same version, but files differ from the bundled ones (edited by hand). */
  | 'modified';

export interface PluginInspection {
  state: PluginState;
  installedVersion: string | null;
  bundledVersion: string;
  /** For `modified`: the files that differ or are missing. */
  changedFiles: string[];
}

export type InstallResult = { status: 'installed' } | { status: 'refused'; reason: 'foreign' | 'exists' } | { status: 'failed'; message: string };
export type UpdateResult =
  | { status: 'updated'; from: string; backup: string }
  | { status: 'refused'; reason: 'foreign' | 'newer' | 'missing' | 'current' }
  | { status: 'failed'; message: string };
export type RollbackResult =
  | { status: 'rolled-back'; restored: string; backup: string }
  | { status: 'refused'; reason: 'no-backup' }
  | { status: 'failed'; message: string };

export interface PluginBackup {
  name: string;
  version: string | null;
  at: number;
}

const PLUGIN_NAME = 'Auto Reply';
const BACKUP_DIR = '.backup';
const BACKUP_META = 'backup.json';
const MARKER = 'data/.external';
/** The plugin cannot read info.json (its io is limited to data/), so after a code change the site leaves the new version here; the plugin tells the user to restart it while it differs from the running version. */
const UPDATE_MARKER = 'data/.plugin-update';

const isCodeFile = (name: string) => name.endsWith('.lua') || name === 'info.json';

/** Bundled files as they are on disk, in a stable order. */
const bundleNames = (b: PluginBundle) => Object.keys(b.files).sort();

async function installedInfo(dir: PluginDir): Promise<{ name: string; version: string | null } | null> {
  const raw = await dir.read('info.json');
  if (raw === null) return null;
  try {
    const info = JSON.parse(raw) as { name?: unknown; version?: unknown };
    if (info.name !== PLUGIN_NAME) return null;
    return { name: PLUGIN_NAME, version: typeof info.version === 'string' ? info.version : null };
  } catch {
    return null;
  }
}

export async function inspectPlugin(dir: PluginDir, bundle: PluginBundle): Promise<PluginInspection> {
  const base = { bundledVersion: bundle.version, changedFiles: [] as string[] };
  const entries = await dir.list('');
  if (entries === null || entries.length === 0) return { state: 'missing', installedVersion: null, ...base };
  const info = await installedInfo(dir);
  if (!info) return { state: 'foreign', installedVersion: null, ...base };
  // a plugin without a readable version counts as older: updating is the way to repair it
  const cmp = info.version === null ? -1 : compareVersions(info.version, bundle.version);
  if (cmp < 0) return { state: 'older', installedVersion: info.version, ...base };
  if (cmp > 0) return { state: 'newer', installedVersion: info.version, ...base };
  const changed: string[] = [];
  for (const name of bundleNames(bundle)) {
    const text = await dir.read(name);
    if (text === null || (await sha256(text)) !== bundle.files[name]!.hash) changed.push(name);
  }
  return { state: changed.length ? 'modified' : 'current', installedVersion: info.version, bundledVersion: bundle.version, changedFiles: changed };
}

async function writeBundle(dir: PluginDir, bundle: PluginBundle): Promise<void> {
  // info.json last: a half-finished write leaves the old version number, so the site offers the update again
  for (const name of bundleNames(bundle).filter((n) => n !== 'info.json')) await dir.write(name, bundle.files[name]!.text);
  if (bundle.files['info.json']) await dir.write('info.json', bundle.files['info.json'].text);
  if ((await dir.read(MARKER)) === null) await dir.write(MARKER, '');
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function installPlugin(dir: PluginDir, bundle: PluginBundle): Promise<InstallResult> {
  const { state } = await inspectPlugin(dir, bundle);
  if (state === 'foreign') return { status: 'refused', reason: 'foreign' };
  if (state !== 'missing') return { status: 'refused', reason: 'exists' };
  try {
    await writeBundle(dir, bundle);
    return { status: 'installed' };
  } catch (e) {
    return { status: 'failed', message: message(e) };
  }
}

/** Copies the current code files into a new `.backup/<name>/`; returns the folder name. */
async function backupCode(dir: PluginDir, now: () => number): Promise<{ name: string; version: string | null }> {
  const version = (await installedInfo(dir))?.version ?? null;
  const existing = new Set((await dir.list(BACKUP_DIR))?.map((e) => e.name) ?? []);
  const stem = version ?? 'unknown';
  let name = stem;
  for (let n = 2; existing.has(name); n++) name = `${stem}-${n}`;
  const names = ((await dir.list('')) ?? []).filter((e) => e.kind === 'file' && isCodeFile(e.name)).map((e) => e.name);
  for (const file of names) {
    const text = await dir.read(file);
    if (text !== null) await dir.write(`${BACKUP_DIR}/${name}/${file}`, text);
  }
  // meta last: a backup without it is incomplete and is ignored by the list
  await dir.write(`${BACKUP_DIR}/${name}/${BACKUP_META}`, JSON.stringify({ version, at: now() }));
  return { name, version };
}

export async function updatePlugin(dir: PluginDir, bundle: PluginBundle, now: () => number = Date.now): Promise<UpdateResult> {
  const check = await inspectPlugin(dir, bundle);
  if (check.state === 'foreign') return { status: 'refused', reason: 'foreign' };
  if (check.state === 'missing') return { status: 'refused', reason: 'missing' };
  if (check.state === 'newer') return { status: 'refused', reason: 'newer' };
  if (check.state === 'current') return { status: 'refused', reason: 'current' };
  try {
    const backup = await backupCode(dir, now); // a failure here stops before anything is overwritten
    await writeBundle(dir, bundle);
    await dir.write(UPDATE_MARKER, bundle.version);
    return { status: 'updated', from: backup.version ?? 'unknown', backup: backup.name };
  } catch (e) {
    return { status: 'failed', message: message(e) };
  }
}

/** Backups, newest first. */
export async function listPluginBackups(dir: PluginDir): Promise<PluginBackup[]> {
  const out: PluginBackup[] = [];
  for (const e of (await dir.list(BACKUP_DIR)) ?? []) {
    if (e.kind !== 'directory') continue;
    const raw = await dir.read(`${BACKUP_DIR}/${e.name}/${BACKUP_META}`);
    if (raw === null) continue;
    try {
      const meta = JSON.parse(raw) as { version?: unknown; at?: unknown };
      out.push({ name: e.name, version: typeof meta.version === 'string' ? meta.version : null, at: typeof meta.at === 'number' ? meta.at : 0 });
    } catch {
      // unreadable meta: not a usable backup
    }
  }
  return out.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

/** Puts the newest backup's code back. The current code is backed up first, so a rollback can be undone. */
export async function rollbackPlugin(dir: PluginDir, now: () => number = Date.now): Promise<RollbackResult> {
  const [newest] = await listPluginBackups(dir);
  if (!newest) return { status: 'refused', reason: 'no-backup' };
  try {
    const files = ((await dir.list(`${BACKUP_DIR}/${newest.name}`)) ?? []).filter((e) => e.kind === 'file' && isCodeFile(e.name));
    const texts: Record<string, string> = {};
    for (const f of files) texts[f.name] = (await dir.read(`${BACKUP_DIR}/${newest.name}/${f.name}`)) ?? '';
    const current = await backupCode(dir, now);
    for (const name of Object.keys(texts).sort().filter((n) => n !== 'info.json')) await dir.write(name, texts[name]!);
    if (texts['info.json'] !== undefined) await dir.write('info.json', texts['info.json']);
    const restored = newest.version;
    if (restored) await dir.write(UPDATE_MARKER, restored);
    return { status: 'rolled-back', restored: newest.version ?? newest.name, backup: current.name };
  } catch (e) {
    return { status: 'failed', message: message(e) };
  }
}
