import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { SECURITY_HEADERS } from '../../src/shared/security-headers.ts';

test('vercel.json serves exactly the security headers defined in the code', () => {
  const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const all = vercel.headers.find((h) => h.source === '/(.*)');
  expect(all, 'a catch-all header rule').toBeTruthy();
  const served = Object.fromEntries(all!.headers.map((h) => [h.key.toLowerCase(), h.value]));
  expect(served).toEqual(SECURITY_HEADERS);
});
