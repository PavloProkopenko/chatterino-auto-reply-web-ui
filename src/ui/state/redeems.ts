import type { Config } from '../../shared/config.ts';
import { saveItem } from './lists.ts';

export interface RedeemFields {
  name?: string;
  channel: string;
  title: string;
  action: string;
  seconds?: number;
  enabled: boolean;
  [key: string]: unknown;
}
export type RedeemDraft = RedeemFields & { id?: number };

export const REDEEM_ACTIONS = ['timeout', 'untimeout'] as const;

export function emptyRedeem(channel = ''): RedeemFields {
  return { channel, title: '', action: 'timeout', seconds: 600, enabled: true };
}

/** Adds a redeem or replaces one in place. A name or duration the edit no longer has is removed. */
export function saveRedeem(cfg: Config, redeem: RedeemDraft): number {
  const draft: RedeemDraft = { ...redeem };
  if (draft.action === 'untimeout') delete draft.seconds;
  return saveItem(cfg, 'redeems', draft, ['name', 'seconds']);
}

export function setRedeemEnabled(cfg: Config, id: number, enabled: boolean): void {
  const r = cfg.redeems.find((x) => x.id === id);
  if (r) r.enabled = enabled;
}
