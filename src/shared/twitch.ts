/**
 * Twitch login constants shared by the site and checked against the plugin (helix.lua, SCOPES).
 * The Client ID belongs to the owner's registered Twitch application of client type "Public"; it is not a
 * secret (the device-code flow never sends a client secret). The plugin has the same value
 * (`helix.CLIENT_ID`): change both together. A Client ID already stored in data/helix.json takes precedence.
 */
export const TWITCH_CLIENT_ID = '8lfaf5eoy5pom8c3hiqxol2prz6iwo';

/** Read-only scopes: channel point redemptions, moderators, VIPs. Same string as the plugin asks for. */
export const TWITCH_SCOPES = 'channel:read:redemptions moderation:read channel:read:vips';

/** The only Twitch host the site talks to (CSP `connect-src`, tests/e2e/pipeline.spec.ts). */
export const TWITCH_ID_ORIGIN = 'https://id.twitch.tv';
