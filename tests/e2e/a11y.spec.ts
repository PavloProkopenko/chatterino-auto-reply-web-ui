import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, pickPluginFolder, sampleConfig, test } from './harness.ts';

const scan = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`);

test('no automated accessibility violations on every screen: welcome, fallback, permission, Settings, banners, dialogs', async ({ page }) => {
  await openSite(page);
  await expect(page.getByRole('heading', { name: 'С чего начнём?' })).toBeVisible();
  expect(await scan(page)).toEqual([]);

  await pickPluginFolder(page);
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

test('accessibility of the permission, fallback, demo and failure screens', async ({ page, browser }) => {
  await openSite(page);
  await pickPluginFolder(page);
  await page.evaluate(() => sessionStorage.setItem('__perm', 'prompt'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Продолжить с «plugin»?' })).toBeVisible();
  expect(await scan(page)).toEqual([]);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
  await page.getByLabel('Пауза для одного зрителя', { exact: true }).fill('45');
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__denied = true));
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'нет разрешения' })).toBeVisible();
  expect(await scan(page)).toEqual([]);

  // a fresh context: storage is shared inside one, and this tab must not find the folder remembered above
  const fallback = await (await browser.newContext({ locale: 'ru-RU', colorScheme: 'dark', baseURL: 'http://127.0.0.1:4173' })).newPage();
  await fallback.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showDirectoryPicker;
    delete w.showOpenFilePicker;
  });
  await fallback.goto('/');
  await expect(fallback.getByText('Открыть config.json').first()).toBeVisible();
  expect(await scan(fallback)).toEqual([]);
  await fallback.getByRole('button', { name: 'Попробовать на примере' }).click();
  await expect(fallback.getByText('Это пример: ничего не читается')).toBeVisible();
  expect(await scan(fallback)).toEqual([]);
});

test('accessibility of the download flow: the re-open dialog and the "put the file back" banner', async ({ page }) => {
  await openSite(page, { install: false });
  await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles({ name: 'config.json', mimeType: 'application/json', buffer: Buffer.from(sampleConfig()) });
  await expect(page.getByText('Версия плагина неизвестна, поэтому')).toBeVisible();
  expect(await scan(page)).toEqual([]);
  await page.getByLabel('Пауза для одного зрителя', { exact: true }).fill('45');
  await page.getByRole('button', { name: 'Сохранить и скачать' }).click();
  await expect(page.getByRole('dialog', { name: 'Откройте актуальный config.json' })).toBeVisible();
  expect(await scan(page)).toEqual([]);
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'config.json', mimeType: 'application/json', buffer: Buffer.from(sampleConfig()) });
  await expect(page.getByText('Файл скачан.')).toBeVisible();
  expect(await scan(page)).toEqual([]);
});

test('everything works with the keyboard alone, focus is visible and the dialog traps and restores focus', async ({ page }) => {
  const sandbox = await openSite(page);
  await page.getByRole('button', { name: 'Выбрать папку плагина' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();

  const gap = page.getByLabel('Пауза для одного зрителя', { exact: true });
  await gap.focus();
  expect(await gap.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('15');
  await page.keyboard.press('ControlOrMeta+S'); // the save shortcut
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  expect(JSON.parse((await sandbox.read())!).per_user_cooldown).toBe(15);

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
  await openSite(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pickPluginFolder(page);
  const duration = await page.getByRole('switch', { name: 'Только когда идёт стрим' }).evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});

test('a skip link is the first tab stop and moves focus to the content', async ({ page }) => {
  await openSite(page);
  await pickPluginFolder(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'К содержимому' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});
