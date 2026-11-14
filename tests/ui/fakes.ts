import { featuresFor } from '../../src/shared/features.ts';
import { PermissionNeededError } from '../../src/ui/data/fs-access.ts';
import { createConfigStore, type ConfigStore } from '../../src/ui/data/store.ts';
import type { PickResult, Source, SourceKind, StartResult, Workspace } from '../../src/ui/data/workspace.ts';
import { MemoryBackups, MemoryFile } from '../data/memory.ts';

export const fixtureText = (over: Record<string, unknown> = {}) =>
  JSON.stringify(
    {
      version: 1,
      channels: ['a'],
      ignore_users: {},
      next_rule_id: 3,
      rules: [
        { id: 1, enabled: true, reply: 'один', channels: {}, conditions: [{ type: 'word', match: 'x' }] },
        { id: 2, enabled: true, reply: 'два', channels: {}, conditions: [{ type: 'word', match: 'y' }] },
      ],
      next_timer_id: 2,
      timers: [{ id: 1, channel: 'a', reply: '{time}', format: 'smart', on_category: 'reset', conditions: [{ type: 'word', match: 'z' }], enabled: false }],
      ...over,
    },
    null,
    2,
  ) + '\n';

export interface FakeSource {
  source: Source;
  file: MemoryFile;
  backups: MemoryBackups;
  /** Replace store methods for a test (scripted answers). */
  override(patch: Partial<ConfigStore>): void;
}

let clock = 1_800_000_000_000;
export function makeSource(opts: { text?: string | null; kind?: SourceKind; version?: string | null; canSaveInPlace?: boolean } = {}): FakeSource {
  const file = new MemoryFile(opts.text === undefined ? fixtureText() : opts.text);
  const backups = new MemoryBackups();
  const real = createConfigStore({ file, backups, now: () => (clock += 1000), sleep: async () => {} });
  const store: ConfigStore = { ...real };
  const version = opts.version === undefined ? '0.5.0' : opts.version;
  const source: Source = {
    kind: opts.kind ?? 'folder',
    name: 'auto-reply',
    pluginVersion: version,
    features: featuresFor(version),
    canSaveInPlace: opts.canSaveInPlace ?? true,
    needsFreshFile: opts.kind === 'upload',
    folderName: 'auto-reply',
    store,
    reauthorize: async () => true,
  };
  // What the real upload source does: the file the user opens again replaces what the store reads.
  if (opts.kind === 'upload') {
    source.replaceFile = async (f) => {
      const text = await f.text();
      try {
        JSON.parse(text);
      } catch {
        return { status: 'unreadable' };
      }
      file.pluginSaves(text);
      return { status: 'replaced' };
    };
  }
  if (opts.kind === 'upload') {
    source.applyInfo = async (f) => {
      const j = JSON.parse(await f.text()) as { name?: string; version?: string };
      if (j.name !== 'Auto Reply') return { status: 'not-plugin' };
      source.pluginVersion = j.version ?? null;
      source.features = featuresFor(source.pluginVersion);
      return { status: 'applied' };
    };
  }
  return { source, file, backups, override: (patch) => void Object.assign(store, patch) };
}

export interface FakeWorkspace {
  ws: Workspace;
  calls: { forget: number; downloads: { name: string; text: string }[]; folder: number; file: number; demo: number };
  /** What the next calls answer. */
  answers: { start: StartResult; pick: PickResult; grant: { status: 'ready'; source: Source } | { status: 'denied' }; demo: Source };
}

export function makeWorkspace(first: Source | null = null): FakeWorkspace {
  const calls: FakeWorkspace['calls'] = { forget: 0, downloads: [], folder: 0, file: 0, demo: 0 };
  const demo = makeSource({ kind: 'demo', canSaveInPlace: false }).source;
  const answers: FakeWorkspace['answers'] = {
    start: first ? { status: 'ready', source: first } : { status: 'none' },
    pick: first ? { status: 'picked', source: first } : { status: 'cancelled' },
    grant: first ? { status: 'ready', source: first } : { status: 'denied' },
    demo,
  };
  const ws: Workspace = {
    directAccess: true,
    persistent: () => true,
    start: async () => answers.start,
    pickFolder: async () => (calls.folder++, answers.pick),
    pickPluginFolder: async () => ({ status: 'cancelled' as const }),
    pickFile: async () => (calls.file++, answers.pick),
    openFiles: async () => answers.pick,
    startDemo: () => (calls.demo++, answers.demo),
    grant: async () => answers.grant,
    forget: async () => void calls.forget++,
    download: (name, text) => void calls.downloads.push({ name, text }),
  };
  return { ws, calls, answers };
}

export { PermissionNeededError };
