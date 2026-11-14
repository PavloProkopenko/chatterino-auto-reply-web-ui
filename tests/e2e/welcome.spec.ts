import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSection, openSite, test, watchPage } from './harness.ts';

const head = (page: Page, title: string) => page.getByRole('button', { name: title });
const TITLES = ['Моя папка плагина (по ссылке)', 'Установить плагин и подключить', 'Открыть config.json (любой браузер)', 'Попробовать на примере'];
const expanded = async (page: Page) => Promise.all(TITLES.map(async (t) => (await head(page, t).getAttribute('aria-expanded')) === 'true'));

test('with direct access the linked folder is open first and only one section is open at a time', async ({ page }) => {
  const problems = watchPage(page);
  await openSite(page, { install: false });
  expect(await expanded(page)).toEqual([true, false, false, false]);
  await expect(page.getByRole('button', { name: 'Выбрать папку плагина напрямую' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть пример' })).toBeHidden();

  await head(page, TITLES[3]!).click();
  expect(await expanded(page)).toEqual([false, false, false, true]);
  await expect(page.getByRole('button', { name: 'Открыть пример' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать папку плагина напрямую' })).toBeHidden();

  await head(page, TITLES[3]!).click(); // a second click closes it
  expect(await expanded(page)).toEqual([false, false, false, false]);
  expect(problems).toEqual([]);
});

test('without direct access the folder sections are disabled with a reason and "any browser" is open', async ({ page }) => {
  await openSite(page, { direct: false, install: false });
  expect(await expanded(page)).toEqual([false, false, true, false]);
  for (const t of [TITLES[0]!, TITLES[1]!]) {
    await expect(head(page, t)).toHaveAttribute('aria-disabled', 'true');
    await head(page, t).click({ force: true }); // Playwright treats aria-disabled as not clickable; a real click must do nothing
    await expect(head(page, t)).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(page.getByText('Нужен Chrome или Edge').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать папку плагина напрямую' })).toHaveCount(0);
  await expect(page.getByText('Открыть config.json', { exact: true })).toBeVisible();
});

test('the keyboard opens and closes sections', async ({ page }) => {
  await openSite(page, { install: false });
  await head(page, TITLES[2]!).focus();
  await page.keyboard.press('Enter');
  expect(await expanded(page)).toEqual([false, false, true, false]);
  await head(page, TITLES[1]!).focus();
  await page.keyboard.press('Space');
  expect(await expanded(page)).toEqual([false, true, false, false]);
});

test('a folder the browser refuses is explained inside the linked-folder section, which opens by itself', async ({ page }) => {
  await openSite(page, { install: false });
  await openSection(page, TITLES[3]!); // the user is elsewhere when the pick fails
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => {
      throw new DOMException('system folder', 'SecurityError');
    };
  });
  await openSection(page, TITLES[0]!);
  await page.getByRole('button', { name: 'Выбрать папку плагина напрямую' }).click();
  const region = page.getByRole('region', { name: /Моя папка плагина/ });
  await expect(region.getByRole('alert')).toContainText('системные папки');
  expect(await expanded(page)).toEqual([true, false, false, false]);
});

test('the install section shows the folder picker and the welcome screen has no accessibility violations in any section', async ({ page }) => {
  await openSite(page, { install: false });
  for (const t of TITLES) {
    await openSection(page, t);
    const found = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.help}`);
    expect(found, t).toEqual([]);
  }
  await openSection(page, TITLES[1]!);
  await expect(page.getByRole('button', { name: 'Выбрать папку для плагина' })).toBeVisible();
});

test('phone width: no horizontal scroll with any section open', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await openSite(page, { install: false });
  for (const t of TITLES) {
    await openSection(page, t);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, t).toBe(false);
  }
});
