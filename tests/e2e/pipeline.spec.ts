import { expect, test, watchPage } from './harness.ts';

test('the built page loads under the strict CSP and the Lua worker answers', async ({ page, app }) => {
  const problems = watchPage(page);
  await page.goto(app.url);
  await expect(page.getByRole('heading', { name: 'Какой файл настроек редактировать?' })).toBeVisible();
  const answer = await page.evaluate(() =>
    (window as unknown as { __e2e: { lua: { call(m: string, f: string, ...a: unknown[]): Promise<unknown[]> } } }).__e2e.lua.call(
      'rules', 'matches_one', { type: 'word', match: 'донат' }, 'нука, донат', 0, 'me'),
  );
  expect(answer).toEqual([true]);
  expect(problems).toEqual([]);
});

test('a runaway Lua pattern in a real browser Worker is stopped and the page stays usable', async ({ page, app }) => {
  const problems = watchPage(page);
  await page.goto(app.url);
  const outcome = await page.evaluate(async () => {
    const lua = (window as unknown as { __e2e: { lua: { call(m: string, f: string, ...a: unknown[]): Promise<unknown[]> } } }).__e2e.lua;
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
