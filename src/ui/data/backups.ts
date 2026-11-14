import type { BackupEntry, BackupInfo, BackupStore } from './ports.ts';

/** Backups kept in memory: the fallback when the browser will not let us persist anything (private windows). */
export class InMemoryBackups implements BackupStore {
  entries: BackupEntry[] = [];
  #seq = 0;
  async add(text: string, at: number): Promise<string> {
    const id = `${String(at).padStart(15, '0')}-${String(this.#seq++).padStart(4, '0')}`;
    this.entries.push({ id, at, size: new TextEncoder().encode(text).length, text });
    return id;
  }
  async list(): Promise<BackupInfo[]> {
    return this.entries.map(({ id, at, size }) => ({ id, at, size })).sort((a, b) => (a.id < b.id ? 1 : -1));
  }
  async get(id: string): Promise<string | null> {
    return this.entries.find((e) => e.id === id)?.text ?? null;
  }
  async prune(keep: number): Promise<void> {
    this.entries = [...this.entries].sort((a, b) => (a.id < b.id ? -1 : 1)).slice(-keep);
  }
}
