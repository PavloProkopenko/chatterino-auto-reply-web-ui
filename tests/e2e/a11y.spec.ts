import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, startApp, test } from './harness.ts';

const scan = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`);

test('no automated accessibility violations on the picker, Settings, banners and dialogs', async ({ page, app }) => {
  await page.goto(app.url);
  await expect(page.getByRole('heading', { name: 'Какой файл настроек редактировать?' })).toBeVisible();
  expect(await scan(page)).toEqual([]);

  await page.getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
  expect(await scan(page)).toEqual([]);

  // an invalid value, a saved banner and the history dialog
  await page.getByLabel('Пауза для одного зрителя', { exact: true }).fill('x');
  await expect(page.getByRole('alert').filter({ hasText: 'Введите число' })).toBeVisible();
  expect(await scan(page)).toEqual([]);
  await page.getByLabel('Пауза для одного зрителя', { exact: true }).fill('45');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  expect(await scan(page)).toEqual([]);
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await scan(page)).toEqual([]);
});

test('everything works with the keyboard alone, focus is visible and the dialog traps and restores focus', async ({ page, app }) => {
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Выбрать' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();

  const gap = page.getByLabel('Пауза для одного зрителя', { exact: true });
  await gap.focus();
  const outline = await gap.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('15');
  await page.keyboard.press('ControlOrMeta+S'); // the save shortcut
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  expect(JSON.parse(await app.read()).per_user_cooldown).toBe(15);

  const historyButton = page.getByRole('button', { name: 'История' });
  await historyButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true); // focus stays inside
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(historyButton).toBeFocused();
});

test('reduced motion removes transitions', async ({ page }) => {
  const app = await startApp();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Выбрать' }).click();
  const duration = await page.getByRole('switch', { name: 'Только когда идёт стрим' }).evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
  await app.stop();
});

test('a skip link is the first tab stop and moves focus to the content', async ({ page, app }) => {
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'К содержимому' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});
