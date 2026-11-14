import { ru } from '../../i18n/ru.ts';
import type { Redeem, Timer } from '../../shared/config.ts';
import type { Features } from '../../shared/features.ts';
import type { MergeNote } from '../../shared/merge.ts';
import { describeDuration } from './duration.ts';

const R = ru.rules.warn;

/** The channel is not in the global channel list (case-insensitive): the item never fires. */
export const channelMissing = (channel: string, channels: string[]): boolean => !channels.some((c) => c.toLowerCase() === channel.toLowerCase()) || channel === '';

export function describeRedeem(r: Redeem): string {
  if (r.action === 'untimeout') return ru.redeems.actionUntimeout;
  return typeof r.seconds === 'number' && r.seconds > 0 ? ru.redeems.actionTimeout(describeDuration(r.seconds)) : ru.redeems.actionTimeoutNoTime;
}

const hasName = (x: { name?: unknown }) => typeof x.name === 'string' && x.name !== '';

/** Features a timer uses that the plugin version cannot handle (conditions are gated on the page itself). */
export function timerGatingProblems(t: Timer, f: Features): string[] {
  const out: string[] = [];
  if (hasName(t) && !f.names) out.push(f.versionKnown ? R.needsName('0.2.1') : R.unknownName);
  const skip = t.skip_mods !== undefined || (Array.isArray(t.skip_users) && t.skip_users.length > 0);
  if (skip && !f.skipUsers) out.push(f.versionKnown ? R.needsSkip('0.5.0') : R.unknownSkip);
  return out;
}

export function redeemGatingProblems(r: Redeem, f: Features): string[] {
  return hasName(r) && !f.names ? [f.versionKnown ? R.needsName('0.2.1') : R.unknownName] : [];
}

/** Ids of timers whose start or stop was overruled because the plugin changed the timer in the meantime. */
export function droppedLiveTimers(notes: MergeNote[]): number[] {
  const ids = new Set<number>();
  for (const n of notes) {
    const m = /^timers\[(\d+)\]\.(?:enabled|started_at|game_id)$/.exec(n.path);
    if (m && n.note.startsWith('live value kept from the plugin')) ids.add(Number(m[1]));
  }
  return [...ids];
}

export const startedText = (seconds: number): string => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(seconds * 1000);
