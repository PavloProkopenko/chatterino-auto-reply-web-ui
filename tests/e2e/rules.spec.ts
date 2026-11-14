import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, pickPluginFolder, sampleConfig, test, watchPage, type Sandbox } from './harness.ts';

const rule = (id: number, reply: string, conditions: object[], more: object = {}) => ({ id, enabled: true, reply, channels: [], conditions, ...more });
const RULES = [
  rule(1, 'Привет, {user}!', [{ type: 'word', match: 'привет' }]),
  rule(2, 'Донат: example.com/d', [{ type: 'keyword', match: 'донат' }], { name: 'donate' }),
  rule(3, 'Донаты тут', [{ type: 'word', match: 'донат' }]),
  rule(4, 'Только в другом канале', [{ type: 'word', match: 'секрет' }], { channels: ['other'] }),
  rule(5, '/ban x', [{ type: 'word', match: 'икс' }]),
];
const config = (rules = RULES) => sampleConfig({ rules, next_rule_id: rules.length + 1 });

const rows = (page: Page) => page.locator('.rule-row');
const save = (page: Page) => page.getByRole('button', { name: 'Сохранить', exact: true });
const savedRules = async (sandbox: Sandbox) => (JSON.parse((await sandbox.read())!) as { rules: { id: number; enabled: boolean; name?: string; reply: string }[]; next_rule_id: number });
const ids = async (sandbox: Sandbox) => (await savedRules(sandbox)).rules.map((r) => r.id);

async function openRules(page: Page, opts: { config?: string; version?: string } = {}) {
  const sandbox = await openSite(page, { config: opts.config ?? config(), ...(opts.version ? { version: opts.version } : {}) });
  await pickPluginFolder(page);
  await page.getByRole('button', { name: 'Правила', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Правила', level: 1 })).toBeVisible();
  return sandbox;
}

test('the list shows the rules in order, with hints from the plugin\'s own checks', async ({ page }) => {
  const problems = watchPage(page);
  await openRules(page);
  await expect(rows(page)).toHaveCount(5);
  await expect(rows(page).nth(0)).toContainText('№ 1');
  await expect(rows(page).nth(1)).toContainText('donate: Донат: example.com/d');
  await expect(rows(page).nth(1)).toContainText('содержит «донат»');
  await expect(page.getByText('первое подходящее')).toBeVisible();
  // rule 3 ("word донат") is caught by rule 2 ("keyword донат"); rule 4 is bound to a channel that is not listed; rule 5 would be refused
  await expect(rows(page).nth(2)).toContainText('Возможно, не срабатывает');
  await expect(rows(page).nth(2)).toContainText('donate');
  await expect(rows(page).nth(3)).toContainText('канала other нет в списке каналов');
  await expect(rows(page).nth(4)).toContainText('не должен начинаться с «/»');
  await expect(rows(page).nth(0).locator('.warn-line')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('create a rule: the constructor validates with the plugin, the new rule gets the next id and is saved', async ({ page }) => {
  const sandbox = await openRules(page);
  await page.getByRole('button', { name: 'Добавить правило' }).click();
  const form = page.getByRole('region', { name: 'Новое правило' });
  await expect(form).toBeVisible();

  // an empty rule is refused with the plugin's own messages
  await form.getByRole('button', { name: 'Готово' }).click();
  await expect(form.getByText('нужен непустой текст для поиска')).toBeVisible();
  await expect(form.getByText('нужен текст ответа')).toBeVisible();
  await expect(rows(page)).toHaveCount(5);

  await form.getByLabel('Текст', { exact: true }).fill('пока');
  await form.getByLabel('Ответ', { exact: true }).fill('Пока, ');
  await form.getByRole('button', { name: 'Вставить {user}' }).click();
  await expect(form.getByLabel('Ответ', { exact: true })).toHaveValue('Пока, {user}');
  await form.getByRole('button', { name: 'Подобрать' }).click();
  await expect(form.getByLabel('Название', { exact: true })).toHaveValue('Пока');
  await expect(form.getByText('16 из 500 байт')).toBeVisible(); // bytes, as the plugin counts: Cyrillic letters take two
  await form.getByRole('button', { name: 'Готово' }).click();

  await expect(rows(page)).toHaveCount(6);
  await expect(rows(page).nth(5)).toContainText('Пока: Пока, {user}');
  await save(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  const saved = await savedRules(sandbox);
  expect(saved.next_rule_id).toBe(7);
  expect(saved.rules.at(-1)).toMatchObject({ id: 6, enabled: true, name: 'Пока', reply: 'Пока, {user}', conditions: [{ type: 'word', match: 'пока' }] });
  expect(saved.rules.slice(0, 5).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]); // nothing else moved
});

test('a name that is taken or not allowed is refused by the plugin\'s rules', async ({ page }) => {
  await openRules(page);
  await rows(page).nth(0).getByRole('button', { name: 'Изменить правило #1' }).click();
  const form = page.getByRole('region', { name: 'Правило #1' });
  await form.getByLabel('Название', { exact: true }).fill('DONATE');
  await expect(form.getByText('уже занято')).toBeVisible();
  await form.getByLabel('Название', { exact: true }).fill('bad name!');
  await expect(form.getByText('в имени можно использовать только')).toBeVisible();
  await form.getByRole('button', { name: 'Готово' }).click();
  await expect(form.getByText('Исправьте ошибки')).toBeVisible();
});

test('editing a rule is one undo step; cancel changes nothing', async ({ page }) => {
  await openRules(page);
  await rows(page).nth(0).getByRole('button', { name: 'Изменить правило #1' }).click();
  let form = page.getByRole('region', { name: 'Правило #1' });
  await form.getByLabel('Ответ', { exact: true }).fill('Здравствуй!');
  await form.getByRole('button', { name: 'Отмена' }).last().click();
  await expect(rows(page).nth(0)).toContainText('Привет, {user}!');
  await expect(page.getByText('Все изменения сохранены')).toBeVisible();

  await rows(page).nth(0).getByRole('button', { name: 'Изменить правило #1' }).click();
  form = page.getByRole('region', { name: 'Правило #1' });
  await form.getByLabel('Ответ', { exact: true }).fill('Здравствуй!');
  await form.getByRole('button', { name: 'Готово' }).click();
  await expect(rows(page).nth(0)).toContainText('Здравствуй!');
  await page.getByRole('button', { name: 'Шаг назад' }).click();
  await expect(rows(page).nth(0)).toContainText('Привет, {user}!');
});

test('conditions chain: add "и ещё", pick a flag, patterns only under "Для опытных"', async ({ page }) => {
  const sandbox = await openRules(page);
  await rows(page).nth(0).getByRole('button', { name: 'Изменить правило #1' }).click();
  const form = page.getByRole('region', { name: 'Правило #1' });
  await expect(form.locator('option[value=pattern]')).toHaveCount(0);
  await form.getByRole('button', { name: 'Добавить условие' }).click();
  await expect(form.getByText('и ещё', { exact: true })).toBeVisible();
  await form.getByLabel('Тип условия').nth(1).selectOption('flag');
  await form.getByLabel('Свойство').selectOption('first');
  await form.getByRole('button', { name: 'Показать шаблоны Lua' }).click();
  await expect(form.locator('option[value=pattern]').first()).toHaveCount(1);
  await form.getByRole('button', { name: 'Готово' }).click();
  await save(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  const r1 = (await savedRules(sandbox)).rules[0] as unknown as { conditions: object[] };
  expect(r1.conditions).toEqual([{ type: 'word', match: 'привет' }, { type: 'flag', match: 'first' }]);
});

test('order: buttons and drag change the order and the saved file', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1800 }); // the whole list on screen: a drag must not scroll the page halfway
  const sandbox = await openRules(page);
  await rows(page).nth(0).getByRole('button', { name: 'Опустить правило #1 ниже' }).click();
  await expect(rows(page).nth(0)).toContainText('donate');
  await expect(rows(page).nth(1)).toContainText('№ 2');
  await rows(page).nth(4).dragTo(rows(page).nth(0));
  await save(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  expect(await ids(sandbox)).toEqual([5, 2, 1, 3, 4]);
});

test('bulk: select several, switch them off, move to the bottom, delete with a confirmation; ids are not reused', async ({ page }) => {
  const sandbox = await openRules(page);
  await rows(page).nth(0).getByRole('checkbox').check();
  await rows(page).nth(1).getByRole('checkbox').check();
  await expect(page.getByText('Выбрано: 2')).toBeVisible();
  await page.getByRole('button', { name: 'Выключить' }).click();
  await expect(rows(page).nth(0)).toContainText('выключено');
  await page.getByRole('button', { name: 'В конец' }).click();
  await expect(rows(page).nth(3)).toContainText('№ 4');
  await expect(rows(page).nth(3)).toContainText('Привет, {user}!');
  await page.getByRole('button', { name: 'Снять выбор' }).click();

  await rows(page).nth(0).getByRole('checkbox').check();
  await page.getByRole('toolbar').getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('dialog')).toContainText('Удалить правило?');
  await page.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(rows(page)).toHaveCount(4);
  await save(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  const saved = await savedRules(sandbox);
  expect(saved.rules.map((r) => r.id)).toEqual([4, 5, 1, 2]);
  expect(saved.rules.slice(2).map((r) => r.enabled)).toEqual([false, false]);
  expect(saved.next_rule_id).toBe(6);
});

test('search locks the order, and says why', async ({ page }) => {
  await openRules(page);
  await page.getByLabel('Поиск по правилам').fill('донат');
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByText('порядок менять нельзя')).toBeVisible();
  await expect(rows(page).first().getByRole('button', { name: /Опустить правило/ })).toBeDisabled();
  await expect(rows(page).first()).toHaveAttribute('draggable', 'false');
  await page.getByLabel('Поиск по правилам').fill('нет такого');
  await expect(page.getByText('Ничего не найдено.')).toBeVisible();
  await page.getByLabel('Поиск по правилам').fill('');
  await expect(rows(page)).toHaveCount(5);
});

test('preview: the first matching rule wins, {user} is filled in, flags and channels count', async ({ page }) => {
  await openRules(page);
  const msg = page.getByLabel('Сообщение в чате');
  await msg.fill('ПРИВЕТ всем');
  await page.getByLabel('Ник зрителя').fill('Вася');
  await expect(page.getByText('Ответит правило № 1')).toBeVisible();
  await expect(page.locator('.preview-reply')).toHaveText('Привет, Вася!');
  await msg.fill('приветствую');
  await expect(page.getByText('Ни одно правило не сработает.')).toBeVisible();
  await msg.fill('пожертвовать на донаты');
  await expect(page.getByText('Ответит правило № 2')).toBeVisible(); // "keyword" catches "донаты", "word" would not
  await msg.fill('секрет');
  await expect(page.getByText('Ни одно правило не сработает.')).toBeVisible();
  await page.getByLabel('Канал', { exact: true }).fill('other');
  await expect(page.getByText('Ответит правило № 4')).toBeVisible();
});

test('preview in the constructor says whether the edited rule matches, and who beats it', async ({ page }) => {
  await openRules(page);
  await rows(page).nth(2).getByRole('button', { name: 'Изменить правило #3' }).click();
  const form = page.getByRole('region', { name: 'Правило #3' });
  await form.getByRole('button', { name: 'Подставить пример для этого правила' }).click();
  await expect(form.getByLabel('Сообщение в чате')).toHaveValue('донат');
  await expect(form.getByText('подходит, но раньше сработает правило № 2')).toBeVisible();
  await form.getByLabel('Сообщение в чате').fill('что-то другое');
  await expect(form.getByText('не подходит под это сообщение')).toBeVisible();
});

test('an old or unknown plugin version disables the settings it cannot use, and says why', async ({ page }) => {
  await openRules(page, { version: '0.2.0' });
  await rows(page).nth(0).getByRole('button', { name: 'Изменить правило #1' }).click();
  const form = page.getByRole('region', { name: 'Правило #1' });
  await expect(form.getByLabel('Название', { exact: true })).toBeDisabled();
  await expect(form.getByText('Нужна версия плагина 0.2.1 или новее.')).toBeVisible();
  await expect(form.getByText('Нужна версия плагина 0.5.0 или новее.')).toBeVisible();
  await expect(rows(page).nth(1)).toContainText('Название нужно плагину 0.2.1 или новее');
});

test('an empty list offers the first rule', async ({ page }) => {
  await openRules(page, { config: config([]) });
  await expect(page.getByText('Правил пока нет.')).toBeVisible();
});

test('accessibility: the list, the bulk bar, the constructor, the confirmation; and the keyboard reaches the actions', async ({ page }) => {
  await openRules(page);
  const scan = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`);
  expect(await scan()).toEqual([]);
  await rows(page).nth(0).getByRole('checkbox').check();
  await expect(page.getByRole('toolbar')).toBeVisible();
  expect(await scan()).toEqual([]);
  await rows(page).nth(1).getByRole('button', { name: 'Изменить правило donate' }).click();
  await expect(page.getByRole('region', { name: 'Правило donate' })).toBeVisible();
  await page.getByLabel('Сообщение в чате').fill('донат');
  await expect(page.getByText('Ответит правило № 2')).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.getByRole('region', { name: 'Правило donate' }).getByRole('button', { name: 'Готово' }).click();
  await page.getByRole('toolbar').getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // keyboard only: focus the "move down" button of rule 1 and press it
  await rows(page).nth(0).getByRole('button', { name: 'Опустить правило #1 ниже' }).focus();
  await page.keyboard.press('Enter');
  await expect(rows(page).nth(1)).toContainText('Привет, {user}!');
  await expect(rows(page).nth(1).getByRole('button', { name: 'Опустить правило #1 ниже' })).toBeFocused();
});
