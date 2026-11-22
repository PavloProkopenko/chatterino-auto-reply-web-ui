import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { TWITCH_CLIENT_ID, TWITCH_ID_ORIGIN, TWITCH_SCOPES } from '../../src/shared/twitch.ts';

const plugin = (name: string) => readFileSync(new URL(`../../vendor/plugin/${name}`, import.meta.url), 'utf8');

test('the built-in Client ID looks like a Twitch Client ID', () => {
  expect(TWITCH_CLIENT_ID).toMatch(/^[a-z0-9]{30}$/);
});

test('the scopes are the ones the plugin asks for (helix.lua)', () => {
  expect(plugin('helix.lua')).toContain(`local SCOPES = "${TWITCH_SCOPES}"`);
});

test('the only Twitch host is the one the CSP allows', () => {
  expect(TWITCH_ID_ORIGIN).toBe('https://id.twitch.tv');
});
