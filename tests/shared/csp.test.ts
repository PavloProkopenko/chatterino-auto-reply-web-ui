import { expect, test } from 'vitest';
import { CSP } from '../../src/shared/security-headers.ts';

const directive = (name: string) => CSP.split('; ').find((d) => d.startsWith(name + ' '))?.slice(name.length + 1);

test('the only hosts the page may talk to are id.twitch.tv (login) and api.twitch.tv (mod check, mod/VIP lists)', () => {
  expect(directive('connect-src')).toBe("'self' https://id.twitch.tv https://api.twitch.tv");
});

test('no wildcard or other network host anywhere in the policy', () => {
  expect(CSP).not.toMatch(/\*/);
  const hosts = CSP.match(/https?:\/\/[^\s;]+/g) ?? [];
  expect(hosts).toEqual(['https://id.twitch.tv', 'https://api.twitch.tv']);
  expect(directive('default-src')).toBe("'none'");
  expect(directive('script-src')).toBe("'self' 'wasm-unsafe-eval'");
});
