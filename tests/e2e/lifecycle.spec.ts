import { expect, startApp, test } from './harness.ts';

test('closing the tab ends the process; reloading the tab does not', async ({ page }) => {
  test.setTimeout(60_000);
  const app = await startApp({ noExit: false });
  let exitedEarly = false;
  void app.exited.then(() => (exitedEarly = true));
  await page.goto(app.url);
  await expect(page.getByRole('heading', { name: 'Какой файл настроек редактировать?' })).toBeVisible();

  await page.reload(); // bye, then a new tab id: the app must stay up
  await expect(page.getByRole('heading', { name: 'Какой файл настроек редактировать?' })).toBeVisible();
  await page.waitForTimeout(13_000);
  expect(exitedEarly).toBe(false);

  await page.close();
  const code = await Promise.race([app.exited, new Promise<'still-running'>((r) => setTimeout(() => r('still-running'), 25_000))]);
  expect(code).not.toBe('still-running');
});
