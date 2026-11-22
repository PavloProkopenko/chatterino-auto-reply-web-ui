import { logoutHelix, readHelixStatus, writeHelixLogin, type HelixStatus } from '../data/helix-file.ts';
import type { PluginDir } from '../data/ports.ts';
import { finishDeviceLogin, startDeviceLogin, type FlowDeps } from '../data/twitch-flow.ts';

export type TwitchError =
  | { kind: 'noFolder' }
  | { kind: 'noClientId' }
  | { kind: 'denied' }
  | { kind: 'expired' }
  | { kind: 'saveFailed' }
  | { kind: 'failed'; message: string };

export type TwitchPhase = 'idle' | 'starting' | 'waiting' | 'saving' | 'loggingOut';

export interface TwitchDeps extends FlowDeps {
  /** The open plugin folder, or null (demo, opened file, nothing open). */
  dir: () => PluginDir | null;
  /** Client ID built into the site; a Client ID stored in helix.json wins. */
  clientId: string;
  /** Called after a successful login: the app switches `helix_enabled` on. */
  enableHelix: () => void;
}

/**
 * The Twitch login of the open plugin folder. State holds only who is logged in and the code the user
 * has to type; the token goes straight from Twitch into data/helix.json (see helix-file.ts).
 */
export class TwitchState {
  /** null until read (or when there is no folder). */
  status = $state.raw<HelixStatus | null>(null);
  phase = $state<TwitchPhase>('idle');
  /** The code and link to show while `phase === 'waiting'`. */
  code = $state.raw<{ userCode: string; verificationUri: string; expiresAt: number } | null>(null);
  error = $state.raw<TwitchError | null>(null);

  readonly #deps: TwitchDeps;
  #dir: PluginDir | null = null;
  #abort: AbortController | null = null;

  constructor(deps: TwitchDeps) {
    this.#deps = deps;
  }

  get loggedIn(): boolean {
    return this.status?.loggedIn === true;
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  #flowDeps(): FlowDeps {
    const d = this.#deps;
    return { fetch: d.fetch, ...(d.now ? { now: d.now } : {}), ...(d.sleep ? { sleep: d.sleep } : {}) };
  }

  /** Reads helix.json; a different (or no) folder than last time resets everything first. */
  async refresh(): Promise<void> {
    const dir = this.#deps.dir();
    if (dir !== this.#dir) {
      this.cancel();
      this.#dir = dir;
      this.status = null;
      this.error = null;
    }
    if (!dir) return;
    try {
      const status = await readHelixStatus(dir);
      if (this.#dir === dir) this.status = status;
    } catch {
      /* unreadable right now: keep what is shown */
    }
  }

  async login(): Promise<void> {
    if (this.phase !== 'idle') return;
    this.error = null;
    await this.refresh();
    const dir = this.#dir;
    if (!dir) {
      this.error = { kind: 'noFolder' };
      return;
    }
    const clientId = this.status?.clientId ?? (this.#deps.clientId || null);
    if (!clientId) {
      this.error = { kind: 'noClientId' };
      return;
    }
    const abort = new AbortController();
    this.#abort = abort;
    this.phase = 'starting';
    try {
      const started = await startDeviceLogin(clientId, this.#flowDeps());
      if (abort.signal.aborted) return;
      if (started.status === 'error') {
        this.error = { kind: 'failed', message: started.message };
        return;
      }
      const { userCode, verificationUri, expiresAt } = started.start;
      this.code = { userCode, verificationUri, expiresAt };
      this.phase = 'waiting';
      const result = await finishDeviceLogin(clientId, started.start, this.#flowDeps(), abort.signal);
      this.code = null;
      if (result.status === 'cancelled') return;
      if (result.status === 'denied' || result.status === 'expired') {
        this.error = { kind: result.status };
        return;
      }
      if (result.status === 'error') {
        this.error = { kind: 'failed', message: result.message };
        return;
      }
      this.phase = 'saving';
      try {
        await writeHelixLogin(dir, result.login);
      } catch {
        this.error = { kind: 'saveFailed' };
        return;
      }
      this.status = { loggedIn: true, login: result.login.login, clientId, userId: result.login.user_id || null, scopes: result.login.scopes };
      this.#deps.enableHelix();
    } finally {
      // a login started after a cancel owns the state now: leave it alone
      if (this.#abort === null || this.#abort === abort) {
        this.#abort = null;
        this.code = null;
        this.phase = 'idle';
      }
    }
  }

  /** Stops a login in progress (no error is shown for it). */
  cancel(): void {
    if (!this.#abort) return;
    this.#abort.abort();
    this.#abort = null;
    this.code = null;
    this.phase = 'idle'; // the unwinding run leaves the state alone (see login's finally)
  }

  async logout(): Promise<void> {
    if (this.phase !== 'idle') return;
    const dir = this.#deps.dir();
    if (!dir) return;
    this.error = null;
    this.phase = 'loggingOut';
    try {
      await logoutHelix(dir, this.#flowDeps());
      this.status = { loggedIn: false, login: null, clientId: this.status?.clientId ?? null, userId: null, scopes: [] };
    } catch {
      this.error = { kind: 'saveFailed' };
    } finally {
      this.phase = 'idle';
    }
  }
}
