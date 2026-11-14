import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, pickPluginFolder, sampleConfig, test, watchPage } from './harness.ts';

const rule = (id: number, reply: string, match: string, more: object = {}) => ({ id, enabled: true, reply, channels: [], conditions: [{ type: 'word', match }], ...more });
const config = () =>
  sampleConfig({
    rules: [rule(1, 'Привет, {user}!', 'привет'), rule(2, 'Донат', 'донат', { name: 'donate' })],
    next_rule_id: 3,
    timers: [{ id: 1, channel: 'streamer', reply: 'играет {time}', format: 'smart', on_category: 'reset', conditions: [{ type: 'word', match: '!game' }], enabled: true, started_at: 1_800_000_000 }],
    next_timer_id: 2,
    redeems: [{ id: 1, channel: 'streamer', title: 'Мут', action: 'timeout', seconds: 600, enabled: true }],
    next_redeem_id: 2,
  });

async function open(page: Page, section?: string) {
  await openSite(page, { config: config() });
  await pickPluginFolder(page);
  if (section) await page.getByRole('button', { name: section, exact: true }).click();
}
const previewButton = (page: Page) => page.getByRole('button', { name: 'Проверка', exact: true });

test('add and edit open their own page; Back link and the browser Back both return', async ({ page }) => {
  const problems = watchPage(page);
  await open(page, 'Правила');
  await expect(page).toHaveURL(/#\/rules$/);
  await page.getByRole('button', { name: 'Добавить правило' }).click();
  await expect(page).toHaveURL(/#\/rules\/new$/);
  await expect(page.getByRole('region', { name: 'Новое правило' })).toBeVisible();
  await expect(page.locator('.rule-row')).toHaveCount(0); // a page of its own, not a side panel
  await page.getByRole('button', { name: 'К разделу «Правила»' }).click();
  await expect(page).toHaveURL(/#\/rules$/);
  await expect(page.locator('.rule-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Изменить правило donate' }).click();
  await expect(page).toHaveURL(/#\/rules\/2$/);
  await expect(page.getByRole('region', { name: 'Правило donate' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/rules$/);
  await expect(page.getByRole('heading', { name: 'Правила', level: 1 })).toBeVisible();
  expect(problems).toEqual([]);
});

test('a reload on an editor URL returns to the same editor; an unknown id falls back to the list', async ({ page }) => {
  await open(page, 'Правила');
  await page.getByRole('button', { name: 'Изменить правило donate' }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Правило donate' })).toBeVisible();
  await page.evaluate(() => (location.hash = '#/rules/99'));
  await expect(page.getByRole('heading', { name: 'Правила', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/#\/rules$/);
  await page.evaluate(() => (location.hash = '#/nonsense'));
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
});

test('done and cancel leave the editor for the list', async ({ page }) => {
  await open(page, 'Правила');
  await page.getByRole('button', { name: 'Изменить правило donate' }).click();
  const form = page.getByRole('region', { name: 'Правило donate' });
  await form.getByRole('button', { name: 'Отмена' }).last().click();
  await expect(page).toHaveURL(/#\/rules$/);
  await page.getByRole('button', { name: 'Изменить правило donate' }).click();
  await form.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(/#\/rules$/);
  await expect(page.locator('.rule-row')).toHaveCount(2);
});

test('timers and redeems have their own pages too', async ({ page }) => {
  await open(page, 'Таймеры');
  await page.getByRole('button', { name: 'Добавить таймер' }).click();
  await expect(page).toHaveURL(/#\/timers\/new$/);
  await expect(page.getByRole('region', { name: 'Новый таймер' })).toBeVisible();
  await page.getByRole('button', { name: 'К разделу «Таймеры»' }).click();
  await page.getByRole('button', { name: 'Награды', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить награду' }).click();
  await expect(page).toHaveURL(/#\/redeems\/new$/);
  await expect(page.getByRole('region', { name: 'Новая награда' })).toBeVisible();
  await page.getByRole('button', { name: 'К разделу «Награды»' }).click();
  await expect(page.getByRole('heading', { name: 'Награды', level: 1 })).toBeVisible();
});

test('the Проверка button: lists of rules and timers and both editors, not redeems; it is a modal and keeps what was typed', async ({ page }) => {
  await open(page, 'Правила');
  await expect(previewButton(page)).toBeVisible();
  await previewButton(page).click();
  const dlg = page.getByRole('dialog', { name: 'Проверка' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Подставить пример для этого правила' })).toHaveCount(0); // lists have no draft
  await dlg.getByLabel('Сообщение в чате').fill('привет');
  await dlg.getByLabel('Ник зрителя').fill('Вася');
  await expect(dlg.getByText('Ответит правило № 1')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);

  await page.getByRole('button', { name: 'Изменить правило donate' }).click();
  await previewButton(page).click();
  await expect(dlg.getByLabel('Сообщение в чате')).toHaveValue('привет'); // survives the move to another page
  await expect(dlg.getByLabel('Ник зрителя')).toHaveValue('Вася');
  await expect(dlg.getByRole('button', { name: 'Подставить пример для этого правила' })).toBeVisible(); // the draft can be checked
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'К разделу «Правила»' }).click();
  await page.getByRole('button', { name: 'Таймеры', exact: true }).click();
  await expect(previewButton(page)).toBeVisible();
  await page.getByRole('button', { name: 'Награды', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Награды', level: 1 })).toBeVisible();
  await expect(previewButton(page)).toHaveCount(0);
});

test('the chips have room above and below (channels on Settings)', async ({ page }) => {
  await open(page);
  const gaps = await page.evaluate(() => {
    const chips = document.querySelector('.chips')!;
    const help = chips.previousElementSibling!.getBoundingClientRect();
    const input = chips.nextElementSibling!.getBoundingClientRect();
    const c = chips.getBoundingClientRect();
    return { above: c.top - help.bottom, below: input.top - c.bottom };
  });
  expect(gaps.above).toBeGreaterThanOrEqual(12);
  expect(gaps.below).toBeGreaterThanOrEqual(12);
});

test('accessibility: an editor page and the modal', async ({ page }) => {
  await open(page, 'Правила');
  const scan = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`);
  await page.getByRole('button', { name: 'Изменить правило donate' }).click();
  await expect(page.getByRole('region', { name: 'Правило donate' })).toBeVisible();
  expect(await scan()).toEqual([]);
  await previewButton(page).click();
  await expect(page.getByRole('dialog', { name: 'Проверка' })).toBeVisible();
  expect(await scan()).toEqual([]);
});
