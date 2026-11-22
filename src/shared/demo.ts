import { formatJson } from './json-style.ts';
import { toPluginShape } from './config.ts';

/** The built-in example for demo mode: plain, harmless, in the plugin's own file style. */
export function demoConfigText(): string {
  const demo = {
    version: 1,
    active_until: 'forever',
    channels: ['streamer'],
    ignore_users: ['nightbot'],
    protect_users: [],
    unprotect_users: [],
    per_user_cooldown: 60,
    per_rule_cooldown: 10,
    global_min_gap: 2,
    only_when_live: false,
    skip_mods: false,
    mute_lurkers: false,
    backfire: true,
    helix_enabled: false,
    next_rule_id: 3,
    rules: [
      { id: 1, name: 'донат', enabled: true, reply: 'Донаты тут: {user}', channels: [], conditions: [{ type: 'word', match: 'донат' }] },
      { id: 2, name: 'плейлист', enabled: true, reply: 'Плейлист в описании стрима', channels: [], conditions: [{ type: 'anyword', match: '!плейлист|!playlist' }] },
    ],
    next_timer_id: 1,
    timers: [],
    next_redeem_id: 1,
    redeems: [],
  };
  return formatJson(toPluginShape(demo), { indent: 2, eol: '\n', trailingNewline: true });
}
