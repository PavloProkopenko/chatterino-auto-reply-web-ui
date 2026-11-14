import { demoConfigText } from '../../shared/demo.ts';
import { featuresFor, type Features } from '../../shared/features.ts';
import { InMemoryBackups } from './backups.ts';
import { BlockedPickError, directAccessSupported, fileConfigAccess, folderConfigAccess, permissionOf, pickConfigFile, pickFolder, readPluginInfo } from './fs-access.ts';
import type { Persistence, RememberedSource } from './persistence.ts';
import type { FileAccess, FileRead } from './ports.ts';
import { createConfigStore, type ConfigStore } from './store.ts';

export type SourceKind = 'folder' | 'file' | 'upload' | 'demo';

/** An opened place for the config: what the editing session works on. */
export interface SourceInfo {
  kind: SourceKind;
  /** Folder or file name for display (the browser never reveals a full path). */
  name: string;
  pluginVersion: string | null;
  features: Features;
  /** True when saving writes the user's file; false when saving hands them a download to put in place. */
  canSaveInPlace: boolean;
  /** Saving hands out a download: the user must open the current file again first, so live state is never taken from a stale copy. */
  needsFreshFile: boolean;
  /** Name of the plugin folder when it is known (used in the "put the file back" command). */
  folderName: string | null;
}
export type ReplaceResult = { status: 'replaced' } | { status: 'unreadable' };
export type InfoResult = { status: 'applied' } | { status: 'not-plugin' } | { status: 'unreadable' };
export interface Source extends SourceInfo {
  store: ConfigStore;
  /** Download-mode sources only: swap in a newer copy of config.json the user opened again. */
  replaceFile?(file: File): Promise<ReplaceResult>;
  /** Download-mode sources only: the plugin's info.json, opened as a second file, tells the version (and so the allowed settings). */
  applyInfo?(file: File): Promise<InfoResult>;
  /** Ask the browser again for permission to this source (needs a user gesture). True when granted. */
  reauthorize(): Promise<boolean>;
}

export type PickResult =
  | { status: 'picked'; source: Source }
  | { status: 'cancelled' }
  /** The browser refuses this location (system folder). */
  | { status: 'blocked' }
  /** A folder without the Auto Reply plugin's info.json. */
  | { status: 'not-plugin'; name: string }
  /** A file that is not named config.json, or files that contain neither config.json nor info.json. */
  | { status: 'bad-selection' };

export type StartResult =
  | { status: 'none' }
  | { status: 'ready'; source: Source }
  /** A remembered folder or file whose permission lapsed: one click re-grants it. */
  | { status: 'needs-permission'; name: string; kind: 'folder' | 'file' };

export interface Workspace {
  /** The browser can keep access to a folder or file (Chrome, Edge). Otherwise only open/download and demo work. */
  readonly directAccess: boolean;
  /** Choices and backups survive a reload (false in private windows). */
  persistent(): boolean;
  /** Reopen what was chosen last time, if anything. */
  start(): Promise<StartResult>;
  pickFolder(): Promise<PickResult>;
  pickFile(): Promise<PickResult>;
  /** Fallback for browsers without direct access: files from an `<input>` (a folder or just config.json). */
  openFiles(files: File[]): Promise<PickResult>;
  startDemo(): Source;
  /** Ask the browser again for permission to the remembered source (needs a user gesture). */
  grant(): Promise<{ status: 'ready'; source: Source } | { status: 'denied' }>;
  /** Forget the remembered source and its backups. */
  forget(): Promise<void>;
  /** Hand the user a file to save. */
  download(filename: string, text: string): void;
}

export interface WorkspaceDeps {
  persistence: Persistence;
  download: (filename: string, text: string) => void;
  /** Override the capability check (tests). */
  directAccess?: boolean;
  /** Override the pickers (tests); default: the browser's. */
  pickers?: Parameters<typeof pickFolder>[0];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const PLUGIN_NAME = 'Auto Reply';
const KEEP = 20;

/** A file that lives in memory; saving also hands the user a download. Used for upload and demo sources. */
class DownloadingFile implements FileAccess {
  #text: string | null;
  #modified: number;
  #download: (text: string) => void;
  constructor(text: string | null, modified: number, download: (text: string) => void) {
    this.#text = text;
    this.#modified = modified;
    this.#download = download;
  }
  async read(): Promise<FileRead | null> {
    return this.#text === null ? null : { text: this.#text, modified: this.#modified, size: new TextEncoder().encode(this.#text).length };
  }
  async stat() {
    return this.#text === null ? null : { modified: this.#modified, size: new TextEncoder().encode(this.#text).length };
  }
  async write(text: string) {
    this.#text = text;
    this.#modified += 1;
    this.#download(text);
  }
  /** A newer copy of the file the user opened again. */
  replace(text: string, modified: number) {
    this.#text = text;
    this.#modified = modified;
  }
}

export function createWorkspace(deps: WorkspaceDeps): Workspace {
  const { persistence } = deps;
  const now = deps.now ?? Date.now;
  const directAccess = deps.directAccess ?? directAccessSupported();
  let pending: RememberedSource | null = null;
  const storeOpts = { now, ...(deps.sleep ? { sleep: deps.sleep } : {}), keepBackups: KEEP };

  async function folderSource(handle: FileSystemDirectoryHandle, id: string): Promise<Source | { notPlugin: string }> {
    const info = await readPluginInfo(handle);
    if (!info || info.name !== PLUGIN_NAME) return { notPlugin: handle.name };
    const store = createConfigStore({ file: folderConfigAccess(handle), backups: persistence.backups(id), ...storeOpts });
    return { kind: 'folder', name: handle.name, pluginVersion: info.version, features: featuresFor(info.version), canSaveInPlace: true, needsFreshFile: false, folderName: handle.name, store, reauthorize: async () => (await permissionOf(handle, true)) === 'granted' };
  }
  function fileSource(handle: FileSystemFileHandle, id: string): Source {
    const store = createConfigStore({ file: fileConfigAccess(handle), backups: persistence.backups(id), ...storeOpts });
    // Without the plugin folder there is no info.json: the plugin version, and so the feature gates, are unknown.
    return { kind: 'file', name: handle.name, pluginVersion: null, features: featuresFor(null), canSaveInPlace: true, needsFreshFile: false, folderName: null, store, reauthorize: async () => (await permissionOf(handle, true)) === 'granted' };
  }

  async function remember(entry: RememberedSource): Promise<void> {
    try {
      await persistence.forget(); // drops the previous choice and its backups
      await persistence.saveSource(entry);
    } catch {
      /* storage refused: it works for this visit, it just will not be remembered */
    }
  }

  const download = (name: string, text: string) => deps.download(name, text);
  const memorySource = (kind: 'upload' | 'demo', name: string, text: string | null, modified: number, info: { version: string | null; folder?: string | null }): Source => {
    const file = new DownloadingFile(text, modified, (t) => download('config.json', t));
    const store = createConfigStore({ file, backups: new InMemoryBackups(), ...storeOpts });
    const source: Source = { kind, name, pluginVersion: info.version, features: featuresFor(info.version), canSaveInPlace: false, needsFreshFile: kind === 'upload', folderName: info.folder ?? null, store, reauthorize: async () => true };
    if (kind === 'upload') {
      source.applyInfo = async (f) => {
        let j: { name?: unknown; version?: unknown };
        try {
          j = JSON.parse(await f.text()) as typeof j;
        } catch {
          return { status: 'unreadable' };
        }
        if (!j || typeof j !== 'object') return { status: 'unreadable' };
        if (j.name !== PLUGIN_NAME) return { status: 'not-plugin' };
        if (typeof j.version !== 'string') return { status: 'unreadable' };
        source.pluginVersion = j.version;
        source.features = featuresFor(j.version);
        return { status: 'applied' };
      };
      source.replaceFile = async (f) => {
        const fresh = await f.text();
        try {
          if (typeof JSON.parse(fresh) !== 'object') return { status: 'unreadable' };
        } catch {
          return { status: 'unreadable' };
        }
        file.replace(fresh, f.lastModified || now());
        return { status: 'replaced' };
      };
    }
    return source;
  };

  return {
    directAccess,
    persistent: () => persistence.persistent,
    download,

    async start() {
      let saved: RememberedSource | null;
      try {
        saved = await persistence.loadSource();
      } catch {
        return { status: 'none' };
      }
      if (!saved) return { status: 'none' };
      if ((await permissionOf(saved.handle, false)) !== 'granted') {
        pending = saved;
        return { status: 'needs-permission', name: saved.name, kind: saved.kind };
      }
      return open(saved);
    },

    async grant() {
      if (!pending) return { status: 'denied' as const };
      if ((await permissionOf(pending.handle, true)) !== 'granted') return { status: 'denied' as const };
      const r = await open(pending);
      pending = null;
      return r.status === 'ready' ? { status: 'ready' as const, source: r.source } : { status: 'denied' as const };
    },

    async pickFolder() {
      let handle: FileSystemDirectoryHandle | null;
      try {
        handle = await pickFolder(deps.pickers);
      } catch (e) {
        if (e instanceof BlockedPickError) return { status: 'blocked' as const };
        throw e;
      }
      if (!handle) return { status: 'cancelled' as const };
      const id = crypto.randomUUID();
      const source = await folderSource(handle, id);
      if ('notPlugin' in source) return { status: 'not-plugin' as const, name: source.notPlugin };
      await remember({ id, kind: 'folder', handle, name: handle.name });
      return { status: 'picked' as const, source };
    },

    async pickFile() {
      let handle: FileSystemFileHandle | null;
      try {
        handle = await pickConfigFile(deps.pickers);
      } catch (e) {
        if (e instanceof BlockedPickError) return { status: 'blocked' as const };
        throw e;
      }
      if (!handle) return { status: 'cancelled' as const };
      if (handle.name !== 'config.json') return { status: 'bad-selection' as const };
      const id = crypto.randomUUID();
      await remember({ id, kind: 'file', handle, name: handle.name });
      return { status: 'picked' as const, source: fileSource(handle, id) };
    },

    async openFiles(files: File[]) {
      const path = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const info = files.find((f) => /^[^/]+\/info\.json$/.test(path(f)));
      const config = files.find((f) => /(^|\/)data\/config\.json$/.test(path(f))) ?? files.find((f) => f.name === 'config.json' && !path(f).includes('/'));
      let version: string | null = null;
      if (info) {
        try {
          const j = JSON.parse(await info.text()) as { name?: unknown; version?: unknown };
          if (j.name !== PLUGIN_NAME) return { status: 'not-plugin' as const, name: path(info).split('/')[0] ?? '' };
          version = typeof j.version === 'string' ? j.version : null;
        } catch {
          return { status: 'bad-selection' as const };
        }
      }
      if (!config && !info) return { status: 'bad-selection' as const };
      const folder = info ? (path(info).split('/')[0] ?? 'config.json') : 'config.json';
      return { status: 'picked' as const, source: memorySource('upload', folder, config ? await config.text() : null, config?.lastModified ?? now(), { version, folder: info ? folder : null }) };
    },

    startDemo: () => memorySource('demo', 'Пример', demoConfigText(), now(), { version: '0.5.0' }),

    async forget() {
      pending = null;
      try {
        await persistence.forget();
      } catch {
        /* nothing more to do */
      }
    },
  };

  async function open(saved: RememberedSource): Promise<StartResult> {
    if (saved.kind === 'file') return { status: 'ready', source: fileSource(saved.handle as FileSystemFileHandle, saved.id) };
    const source = await folderSource(saved.handle as FileSystemDirectoryHandle, saved.id);
    if ('notPlugin' in source) {
      await persistence.forget().catch(() => undefined); // the folder is not a plugin any more: start over
      return { status: 'none' };
    }
    return { status: 'ready', source };
  }
}
