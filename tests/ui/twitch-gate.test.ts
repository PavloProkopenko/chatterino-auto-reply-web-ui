import { describe, expect, test } from 'vitest';
import { redeemAddBlock } from '../../src/ui/state/twitch-gate.ts';

const base = { folder: true, helixFeature: true, loggedIn: true, helixEnabled: true };

describe('redeemAddBlock', () => {
  test('open: a folder with a Twitch-capable plugin, logged in, Twitch API on', () => {
    expect(redeemAddBlock(base)).toBeNull();
  });
  test('not logged in: blocked, and that is reported before the switch', () => {
    expect(redeemAddBlock({ ...base, loggedIn: false })).toBe('login');
    expect(redeemAddBlock({ ...base, loggedIn: false, helixEnabled: false })).toBe('login');
  });
  test('logged in but the Twitch API switch is off: blocked with its own reason', () => {
    expect(redeemAddBlock({ ...base, helixEnabled: false })).toBe('enable');
  });
  test('never blocks where a login is impossible: demo, opened file, upload, or a plugin older than 0.8.0', () => {
    expect(redeemAddBlock({ ...base, folder: false, loggedIn: false, helixEnabled: false })).toBeNull();
    expect(redeemAddBlock({ ...base, helixFeature: false, loggedIn: false, helixEnabled: false })).toBeNull();
  });
});
