/**
 * Fallback for "the newest plugin version this UI knows about" (docs/CONTRACT.md section 5).
 * The app passes the bundled plugin version instead (`featuresFor(v, pluginBundle.version)`), so this
 * cannot go stale again: the UI understands exactly the plugin it ships with.
 */
export const KNOWN_PLUGIN_VERSION = '0.9.0';

export interface Features {
  versionKnown: boolean;
  /** Names on rules, timers and redeems. */
  names: boolean;
  /** Per-rule channel scope (`channels` on a rule). */
  ruleChannels: boolean;
  /** Timer `conditions[]`. */
  timerConditions: boolean;
  /** `skip_mods` and `skip_users`. */
  skipUsers: boolean;
  /** The plugin re-reads config.json by itself (no /autoreply reload), since 0.7.0. */
  autoReload: boolean;
  /** Opt-in Twitch API (`helix_enabled`, data/helix.json), since 0.8.0. */
  helix: boolean;
  /** `unprotect_users`: explicit mute exceptions that beat badges and the protected list, since 0.9.0. */
  protectOverride: boolean;
  /** The plugin re-reads data/helix.json while running (a login made on the site needs no restart), since 0.8.2. */
  helixSync: boolean;
  /** The plugin is newer than this UI: unknown fields are preserved but may not be editable. */
  newerThanKnown: boolean;
}

function parse(v: string): number[] | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

export function compareVersions(a: string, b: string): number {
  const pa = parse(a) ?? [0, 0, 0];
  const pb = parse(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

const SINCE = { names: '0.2.1', ruleChannels: '0.3.0', timerConditions: '0.4.0', skipUsers: '0.5.0', autoReload: '0.7.0', helix: '0.8.0', helixSync: '0.8.2', protectOverride: '0.9.0' } as const;

export function featuresFor(version: string | null, known: string = KNOWN_PLUGIN_VERSION): Features {
  if (version === null || parse(version) === null) {
    return { versionKnown: false, names: false, ruleChannels: false, timerConditions: false, skipUsers: false, autoReload: false, helix: false, helixSync: false, protectOverride: false, newerThanKnown: false };
  }
  const has = (since: string) => compareVersions(version, since) >= 0;
  return {
    versionKnown: true,
    names: has(SINCE.names),
    ruleChannels: has(SINCE.ruleChannels),
    timerConditions: has(SINCE.timerConditions),
    skipUsers: has(SINCE.skipUsers),
    autoReload: has(SINCE.autoReload),
    helix: has(SINCE.helix),
    helixSync: has(SINCE.helixSync),
    protectOverride: has(SINCE.protectOverride),
    newerThanKnown: compareVersions(version, known) > 0,
  };
}
