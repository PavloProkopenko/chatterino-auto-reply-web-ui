/** Why "add a reward" is not available yet: no Twitch login, or the Twitch API switch is off. */
export type AddBlock = 'login' | 'enable' | null;

/**
 * Rewards need the Twitch API to be reliable (the plugin cannot read the reward's name from chat).
 * The gate only applies where a login is possible: a plugin folder with a plugin that has the Twitch API
 * (0.8.0+). In the demo, with an opened config.json, or with an older plugin nothing is blocked.
 */
export function redeemAddBlock(i: { folder: boolean; helixFeature: boolean; loggedIn: boolean; helixEnabled: boolean }): AddBlock {
  if (!i.folder || !i.helixFeature) return null;
  if (!i.loggedIn) return 'login';
  if (!i.helixEnabled) return 'enable';
  return null;
}
