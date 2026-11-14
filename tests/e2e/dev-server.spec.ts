import { expect, startApp, test, watchPage } from './harness.ts';

// `pnpm dev` serves source modules, not the production bundle. A route or proxy rule that swallows a source path
// (for example /api/... matching a folder named api) leaves a blank page there while the production build works.
test('the Vite dev server renders the app and can reach the API', async ({ page }) => {
  const app = await startApp({ dev: true });
  try {
    const problems = watchPage(page);
    await page.goto(app.url);
    await expect(page.getByRole('heading', { name: 'Какой файл настроек редактировать?' })).toBeVisible();
    await page.getByRole('button', { name: 'Выбрать' }).click();
    await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Пауза для одного зрителя', { exact: true })).toHaveValue('60');
    expect(problems).toEqual([]);
  } finally {
    await app.stop();
  }
});
