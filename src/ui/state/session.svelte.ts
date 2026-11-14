import { OfflineError, type Api, type Candidate, type ConfigResponse, type Conflict, type MergeNote, type Snapshot } from '../../shared/api-types.ts';
import { deepEqual, type Config } from '../../shared/config.ts';
import type { Features } from '../../shared/features.ts';
import { mergeConfigs, type Resolutions } from '../../shared/merge.ts';

export type Phase = 'loading' | 'unselected' | 'missing' | 'invalid' | 'ready' | 'offline';

export interface SessionOptions {
  api: Api;
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
  candidates = $state.raw<Candidate[]>([]);
  pickError = $state<string | null>(null);
  info = $state.raw<{ path: string; pluginVersion: string | null; features: Features } | null>(null);
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
  /** Messages for fields whose current text is not a valid value; any entry blocks saving. */
  fieldErrors = $state<Record<string, string>>({});

  #api: Api;
  #now: () => number;
  #hash: string | null = null;
  #undo = $state.raw<Config[]>([]);
  #redo = $state.raw<Config[]>([]);
  #lastKey: string | null = null;
  #lastAt = 0;

  dirty = $derived(this.base !== null && this.current !== null && !deepEqual($state.snapshot(this.current), this.base));
  canUndo = $derived(this.#undo.length > 0);
  canRedo = $derived(this.#redo.length > 0);
  canLeave = $derived(!this.dirty);
  hasFieldErrors = $derived(Object.keys(this.fieldErrors).length > 0);
  canSave = $derived(this.dirty && !this.hasFieldErrors && !this.saving && this.phase === 'ready');

  constructor(opts: SessionOptions) {
    this.#api = opts.api;
    this.#now = opts.now ?? Date.now;
  }

  async start(): Promise<void> {
    await this.#guard(async () => {
      const r = await this.#api.loadConfig();
      if (r.status === 'no-config-selected') {
        const d = await this.#api.discover();
        this.candidates = d.candidates;
        this.phase = 'unselected';
        return;
      }
      this.#apply(r);
    });
  }

  async choose(path: string): Promise<void> {
    await this.#guard(async () => {
      const r = await this.#api.select(path);
      if (!r.ok) {
        this.pickError = r.error;
        this.phase = 'unselected';
        return;
      }
      this.pickError = null;
      this.#apply(await this.#api.loadConfig());
    });
  }

  /** Back to the list of installs (the user wants a different file). The caller makes sure there are no unsaved edits. */
  async openPicker(): Promise<void> {
    await this.#guard(async () => {
      this.candidates = (await this.#api.discover()).candidates;
      this.pickError = null;
      this.phase = 'unselected';
    });
  }

  async createDefault(): Promise<void> {
    await this.#guard(async () => {
      await this.#api.createDefault();
      this.#apply(await this.#api.loadConfig());
    });
  }

  async reloadFromDisk(): Promise<void> {
    await this.#guard(async () => this.#apply(await this.#api.loadConfig()));
  }

  /** Called when the tab regains focus: pick up what the plugin saved, or warn if there are unsaved edits. */
  async refreshIfChanged(): Promise<void> {
    if (this.phase !== 'ready' || this.saving) return;
    await this.#guard(async () => {
      const r = await this.#api.loadConfig();
      if (r.status !== 'ok' || r.snapshot.hash === this.#hash) return;
      if (this.dirty) this.externalChange = true;
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
    this.saving = true;
    this.error = null;
    try {
      const r = await this.#api.save(this.#hash, $state.snapshot(this.current) as Config);
      switch (r.status) {
        case 'saved':
          this.#setBase(r.config, r.snapshot.hash);
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
      }
    } catch (e) {
      this.#fail(e);
    } finally {
      this.saving = false;
    }
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

  async restore(name: string): Promise<void> {
    await this.#guard(async () => {
      const r = await this.#api.restore(name);
      if (r.status === 'invalid') {
        this.error = r.error;
        return;
      }
      this.#apply(await this.#api.loadConfig());
      this.needsReload = true;
    });
  }

  dismissReload(): void {
    this.needsReload = false;
  }

  #setBase(config: Config, hash: string): void {
    this.fieldErrors = {};
    this.base = structuredClone(config);
    this.current = structuredClone(config);
    this.#hash = hash;
    this.#undo = [];
    this.#redo = [];
    this.#lastKey = null;
  }

  #apply(r: ConfigResponse): void {
    this.error = null;
    this.conflict = null;
    this.staleBase = false;
    this.externalChange = false;
    if (r.status === 'no-config-selected') {
      this.phase = 'unselected';
      return;
    }
    this.info = { path: r.path, pluginVersion: r.pluginVersion, features: r.features };
    if (r.status === 'ok') {
      this.exact = r.exact;
      this.invalid = null;
      this.#setBase(r.config, r.snapshot.hash);
      this.phase = 'ready';
    } else if (r.status === 'missing') {
      this.base = null;
      this.current = null;
      this.#hash = null;
      this.phase = 'missing';
    } else {
      this.base = null;
      this.current = null;
      this.#hash = null;
      this.invalid = { error: r.error, text: r.text };
      this.phase = 'invalid';
    }
  }

  #fail(e: unknown): void {
    if (e instanceof OfflineError) this.phase = 'offline';
    else this.error = e instanceof Error ? e.message : String(e);
  }

  async #guard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.#fail(e);
    }
  }
}
