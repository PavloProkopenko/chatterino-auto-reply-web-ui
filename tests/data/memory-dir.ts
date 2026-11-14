import type { PluginDir } from '../../src/ui/data/ports.ts';

/** An in-memory plugin folder: flat map of "a/b.txt" -> text. */
export class MemoryDir implements PluginDir {
  files: Map<string, string>;
  failWritesTo: RegExp | null = null;
  constructor(initial: Record<string, string> = {}) {
    this.files = new Map(Object.entries(initial));
  }
  async list(path: string) {
    const prefix = path === '' ? '' : path + '/';
    const out = new Map<string, 'file' | 'directory'>();
    let any = path === '';
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      any = true;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      out.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1 ? 'file' : 'directory');
    }
    return any ? [...out].map(([name, kind]) => ({ name, kind })) : null;
  }
  async read(path: string) {
    return this.files.get(path) ?? null;
  }
  async write(path: string, text: string) {
    if (this.failWritesTo?.test(path)) throw new Error('write refused');
    this.files.set(path, text);
  }
}
