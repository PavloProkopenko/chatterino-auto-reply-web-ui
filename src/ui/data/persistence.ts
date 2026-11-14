import { InMemoryBackups } from './backups.ts';
import type { BackupInfo, BackupStore } from './ports.ts';

/** What the page remembers between visits: which folder or file was chosen, and the backups of its config. */
export interface RememberedSource {
  id: string;
  kind: 'folder' | 'file';
  handle: FileSystemDirectoryHandle | FileSystemFileHandle;
  /** Folder or file name, for display only (the browser never reveals the full path). */
  name: string;
}

export interface Persistence {
  /** False when the browser would not give us storage (private window): everything lives until the tab closes. */
  persistent: boolean;
  loadSource(): Promise<RememberedSource | null>;
  saveSource(s: RememberedSource): Promise<void>;
  /** Forget the choice and delete its backups. */
  forget(): Promise<void>;
  backups(sourceId: string): BackupStore;
}

const DB = 'auto-reply-web';
const SOURCE_KEY = 'source';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('backups', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

interface Row {
  key: string;
  sourceId: string;
  id: string;
  at: number;
  size: number;
  text: string;
}

class IdbBackups implements BackupStore {
  #db: IDBDatabase;
  #source: string;
  #seq = 0;
  constructor(db: IDBDatabase, source: string) {
    this.#db = db;
    this.#source = source;
  }
  async #rows(): Promise<Row[]> {
    const all = await wrap(this.#db.transaction('backups').objectStore('backups').getAll() as IDBRequest<Row[]>);
    return all.filter((r) => r.sourceId === this.#source);
  }
  async add(text: string, at: number): Promise<string> {
    const id = `${String(at).padStart(15, '0')}-${String(this.#seq++).padStart(4, '0')}`;
    const tx = this.#db.transaction('backups', 'readwrite');
    tx.objectStore('backups').put({ key: `${this.#source}/${id}`, sourceId: this.#source, id, at, size: new TextEncoder().encode(text).length, text } satisfies Row);
    await done(tx);
    return id;
  }
  async list(): Promise<BackupInfo[]> {
    return (await this.#rows()).map(({ id, at, size }) => ({ id, at, size })).sort((a, b) => (a.id < b.id ? 1 : -1));
  }
  async get(id: string): Promise<string | null> {
    const row = await wrap(this.#db.transaction('backups').objectStore('backups').get(`${this.#source}/${id}`) as IDBRequest<Row | undefined>);
    return row?.text ?? null;
  }
  async prune(keep: number): Promise<void> {
    const rows = (await this.#rows()).sort((a, b) => (a.id < b.id ? -1 : 1));
    const drop = rows.slice(0, Math.max(0, rows.length - keep));
    if (drop.length === 0) return;
    const tx = this.#db.transaction('backups', 'readwrite');
    for (const r of drop) tx.objectStore('backups').delete(r.key);
    await done(tx);
  }
}

function inMemory(): Persistence {
  let source: RememberedSource | null = null;
  const stores = new Map<string, InMemoryBackups>();
  return {
    persistent: false,
    loadSource: async () => source,
    saveSource: async (s) => void (source = s),
    forget: async () => {
      if (source) stores.delete(source.id);
      source = null;
    },
    backups: (id) => stores.get(id) ?? (stores.set(id, new InMemoryBackups()), stores.get(id)!),
  };
}

/** IndexedDB-backed persistence, or an in-memory one (persistent: false) when the browser refuses storage. */
export async function openPersistence(): Promise<Persistence> {
  let db: IDBDatabase;
  try {
    db = await open();
  } catch {
    return inMemory();
  }
  const store: Persistence = {
    persistent: true,
    async loadSource() {
      return ((await wrap(db.transaction('kv').objectStore('kv').get(SOURCE_KEY))) as RememberedSource | undefined) ?? null;
    },
    async saveSource(s) {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(s, SOURCE_KEY);
      await done(tx);
    },
    async forget() {
      // Read first: an IndexedDB transaction closes as soon as it has nothing pending, so it cannot wait on another one.
      const current = await store.loadSource();
      const rows = current ? await wrap(db.transaction('backups').objectStore('backups').getAll() as IDBRequest<Row[]>) : [];
      const tx = db.transaction(['kv', 'backups'], 'readwrite');
      tx.objectStore('kv').delete(SOURCE_KEY);
      for (const r of rows) if (r.sourceId === current!.id) tx.objectStore('backups').delete(r.key);
      await done(tx);
    },
    backups: (sourceId) => new IdbBackups(db, sourceId),
  };
  return store;
}

/** A Persistence that can be handed out at once and opens IndexedDB in the background; every call waits for it. */
export function lazyPersistence(): Persistence {
  const ready = openPersistence();
  let opened: Persistence | null = null;
  void ready.then((p) => (opened = p));
  return {
    get persistent() {
      return opened?.persistent ?? true;
    },
    loadSource: async () => (await ready).loadSource(),
    saveSource: async (s) => (await ready).saveSource(s),
    forget: async () => (await ready).forget(),
    backups: (sourceId): BackupStore => ({
      add: async (text, at) => (await ready).backups(sourceId).add(text, at),
      list: async () => (await ready).backups(sourceId).list(),
      get: async (id) => (await ready).backups(sourceId).get(id),
      prune: async (keep) => (await ready).backups(sourceId).prune(keep),
    }),
  };
}
