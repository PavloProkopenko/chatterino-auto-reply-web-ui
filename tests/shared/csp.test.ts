import { expect, test } from 'vitest';
import { CSP } from '../../src/shared/security-headers.ts';

const directive = (name: string) => CSP.split('; ').find((d) => d.startsWith(name + ' '))?.slice(name.length + 1);

test('the only host the page may talk to is id.twitch.tv (the Twitch login); everything else stays on its own origin', () => {
  expect(directive('connect-src')).toBe("'self' https://id.twitch.tv");
});

test('no wildcard or other network host anywhere in the policy', () => {
  expect(CSP).not.toMatch(/\*/);
  expect(CSP).not.toContain('api.twitch.tv');
  const hosts = CSP.match(/https?:\/\/[^\s;]+/g) ?? [];
  expect(hosts).toEqual(['https://id.twitch.tv']);
  expect(directive('default-src')).toBe("'none'");
  expect(directive('script-src')).toBe("'self' 'wasm-unsafe-eval'");
});
