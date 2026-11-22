import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openNotices, openSite, pickPluginFolder, test, watchPage } from './harness.ts';

const bell = (page: Page) => page.getByRole('button', { name: /^Уведомления/ });
const popup = (page: Page) => page.getByRole('region', { name: 'Уведомления' });
const scan = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`);

test('no notices: the icon is quiet, the popup says so, Escape and an outside click close it', async ({ page }) => {
  const problems = watchPage(page);
  await openSite(page);
  await pickPluginFolder(page);
  await expect(bell(page)).toHaveAccessibleName('Уведомления: нет');
  await expect(bell(page).locator('.bell-count')).toHaveCount(0);
  await expect(popup(page)).toHaveCount(0);
  await bell(page).click();
  await expect(popup(page)).toContainText('Уведомлений нет.');
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);
  await expect(bell(page)).toBeFocused();
  await bell(page).click();
  await page.getByRole('heading', { name: 'Настройки', level: 1 }).click(); // outside
  await expect(popup(page)).toHaveCount(0);
  await bell(page).click();
  await bell(page).click(); // the icon toggles
  await expect(popup(page)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('an info notice only counts: it does not open the popup by itself, and it is not red', async ({ page }) => {
  await openSite(page, { version: '99.0.0' });
  await pickPluginFolder(page);
  await expect(bell(page)).toHaveAccessibleName('Уведомления: 1');
  await expect(bell(page).locator('.bell-count')).toHaveText('1');
  await expect(bell(page)).not.toHaveClass(/has-error/);
  await expect(popup(page)).toHaveCount(0);
  await openNotices(page);
  await expect(popup(page)).toContainText('Плагин новее, чем это приложение');
  expect(await scan(page)).toEqual([]);
});

test('an error opens the popup once, turns the icon red and is not repeated after closing', async ({ page }) => {
  test.setTimeout(45_000);
  await openSite(page);
  await pickPluginFolder(page);
  await page.getByLabel('Пауза для одного зрителя', { exact: true }).fill('45');
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__busy = true));
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(popup(page).getByRole('alert').filter({ hasText: 'его держит другая программа' })).toBeVisible({ timeout: 15_000 });
  await expect(bell(page)).toHaveClass(/has-error/);
  expect(await scan(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);
  await page.getByLabel('Пауза для одного правила', { exact: true }).fill('11'); // another edit: the same error must not reopen it
  await page.waitForTimeout(400);
  await expect(popup(page)).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('Уведомления: 1');
});

test('the plugin version the site ships with is not "newer than this app" (the warning was always on)', async ({ page }) => {
  const bundled = (JSON.parse(readFileSync(new URL('../../vendor/plugin/VERSION.json', import.meta.url), 'utf8')) as { version: string }).version;
  await openSite(page, { version: bundled });
  await pickPluginFolder(page);
  await expect(bell(page)).toHaveAccessibleName('Уведомления: нет');
  await bell(page).click();
  await expect(popup(page)).not.toContainText('Плагин новее');
});

test('phone width: the popup fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await openSite(page, { version: '99.0.0' });
  await pickPluginFolder(page);
  await openNotices(page);
  const box = await popup(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  // name the culprits in the failure message: this only ever failed on CI, where fonts and scrollbars differ
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    if (de.scrollWidth <= de.clientWidth) return [];
    const out = [`scrollWidth=${de.scrollWidth} clientWidth=${de.clientWidth}`];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const b = el.getBoundingClientRect();
      if (b.right > de.clientWidth + 0.5) out.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className} right=${Math.round(b.right)} width=${Math.round(b.width)}`);
    }
    return out.slice(0, 12);
  });
  expect(overflow).toEqual([]);
});
