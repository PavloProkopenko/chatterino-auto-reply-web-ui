import { deepEqual, type Config } from '../../shared/config.ts';
import { mergeConfigs, type Conflict, type MergeNote, type Resolutions } from '../../shared/merge.ts';
import { PermissionNeededError } from '../data/fs-access.ts';
import { resetPreview } from './preview-state.svelte.ts';
import type { BackupInfo, WriteFailure } from '../data/ports.ts';
import type { LoadResult, SaveResult, Snapshot } from '../data/store.ts';
import type { PluginFolder, PickResult, Source, SourceInfo, Workspace } from '../data/workspace.ts';

export type Phase = 'loading' | 'welcome' | 'needs-permission' | 'missing' | 'invalid' | 'ready';
export type PickProblem = 'blocked' | 'not-plugin' | 'bad-selection';
export type FreshProblem = 'unreadable';
export type InfoProblem = 'unreadable' | 'not-plugin';

export interface SessionOptions {
  workspace: Workspace;
  now?: () => number;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;

/**
 * The editing session: what was loaded, what the user changed, and the save/conflict/undo rules.
 * Framework-free logic on top of Svelte 5 runes so components can bind to it directly.
 */
export class Session {
  phase = $state<Phase>('loading');
  /** Why the last pick did not work (shown on the welcome screen). */
  pickProblem = $state<PickProblem | null>(null);
  pickedName = $state<string | null>(null);
  /** For the "continue with the remembered folder" screen. */
  remembered = $state.raw<{ name: string; kind: 'folder' | 'file' } | null>(null);
  source = $state.raw<SourceInfo | null>(null);
  /** The open folder's plugin files (folder sources only): what the Plugin card installs and updates. */
  pluginFolder = $state.raw<PluginFolder | null>(null);
  /** A folder picked on the welcome screen to install the plugin into. */
  installTarget = $state.raw<{ plugin: PluginFolder; adopt: () => Promise<Source | null> } | null>(null);
  installBlocked = $state(false);
  /** False when a save will re-lay-out the file (it was not in the style the app writes). */
  exact = $state(true);
  invalid = $state.raw<{ error: string; text: string } | null>(null);

  base = $state.raw<Config | null>(null);
  current = $state<Config | null>(null);
  saving = $state(false);
  error = $state<string | null>(null);
  needsReload = $state(false);
  lastSave = $state.raw<{ merged: boolean; notes: MergeNote[]; backup: string | null } | null>(null);
  conflict = $state.raw<{ conflicts: Conflict[]; theirs: Config; snapshot: Snapshot } | null>(null);
  staleBase = $state(false);
  externalChange = $state(false);
  /** The file could not be written; `text` is what should have been written, ready to download. */
  writeFailed = $state.raw<{ reason: WriteFailure; text: string } | null>(null);
  /** Download mode: the user must open the current config.json again before the download (the dialog is open). */
  askFreshFile = $state(false);
  freshProblem = $state<FreshProblem | null>(null);
  /** Why the info.json the user opened was not used. */
  infoProblem = $state<InfoProblem | null>(null);
  /** Messages for fields whose current text is not a valid value; any entry blocks saving. */
  fieldErrors = $state<Record<string, string>>({});

  #ws: Workspace;
  #now: () => number;
  #source: Source | null = null;
  #hash: string | null = null;
  #stat: { modified: number; size: number } | null = null;
  #undo = $state.raw<Config[]>([]);
  #redo = $state.raw<Config[]>([]);
  #lastKey: string | null = null;
  #lastAt = 0;
  /** The file was opened again for the download in progress; reset after each download. */
  #fresh = false;

  dirty = $derived(this.base !== null && this.current !== null && !deepEqual($state.snapshot(this.current), this.base));
  canUndo = $derived(this.#undo.length > 0);
  canRedo = $derived(this.#redo.length > 0);
  canLeave = $derived(!this.dirty);
  hasFieldErrors = $derived(Object.keys(this.fieldErrors).length > 0);
  canSave = $derived(this.dirty && !this.hasFieldErrors && !this.saving && this.phase === 'ready');

  constructor(opts: SessionOptions) {
    this.#ws = opts.workspace;
    this.#now = opts.now ?? Date.now;
  }

  get directAccess(): boolean {
    return this.#ws.directAccess;
  }
  get persistent(): boolean {
    return this.#ws.persistent();
  }

  async start(): Promise<void> {
    await this.#guard(async () => {
      const r = await this.#ws.start();
      if (r.status === 'none') this.phase = 'welcome';
      else if (r.status === 'needs-permission') {
        this.remembered = { name: r.name, kind: r.kind };
        this.phase = 'needs-permission';
      } else await this.#open(r.source);
    });
  }

  pickFolder = () => this.#pick(() => this.#ws.pickFolder());
  pickFile = () => this.#pick(() => this.#ws.pickFile());
  openFiles = (files: File[]) => this.#pick(() => this.#ws.openFiles(files));

  /** Welcome screen: choose the folder the plugin should be installed into. */
  async pickInstallFolder(): Promise<void> {
    await this.#guard(async () => {
      const r = await this.#ws.pickPluginFolder();
      this.installBlocked = r.status === 'blocked';
      if (r.status === 'picked') this.installTarget = { plugin: r.plugin, adopt: r.adopt };
    });
  }
  cancelInstall(): void {
    this.installTarget = null;
    this.installBlocked = false;
  }
  /** After an install: continue with that folder's config. */
  async adoptInstallTarget(): Promise<void> {
    const target = this.installTarget;
    if (!target) return;
    await this.#guard(async () => {
      const source = await target.adopt();
      this.installTarget = null;
      if (source) await this.#open(source);
    });
  }
  /** After an install or update in the open folder: version and features come from the new info.json. */
  async refreshPluginInfo(): Promise<void> {
    const source = this.#source;
    if (!source?.refreshInfo || !this.source) return;
    await source.refreshInfo();
    this.source = { ...this.source, pluginVersion: source.pluginVersion, features: source.features };
  }
  async startDemo(): Promise<void> {
    await this.#guard(async () => this.#open(this.#ws.startDemo()));
  }

  /** One click to give the page access again: to the open source (permission lapsed mid-session) or the remembered one. */
  async grantAccess(): Promise<void> {
    await this.#guard(async () => {
      if (this.#source) {
        if (!(await this.#source.reauthorize())) return; // still refused: stay on the permission screen
        this.#apply(await this.#source.store.load());
        return;
      }
      const r = await this.#ws.grant();
      if (r.status === 'ready') await this.#open(r.source);
      else {
        this.remembered = null;
        this.phase = 'welcome';
      }
    });
  }

  /** Back to the welcome screen. With `forget`, also drops the remembered choice and its backups. The caller checks `dirty`. */
  async leave(forget = true): Promise<void> {
    if (forget) await this.#ws.forget();
    this.#source = null;
    this.source = null;
    this.pluginFolder = null;
    resetPreview();
    this.installTarget = null;
    this.installBlocked = false;
    this.base = this.current = null;
    this.#hash = null;
    this.#stat = null;
    this.#fresh = false;
    this.askFreshFile = false;
    this.remembered = null;
    this.pickProblem = null;
    this.phase = 'welcome';
  }

  async createDefault(): Promise<void> {
    await this.#guard(async () => {
      await this.#store().createDefault();
      this.#apply(await this.#store().load());
    });
  }

  async reloadFromDisk(): Promise<void> {
    await this.#guard(async () => this.#apply(await this.#store().load()));
  }

  /** Called on tab focus and by a light timer: pick up what the plugin saved, or warn if there are unsaved edits. */
  async refreshIfChanged(): Promise<void> {
    if (this.phase !== 'ready' || this.saving || !this.#source) return;
    await this.#guard(async () => {
      const stat = await this.#store().peek();
      if (stat && this.#stat && stat.modified === this.#stat.modified && stat.size === this.#stat.size) return;
      const r = await this.#store().load();
      if (r.status === 'ok' && r.snapshot.hash === this.#hash) {
        this.#stat = { modified: r.snapshot.mtimeMs, size: r.snapshot.size };
        return;
      }
      if (r.status !== 'ok') this.#apply(r); // the file was removed or broke: the matching screen takes over
      else if (this.dirty) this.externalChange = true;
      else this.#apply(r);
    });
  }

  edit(fn: (c: Config) => void, key?: string): void {
    if (this.phase !== 'ready' || !this.current) return;
    const at = this.#now();
    const coalesce = key !== undefined && key === this.#lastKey && at - this.#lastAt < COALESCE_MS;
    if (!coalesce) this.#undo = [...this.#undo, $state.snapshot(this.current) as Config].slice(-HISTORY_LIMIT);
    this.#lastKey = key ?? null;
    this.#lastAt = at;
    this.#redo = [];
    fn(this.current);
  }

  undo(): void {
    const prev = this.#undo.at(-1);
    if (!prev || !this.current) return;
    this.#redo = [...this.#redo, $state.snapshot(this.current) as Config];
    this.#undo = this.#undo.slice(0, -1);
    this.current = structuredClone(prev);
    this.#lastKey = null;
  }

  redo(): void {
    const next = this.#redo.at(-1);
    if (!next || !this.current) return;
    this.#undo = [...this.#undo, $state.snapshot(this.current) as Config];
    this.#redo = this.#redo.slice(0, -1);
    this.current = structuredClone(next);
    this.#lastKey = null;
  }

  revert(): void {
    if (!this.base || !this.current) return;
    this.fieldErrors = {};
    // Dropping every edit is itself one undo step, so it is never a one-way trip.
    if (this.dirty) this.#undo = [...this.#undo, $state.snapshot(this.current) as Config].slice(-HISTORY_LIMIT);
    this.current = structuredClone(this.base);
    this.#redo = [];
    this.#lastKey = null;
  }

  setFieldError(key: string, message: string | null): void {
    const next = { ...this.fieldErrors };
    if (message) next[key] = message;
    else delete next[key];
    this.fieldErrors = next;
  }

  async save(): Promise<void> {
    if (!this.canSave || !this.current || !this.#hash) return;
    if (this.source?.needsFreshFile && !this.#fresh) {
      // The copy we hold may be old: the plugin rewrites the file on its own. Ask for the current one first.
      this.freshProblem = null;
      this.askFreshFile = true;
      return;
    }
    this.saving = true;
    this.error = null;
    this.writeFailed = null;
    try {
      const r: SaveResult = await this.#store().save(this.#hash, $state.snapshot(this.current) as Config);
      switch (r.status) {
        case 'saved':
          this.#fresh = false;
          this.#setBase(r.config, r.snapshot);
          this.needsReload = true;
          this.staleBase = false;
          this.externalChange = false;
          this.lastSave = { merged: r.merged, notes: r.notes, backup: r.backup };
          break;
        case 'conflict':
          this.conflict = { conflicts: r.conflicts, theirs: r.theirs, snapshot: r.snapshot };
          break;
        case 'stale-base':
          this.staleBase = true;
          break;
        case 'invalid':
          this.error = r.error;
          break;
        case 'write-failed':
          this.writeFailed = { reason: r.reason, text: r.text };
          break;
      }
    } catch (e) {
      this.#fail(e);
    } finally {
      this.saving = false;
    }
  }

  /** Download mode: take the current config.json the user opened again, merge their edits onto it, then download. */
  async saveWithFile(file: File): Promise<void> {
    const source = this.#source;
    if (!source?.replaceFile) return;
    const r = await source.replaceFile(file);
    if (r.status === 'unreadable') {
      this.freshProblem = 'unreadable';
      return;
    }
    this.freshProblem = null;
    this.askFreshFile = false;
    this.#fresh = true;
    await this.save();
  }

  /** Download mode: the plugin's info.json, opened after config.json, gives the version and enables what it allows. */
  async openInfo(file: File): Promise<void> {
    const source = this.#source;
    if (!source?.applyInfo || !this.source) return;
    const r = await source.applyInfo(file);
    if (r.status !== 'applied') {
      this.infoProblem = r.status;
      return;
    }
    this.infoProblem = null;
    this.source = { ...this.source, pluginVersion: source.pluginVersion, features: source.features };
  }

  cancelFreshFile(): void {
    this.askFreshFile = false;
    this.freshProblem = null;
  }

  /** After a refused write: ask the browser for permission again, then save the same edits. */
  async retryAfterGrant(): Promise<void> {
    if (!this.#source || !(await this.#source.reauthorize())) return;
    await this.save();
  }

  /** The write failed (busy file, lost permission): give the user the exact text as a file instead. */
  downloadFailed(): void {
    if (this.writeFailed) this.#ws.download('config.json', this.writeFailed.text);
  }

  /** Apply the user's per-field choices on top of the plugin's version, then save against that version. */
  async resolveConflicts(choices: Resolutions): Promise<void> {
    const c = this.conflict;
    if (!c || !this.base || !this.current) return;
    const merged = mergeConfigs(this.base, c.theirs, $state.snapshot(this.current) as Config, choices);
    if (!merged.ok) return; // something is still unresolved: keep the dialog open
    this.base = c.theirs;
    this.#hash = c.snapshot.hash;
    this.current = structuredClone(merged.config);
    this.conflict = null;
    await this.save();
  }

  cancelConflict(): void {
    this.conflict = null;
  }

  async listBackups(): Promise<BackupInfo[]> {
    return this.#store().listBackups();
  }

  async restore(id: string): Promise<void> {
    await this.#guard(async () => {
      const r = await this.#store().restore(id);
      if (r.status === 'invalid') {
        this.error = r.error;
        return;
      }
      this.#apply(await this.#store().load());
      this.needsReload = true;
    });
  }

  dismissReload(): void {
    this.needsReload = false;
  }

  #store() {
    if (!this.#source) throw new Error('no source is open');
    return this.#source.store;
  }

  async #pick(run: () => Promise<PickResult>): Promise<void> {
    await this.#guard(async () => {
      const r = await run();
      this.pickProblem = null;
      this.pickedName = null;
      if (r.status === 'cancelled') return;
      if (r.status === 'picked') return this.#open(r.source);
      this.pickProblem = r.status;
      if (r.status === 'not-plugin') this.pickedName = r.name;
      this.phase = 'welcome';
    });
  }

  async #open(source: Source): Promise<void> {
    this.#source = source;
    this.pluginFolder = source.plugin ?? null;
    this.#fresh = false;
    this.askFreshFile = false;
    this.freshProblem = null;
    this.infoProblem = null;
    this.source = {
      kind: source.kind,
      name: source.name,
      pluginVersion: source.pluginVersion,
      features: source.features,
      canSaveInPlace: source.canSaveInPlace,
      needsFreshFile: source.needsFreshFile,
      folderName: source.folderName,
    };
    this.#apply(await source.store.load());
  }

  #setBase(config: Config, snapshot: Snapshot): void {
    this.fieldErrors = {};
    this.base = structuredClone(config);
    this.current = structuredClone(config);
    this.#hash = snapshot.hash;
    this.#stat = { modified: snapshot.mtimeMs, size: snapshot.size };
    this.#undo = [];
    this.#redo = [];
    this.#lastKey = null;
  }

  #apply(r: LoadResult): void {
    this.error = null;
    this.conflict = null;
    this.staleBase = false;
    this.externalChange = false;
    this.writeFailed = null;
    this.pickProblem = null;
    if (r.status === 'ok') {
      this.exact = r.exact;
      this.invalid = null;
      this.#setBase(r.config, r.snapshot);
      this.phase = 'ready';
      return;
    }
    this.base = null;
    this.current = null;
    this.#hash = null;
    this.#stat = null;
    if (r.status === 'missing') {
      this.phase = 'missing';
    } else {
      this.invalid = { error: r.error, text: r.text };
      this.phase = 'invalid';
    }
  }

  #fail(e: unknown): void {
    if (e instanceof PermissionNeededError) {
      this.remembered = this.#source ? { name: this.#source.name, kind: this.#source.kind === 'file' ? 'file' : 'folder' } : null;
      this.phase = 'needs-permission';
    } else this.error = e instanceof Error ? e.message : String(e);
  }

  async #guard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.#fail(e);
    }
  }
}
