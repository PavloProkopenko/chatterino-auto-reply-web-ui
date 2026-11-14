import { expect, openSite, test, watchPage } from './harness.ts';

type Lua = { call(m: string, f: string, ...a: unknown[]): Promise<unknown[]> };

test('the built page loads under the strict CSP and the Lua worker answers', async ({ page }) => {
  const problems = watchPage(page);
  await openSite(page);
  await expect(page.getByRole('heading', { name: 'С чего начнём?' })).toBeVisible();
  const answer = await page.evaluate(() => (window as unknown as { __e2e: { lua: Lua } }).__e2e.lua.call('rules', 'matches_one', { type: 'word', match: 'донат' }, 'нука, донат', 0, 'me'));
  expect(answer).toEqual([true]);
  expect(problems).toEqual([]);
});

test('a runaway Lua pattern in a real browser Worker is stopped and the page stays usable', async ({ page }) => {
  const problems = watchPage(page);
  await openSite(page);
  const outcome = await page.evaluate(async () => {
    const lua = (window as unknown as { __e2e: { lua: Lua } }).__e2e.lua;
    const t0 = performance.now();
    let error = '';
    try {
      await lua.call('rules', 'matches_one', { type: 'pattern', match: 'a-a-a-a-a-a-a-a-a-a-b' }, 'a'.repeat(300), 0, 'me');
    } catch (e) {
      error = (e as Error).name;
    }
    const elapsed = performance.now() - t0;
    const after = await lua.call('rules', 'matches_one', { type: 'word', match: 'ок' }, 'ок', 0, 'me');
    return { error, elapsed, after };
  });
  expect(outcome.error).toBe('LuaTimeoutError');
  expect(outcome.elapsed).toBeLessThan(4000);
  expect(outcome.after).toEqual([true]);
  expect(problems).toEqual([]);
});

test('the page talks to nobody: every request goes to its own origin, nothing to an API', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  const sandbox = await openSite(page);
  await page.getByRole('button', { name: 'Выбрать папку плагина' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
  await page.getByLabel('Пауза для одного зрителя', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(JSON.parse((await sandbox.read())!).per_user_cooldown).toBe(30);
  const origin = new URL(page.url()).origin;
  const foreign = urls.filter((u) => !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:'));
  expect(foreign).toEqual([]);
  expect(urls.filter((u) => u.includes('/api'))).toEqual([]);
});
