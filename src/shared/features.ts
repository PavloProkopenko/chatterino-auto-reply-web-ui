/** The newest plugin version this UI knows about (docs/CONTRACT.md section 5). */
export const KNOWN_PLUGIN_VERSION = '0.5.0';

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

const SINCE = { names: '0.2.1', ruleChannels: '0.3.0', timerConditions: '0.4.0', skipUsers: '0.5.0' } as const;

export function featuresFor(version: string | null): Features {
  if (version === null || parse(version) === null) {
    return { versionKnown: false, names: false, ruleChannels: false, timerConditions: false, skipUsers: false, newerThanKnown: false };
  }
  const has = (since: string) => compareVersions(version, since) >= 0;
  return {
    versionKnown: true,
    names: has(SINCE.names),
    ruleChannels: has(SINCE.ruleChannels),
    timerConditions: has(SINCE.timerConditions),
    skipUsers: has(SINCE.skipUsers),
    newerThanKnown: compareVersions(version, KNOWN_PLUGIN_VERSION) > 0,
  };
}
