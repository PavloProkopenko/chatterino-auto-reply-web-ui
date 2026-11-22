import { SCOPE_MODERATED_CHANNELS } from '../../shared/twitch.ts';
import { HelixApiError, moderatedChannels } from '../data/helix-api.ts';
import { withHelixToken, type HelixStatus } from '../data/helix-file.ts';
import type { PluginDir } from '../data/ports.ts';

export type ModCheckResult =
  | { channel: string; account: string; kind: 'owner' | 'moderator' | 'notModerator' | 'needsRelogin' }
  | { channel: string; account: string; kind: 'error'; reason: 'expired' | 'network' | 'notLoggedIn' | 'other'; message?: string };

export interface ModCheckDeps {
  dir: () => PluginDir | null;
  fetch: typeof fetch;
  /** The Twitch login of the open folder (read from helix.json by `TwitchState`). */
  status: () => HelixStatus | null;
}

const norm = (channel: string) => channel.trim().replace(/^#/, '').toLowerCase();

/**
 * "Am I a moderator on this channel?", asked on demand. The owner needs no request; anyone else is looked up
 * among the channels the account moderates (scope `user:read:moderated_channels`).
 * A result belongs to one channel and one account: `passes` is false as soon as either changes.
 */
export class ModCheck {
  result = $state.raw<ModCheckResult | null>(null);
  checking = $state(false);

  readonly #deps: ModCheckDeps;

  constructor(deps: ModCheckDeps) {
    this.#deps = deps;
  }

  /** True when the last check of exactly this channel, by exactly this account, found an owner or a moderator. */
  passes(channel: string): boolean {
    const r = this.result;
    const account = this.#deps.status()?.login ?? null;
    return r !== null && account !== null && r.account === account && r.channel === norm(channel) && (r.kind === 'owner' || r.kind === 'moderator');
  }

  reset(): void {
    this.result = null;
  }

  async run(channelName: string): Promise<void> {
    if (this.checking) return;
    const channel = norm(channelName);
    const status = this.#deps.status();
    const account = status?.login ?? '';
    const done = (r: Omit<ModCheckResult, 'channel' | 'account'> & Partial<ModCheckResult>) => void (this.result = { ...r, channel, account } as ModCheckResult);
    if (!status?.loggedIn || !account) return done({ kind: 'error', reason: 'notLoggedIn' });
    if (channel === account) return done({ kind: 'owner' });
    if (!status.scopes.includes(SCOPE_MODERATED_CHANNELS)) return done({ kind: 'needsRelogin' });
    const dir = this.#deps.dir();
    if (!dir) return done({ kind: 'error', reason: 'notLoggedIn' });
    this.checking = true;
    this.result = null;
    try {
      const out = await withHelixToken(dir, (auth) => moderatedChannels({ fetch: this.#deps.fetch }, auth));
      if (out.status === 'notLoggedIn') return done({ kind: 'error', reason: 'notLoggedIn' });
      done({ kind: out.value.includes(channel) ? 'moderator' : 'notModerator' });
    } catch (e) {
      if (e instanceof HelixApiError) {
        if (e.kind === 'scope') return done({ kind: 'needsRelogin' });
        if (e.kind === 'expired' || e.kind === 'network') return done({ kind: 'error', reason: e.kind });
        return done({ kind: 'error', reason: 'other', message: e.message });
      }
      done({ kind: 'error', reason: 'other', message: 'unexpected error' });
    } finally {
      this.checking = false;
    }
  }
}
