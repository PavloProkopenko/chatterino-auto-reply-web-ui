import { FileWriteError, type FileAccess, type FileRead, type PluginDir } from './ports.ts';

// File System Access API (Chrome, Edge, Opera). The TypeScript DOM lib lacks the pickers and the permission calls,
// so they are declared here. All file content stays in the browser: nothing in this module touches the network.

export type PermissionState = 'granted' | 'denied' | 'prompt';
interface WithPermission {
  queryPermission(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
interface Pickers {
  showDirectoryPicker?: (o?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (o?: { id?: string; multiple?: boolean; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle[]>;
}

/** The browser lets the page keep access to a chosen file or folder. */
export const directAccessSupported = (w: Pickers = window as unknown as Pickers): boolean => typeof w.showDirectoryPicker === 'function' && typeof w.showOpenFilePicker === 'function';

const errName = (e: unknown) => (e instanceof DOMException || e instanceof Error ? e.name : '');

/** The browser refused to let the page use this folder (it holds system files, for instance). */
export class BlockedPickError extends Error {
  constructor() {
    super('the browser does not allow this location');
    this.name = 'BlockedPickError';
  }
}

/** The page has no permission to the remembered file right now; one click can grant it again. */
export class PermissionNeededError extends Error {
  constructor() {
    super('permission needed');
    this.name = 'PermissionNeededError';
  }
}

async function pick<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    if (errName(e) === 'AbortError') {
      // Chrome reports a refused folder as an AbortError whose message mentions system files; a plain cancel has none.
      if (e instanceof Error && /system|sensitive|protect/i.test(e.message)) throw new BlockedPickError();
      return null; // the user closed the dialog
    }
    if (errName(e) === 'SecurityError') throw new BlockedPickError();
    throw e;
  }
}

export const pickFolder = (w: Pickers = window as unknown as Pickers) => pick(() => w.showDirectoryPicker!({ id: 'auto-reply-plugin', mode: 'readwrite' }));

export const pickConfigFile = async (w: Pickers = window as unknown as Pickers): Promise<FileSystemFileHandle | null> =>
  (await pick(() => w.showOpenFilePicker!({ id: 'auto-reply-config', multiple: false, types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] })))?.[0] ?? null;

/** Current permission; with `request` it asks (needs a user gesture) when it is only "prompt". */
export async function permissionOf(handle: FileSystemHandle, request = false): Promise<PermissionState> {
  const h = handle as unknown as WithPermission;
  try {
    const state = await h.queryPermission({ mode: 'readwrite' });
    if (state === 'granted' || !request) return state;
    return await h.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

type GetHandle = (create: boolean) => Promise<FileSystemFileHandle | null>;

function mapWriteError(e: unknown): FileWriteError {
  const name = errName(e);
  const message = e instanceof Error ? e.message : String(e);
  if (name === 'NotAllowedError' || name === 'SecurityError') return new FileWriteError('permission', message);
  // Another program (the running app) has the file: worth a retry in a moment.
  if (name === 'NoModificationAllowedError' || name === 'InvalidStateError' || name === 'NotReadableError') return new FileWriteError('busy', message);
  return new FileWriteError('other', message);
}

/** FileAccess over a handle resolved on demand (so a missing file or folder reads as "missing", not as an error). */
export function handleFileAccess(get: GetHandle): FileAccess {
  async function readFile(): Promise<File | null> {
    try {
      const handle = await get(false);
      return handle ? await handle.getFile() : null;
    } catch (e) {
      const name = errName(e);
      if (name === 'NotFoundError') return null;
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new PermissionNeededError();
      throw e;
    }
  }
  return {
    async read(): Promise<FileRead | null> {
      const f = await readFile();
      return f ? { text: await f.text(), modified: f.lastModified, size: f.size } : null;
    },
    async stat() {
      const f = await readFile();
      return f ? { modified: f.lastModified, size: f.size } : null;
    },
    async write(text: string) {
      let stream: FileSystemWritableFileStream | undefined;
      try {
        const handle = await get(true);
        if (!handle) throw new FileWriteError('other', 'could not create the file');
        stream = await handle.createWritable();
        await stream.write(text);
        await stream.close(); // the browser swaps the new content in atomically on close
      } catch (e) {
        if (stream) await stream.abort().catch(() => undefined);
        throw e instanceof FileWriteError ? e : mapWriteError(e);
      }
    },
  };
}

const isNotFound = (e: unknown) => errName(e) === 'NotFoundError' || errName(e) === 'TypeMismatchError';

/** `<plugin folder>/data/config.json`. */
export function folderConfigAccess(plugin: FileSystemDirectoryHandle): FileAccess {
  return handleFileAccess(async (create) => {
    try {
      const data = await plugin.getDirectoryHandle('data', { create });
      return await data.getFileHandle('config.json', { create });
    } catch (e) {
      if (!create && isNotFound(e)) return null;
      throw e;
    }
  });
}

/** A single picked file handle. */
export const fileConfigAccess = (handle: FileSystemFileHandle): FileAccess => handleFileAccess(async () => handle);

export interface PluginInfo {
  name: string;
  version: string | null;
}

/** `info.json` of the plugin folder (name and version), or null when it is not there or not readable. */
export async function readPluginInfo(plugin: FileSystemDirectoryHandle): Promise<PluginInfo | null> {
  try {
    const f = await (await plugin.getFileHandle('info.json')).getFile();
    const info = JSON.parse(await f.text()) as { name?: unknown; version?: unknown };
    return typeof info.name === 'string' ? { name: info.name, version: typeof info.version === 'string' ? info.version : null } : null;
  } catch {
    return null;
  }
}

interface DirWithValues {
  values(): AsyncIterable<FileSystemHandle>;
}

/** A picked folder as the plugin installer sees it: relative "a/b.txt" paths, parents created on write. */
export function folderPluginDir(root: FileSystemDirectoryHandle): PluginDir {
  async function dirAt(path: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let cur = root;
    for (const part of path.split('/').filter(Boolean)) {
      try {
        cur = await cur.getDirectoryHandle(part, { create });
      } catch (e) {
        if (!create && isNotFound(e)) return null;
        throw e;
      }
    }
    return cur;
  }
  const split = (path: string): [string, string] => {
    const i = path.lastIndexOf('/');
    return i === -1 ? ['', path] : [path.slice(0, i), path.slice(i + 1)];
  };
  return {
    async list(path) {
      const dir = await dirAt(path, false);
      if (!dir) return null;
      const out: { name: string; kind: 'file' | 'directory' }[] = [];
      for await (const h of (dir as unknown as DirWithValues).values()) out.push({ name: h.name, kind: h.kind });
      return out;
    },
    async read(path) {
      const [dir, name] = split(path);
      try {
        const d = await dirAt(dir, false);
        return d ? await (await (await d.getFileHandle(name)).getFile()).text() : null;
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async write(path, text) {
      const [dir, name] = split(path);
      const d = await dirAt(dir, true);
      const handle = await d!.getFileHandle(name, { create: true });
      let stream: FileSystemWritableFileStream | undefined;
      try {
        stream = await handle.createWritable();
        await stream.write(text);
        await stream.close();
      } catch (e) {
        if (stream) await stream.abort().catch(() => undefined);
        throw mapWriteError(e);
      }
    },
  };
}
