import { downloadText } from '../data/download.ts';
import { lazyPersistence } from '../data/persistence.ts';
import { createWorkspace } from '../data/workspace.ts';
import { lua } from '../lua.ts';
import { TWITCH_CLIENT_ID } from '../../shared/twitch.ts';
import { Session } from './session.svelte.ts';
import { redeemAddBlock, type AddBlock } from './twitch-gate.ts';
import { TwitchState } from './twitch.svelte.ts';
import { channelValidator, userValidator } from './validators.ts';

// Everything runs in this page: the file layer talks to the browser's file APIs and IndexedDB. The only network traffic
// is the optional Twitch login (id.twitch.tv, see twitch-flow.ts); the config never leaves the browser.
export const session = new Session({ workspace: createWorkspace({ persistence: lazyPersistence(), download: downloadText }) });

/** The Twitch login of the open plugin folder (data/helix.json); a successful login also switches `helix_enabled` on. */
export const twitch = new TwitchState({
  fetch: (input, init) => fetch(input, init),
  dir: () => session.pluginFolder?.dir ?? null,
  clientId: TWITCH_CLIENT_ID,
  enableHelix: () => {
    if (session.current && !session.current.helix_enabled) session.edit((c) => (c.helix_enabled = true));
  },
});

export const nav = $state<{ historyOpen: boolean }>({ historyOpen: false });

export const validateChannel = channelValidator(lua);
export const validateUser = userValidator(lua);

/** Why adding a reward is not possible right now (null: it is). Reactive: call it inside `$derived`. */
export function currentRedeemBlock(): AddBlock {
  return redeemAddBlock({
    folder: session.source?.kind === 'folder',
    helixFeature: session.source?.features.helix === true,
    loggedIn: twitch.loggedIn,
    helixEnabled: session.current?.helix_enabled === true,
  });
}
