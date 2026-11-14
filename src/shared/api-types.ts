import type { Candidate } from '../server/discover.ts';
import type { BackupInfo, Snapshot } from '../server/store.ts';
import type { Config } from './config.ts';
import type { Features } from './features.ts';
import type { Conflict, MergeNote } from './merge.ts';

export type { BackupInfo, Candidate, Conflict, MergeNote, Snapshot };

export interface DiscoverResponse {
  candidates: Candidate[];
  selected: string | null;
}

export type SelectResponse =
  | { ok: true; path: string; exists: boolean; pluginVersion: string | null; warnings: ('no-plugin-info' | 'other-plugin')[] }
  | { ok: false; error: string };

interface ConfigInfo {
  path: string;
  pluginVersion: string | null;
  features: Features;
}

export type ConfigResponse =
  | ({ status: 'ok'; snapshot: Snapshot; config: Config; exact: boolean } & ConfigInfo)
  | ({ status: 'missing' } & ConfigInfo)
  | ({ status: 'invalid'; readOnly: true; snapshot: Snapshot; error: string; text: string } & ConfigInfo)
  | { status: 'no-config-selected' };

export type SaveResponse =
  | { status: 'saved'; snapshot: Snapshot; config: Config; notes: MergeNote[]; merged: boolean; backup: string | null }
  | { status: 'conflict'; conflicts: Conflict[]; theirs: Config; snapshot: Snapshot }
  | { status: 'stale-base' }
  | { status: 'invalid'; error: string };

export type RestoreResponse = { status: 'restored'; snapshot: Snapshot; backup: string } | { status: 'invalid'; error: string };

/** What the UI needs from the server; the fetch client implements it, tests fake it. */
export interface Api {
  discover(): Promise<DiscoverResponse>;
  select(path: string): Promise<SelectResponse>;
  loadConfig(): Promise<ConfigResponse>;
  save(baseHash: string, config: Config): Promise<SaveResponse>;
  createDefault(): Promise<{ status: 'created' | 'exists' }>;
  backups(): Promise<BackupInfo[]>;
  restore(name: string): Promise<RestoreResponse>;
}

/** The server cannot be reached (it exited, or the page was opened without the session token). */
export class OfflineError extends Error {
  constructor() {
    super('offline');
    this.name = 'OfflineError';
  }
}
