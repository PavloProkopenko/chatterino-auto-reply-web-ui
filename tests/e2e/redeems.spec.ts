import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, pickPluginFolder, sampleConfig, test, type Sandbox } from './harness.ts';

const redeem = (id: number, more: object = {}) => ({ id, channel: 'streamer', title: `Награда ${id}`, action: 'timeout', seconds: 600, enabled: true, ...more });
const REDEEMS = [
  redeem(1, { title: 'Мут' }),
  redeem(2, { title: 'Мут чудили' }), // contains the first title: the first answers
  redeem(3, { title: 'Снять бан', action: 'untimeout', seconds: undefined }),
  redeem(4, { title: 'Тест', channel: 'other' }), // channel not listed
];
const config = (redeems = REDEEMS, more: object = {}) => sampleConfig({ redeems, next_redeem_id: redeems.length + 1, ...more });

const rows = (page: Page) => page.locator('.rule-row');
const save = (page: Page) => page.getByRole('button', { name: 'Сохранить', exact: true });
const saved = async (sandbox: Sandbox) => JSON.parse((await sandbox.read())!) as { redeems: Record<string, unknown>[]; next_redeem_id: number };

async function openRedeems(page: Page, opts: { config?: string; version?: string } = {}) {
  const sandbox = await openSite(page, { config: opts.config ?? config(), ...(opts.version ? { version: opts.version } : {}) });
  await pickPluginFolder(page);
  await page.getByRole('button', { name: 'Награды', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Награды', level: 1 })).toBeVisible();
  return sandbox;
}

test('the list, the safety notes and the plugin\'s own hints', async ({ page }) => {
  await openRedeems(page);
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(0)).toContainText('награда «Мут»');
  await expect(rows(page).nth(0)).toContainText('мут на 10 минут');
  await expect(rows(page).nth(2)).toContainText('снять мут');
  await expect(rows(page).nth(1)).toContainText('название содержит название награды «Мут»');
  await expect(rows(page).nth(3)).toContainText('канала other нет в списке каналов');
  await expect(page.getByText('Нужен аккаунт модератора или стримера')).toBeVisible();
  await expect(page.getByText('Список «Защищённые от мута» пуст')).toBeVisible();
});

test('the protected-list warning goes away when someone is protected', async ({ page }) => {
  await openRedeems(page, { config: config(REDEEMS, { protect_users: ['bot_one'] }) });
  await expect(page.getByText('Нужен аккаунт модератора')).toBeVisible();
  await expect(page.getByText('Список «Защищённые от мута» пуст')).toHaveCount(0);
});

test('create a redeem: the duration is read by the plugin and shown in words; quick buttons; saved with the next id', async ({ page }) => {
  const sandbox = await openRedeems(page);
  await page.getByRole('button', { name: 'Добавить награду' }).click();
  const form = page.getByRole('region', { name: 'Новая награда' });
  await form.getByRole('button', { name: 'Готово' }).click();
  await expect(form.getByText('нужно название награды')).toBeVisible();

  await form.getByLabel('Название награды').fill('Тихий час');
  await form.getByLabel('Время мута').fill('abc');
  await expect(form.getByText('Не получилось прочитать время')).toBeVisible();
  await form.getByLabel('Время мута').fill('1h30m');
  await expect(form.getByText('Это 1 час 30 минут.')).toBeVisible();
  await form.getByRole('button', { name: '1 ч', exact: true }).click();
  await expect(form.getByLabel('Время мута')).toHaveValue('1h');
  await expect(form.getByText('Это 1 час.')).toBeVisible();
  await form.getByLabel('Название', { exact: true }).fill('quiet');
  await form.getByRole('button', { name: 'Готово' }).click();
  await expect(rows(page)).toHaveCount(5);
  await save(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  const s = await saved(sandbox);
  expect(s.next_redeem_id).toBe(6);
  expect(s.redeems[4]).toMatchObject({ id: 5, channel: 'streamer', title: 'Тихий час', action: 'timeout', seconds: 3600, enabled: true, name: 'quiet' });
});

test('the same title twice in a channel is refused; a title that contains an earlier one is only a warning', async ({ page }) => {
  await openRedeems(page);
  await page.getByRole('button', { name: 'Добавить награду' }).click();
  const form = page.getByRole('region', { name: 'Новая награда' });
  await form.getByLabel('Название награды').fill('мут');
  await expect(form.getByText('Такое название уже есть у награды')).toBeVisible();
  await form.getByRole('button', { name: 'Готово' }).click();
  await expect(form.getByText('Исправьте ошибки')).toBeVisible();
  await form.getByLabel('Название награды').fill('Мут на пять');
  await expect(form.getByText('название содержит название награды')).toBeVisible();
  await form.getByRole('button', { name: 'Готово' }).click();
  await expect(rows(page)).toHaveCount(5); // allowed: the page only warns
});

test('a mute over a day asks to confirm; the range ends at 14 days', async ({ page }) => {
  const sandbox = await openRedeems(page);
  await page.getByRole('button', { name: 'Добавить награду' }).click();
  const form = page.getByRole('region', { name: 'Новая награда' });
  await form.getByLabel('Название награды').fill('Долгий');
  await form.getByLabel('Время мута').fill('15d');
  await expect(form.getByText('от 1s до 14d')).toBeVisible();
  await form.getByLabel('Время мута').fill('2d');
  await form.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByRole('dialog')).toContainText('Мут на 2 дня');
  await page.getByRole('dialog').getByRole('button', { name: 'Изменить' }).click();
  await expect(form).toBeVisible(); // back in the form, nothing was added
  await form.getByRole('button', { name: 'Готово' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Да, сохранить' }).click();
  await expect(rows(page)).toHaveCount(5);
  await save(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  expect((await saved(sandbox)).redeems[4]).toMatchObject({ seconds: 172800 });
});

test('switching a redeem to "unmute" drops the duration from the file', async ({ page }) => {
  const sandbox = await openRedeems(page);
  await rows(page).nth(0).getByRole('button', { name: 'Изменить награду «Мут»' }).click();
  const form = page.getByRole('region', { name: 'Награда «Мут»' });
  await form.getByLabel('Снимает мут с названного зрителя').check();
  await expect(form.getByLabel('Время мута')).toHaveCount(0);
  await form.getByRole('button', { name: 'Готово' }).click();
  await save(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  const r = (await saved(sandbox)).redeems[0]!;
  expect(r).toMatchObject({ id: 1, action: 'untimeout' });
  expect(r).not.toHaveProperty('seconds');
});

test('switch, order by buttons and drag, delete with a confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  const sandbox = await openRedeems(page);
  await rows(page).nth(0).getByRole('switch').click();
  await expect(rows(page).nth(0)).toContainText('выключена');
  await rows(page).nth(0).getByRole('button', { name: 'Опустить награду «Мут» ниже' }).click();
  await expect(rows(page).nth(1)).toContainText('награда «Мут»');
  await rows(page).nth(3).dragTo(rows(page).nth(0));
  await rows(page).nth(3).getByRole('button', { name: /Удалить награду/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Удалить награду?');
  await page.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(rows(page)).toHaveCount(3);
  await save(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  const s = await saved(sandbox);
  expect(s.redeems.map((r) => r.id)).toEqual([4, 2, 1]);
  expect(s.redeems[2]).toMatchObject({ enabled: false });
  expect(s.next_redeem_id).toBe(5);
});

test('accessibility: the list, the constructor, the long-mute confirmation; the keyboard keeps its place', async ({ page }) => {
  await openRedeems(page);
  const scan = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`);
  expect(await scan()).toEqual([]);
  await rows(page).nth(0).getByRole('button', { name: 'Изменить награду «Мут»' }).click();
  await expect(page.getByRole('region', { name: 'Награда «Мут»' })).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.getByLabel('Время мута').fill('2d');
  await page.getByRole('region', { name: 'Награда «Мут»' }).getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('region', { name: 'Награда «Мут»' }).getByRole('button', { name: 'Отмена' }).last().click();
  await rows(page).nth(0).getByRole('button', { name: 'Опустить награду «Мут» ниже' }).focus();
  await page.keyboard.press('Enter');
  await expect(rows(page).nth(1).getByRole('button', { name: 'Опустить награду «Мут» ниже' })).toBeFocused();
});
