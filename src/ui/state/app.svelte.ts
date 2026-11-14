import { createClient, readToken } from '../api/client.ts';
import { lua } from '../lua.ts';
import { Session } from './session.svelte.ts';
import { channelValidator, userValidator } from './validators.ts';

export const client = createClient(readToken());
export const session = new Session({ api: client });

export const nav = $state({ historyOpen: false, showPath: false });

export const validateChannel = channelValidator(lua);
export const validateUser = userValidator(lua);

/** Tells the server this tab is alive so it can exit by itself when the last tab closes. */
export function startLifecycle(): void {
  const tab = crypto.randomUUID();
  const beat = () => void client.heartbeat(tab).catch(() => undefined);
  beat();
  setInterval(beat, 10_000);
  // A reload or a bfcache restore comes back with a fresh pagehide/pageshow pair: say bye, then beat again.
  addEventListener('pagehide', () => client.bye(tab));
  addEventListener('pageshow', (e) => {
    if (e.persisted) beat();
  });
}
