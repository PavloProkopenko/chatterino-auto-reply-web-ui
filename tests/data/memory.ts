import type { FileAccess, FileRead } from '../../src/ui/data/ports.ts';
import { FileWriteError } from '../../src/ui/data/ports.ts';

export { InMemoryBackups as MemoryBackups } from '../../src/ui/data/backups.ts';

/** An in-memory file with the behaviour the store cares about: content, modified time, failures on demand. */
export class MemoryFile implements FileAccess {
  text: string | null;
  modified = 1_700_000_000_000;
  writes = 0;
  failWith: (() => FileWriteError | null) | null = null;
  constructor(text: string | null) {
    this.text = text;
  }
  async read(): Promise<FileRead | null> {
    if (this.text === null) return null;
    return { text: this.text, modified: this.modified, size: new TextEncoder().encode(this.text).length };
  }
  async stat() {
    return this.text === null ? null : { modified: this.modified, size: new TextEncoder().encode(this.text).length };
  }
  async write(text: string): Promise<void> {
    const err = this.failWith?.();
    if (err) throw err;
    this.text = text;
    this.modified += 1000;
    this.writes++;
  }
  /** What the running plugin does: rewrite the whole file. */
  pluginSaves(text: string) {
    this.text = text;
    this.modified += 1000;
  }
}
