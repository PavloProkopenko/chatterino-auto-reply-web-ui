import type { Page } from '@playwright/test';
import { expect, sampleConfig, startApp, test, watchPage, type App } from './harness.ts';

/** First run: pick the discovered install, land on the Settings page. */
async function open(page: Page, app: App) {
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
}
const saveButton = (page: Page) => page.getByRole('button', { name: 'Сохранить', exact: true });
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

test('first run: pick the install, see the values, the path stays hidden', async ({ page, app }) => {
  const problems = watchPage(page);
  await open(page, app);
  await expect(field(page, 'Пауза для одного зрителя')).toHaveValue('60');
  await expect(field(page, 'Минимум между любыми ответами')).toHaveValue('2');
  await expect(page.getByText('streamer', { exact: true })).toBeVisible(); // the channel chip
  await expect(page.locator('body')).not.toContainText(app.pluginDir); // privacy: no path on screen by default
  await expect(page.locator('body')).toContainText('Chatterino › Plugins › auto-reply');
  await page.getByRole('button', { name: 'Показать путь' }).click();
  await expect(page.locator('body')).toContainText(app.configPath);
  expect(problems).toEqual([]);
});

test('edit, save: the banner asks for /autoreply reload and only the edited field changes on disk', async ({ page, app }) => {
  await open(page, app);
  await expect(page.getByText('Все изменения сохранены')).toBeVisible();
  await field(page, 'Пауза для одного зрителя').fill('30');
  await expect(page.getByText('Есть несохранённые изменения')).toBeVisible();
  await saveButton(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  await expect(page.getByText('Все изменения сохранены')).toBeVisible();
  expect(await app.read()).toBe(sampleConfig().replace('"per_user_cooldown": 60', '"per_user_cooldown": 30'));
  expect(await app.backups()).toHaveLength(1);
});

test('invalid numbers show an inline message and block saving', async ({ page, app }) => {
  await open(page, app);
  await field(page, 'Минимум между любыми ответами').fill('0');
  await expect(page.getByRole('alert').filter({ hasText: 'Не меньше 1' })).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  await field(page, 'Минимум между любыми ответами').fill('abc');
  await expect(page.getByRole('alert').filter({ hasText: 'Введите число' })).toBeVisible();
  await field(page, 'Минимум между любыми ответами').fill('5');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await field(page, 'Пауза для одного правила').fill('86401');
  await expect(page.getByRole('alert').filter({ hasText: 'Не больше 86400' })).toBeVisible();
  expect(await app.read()).toBe(sampleConfig()); // nothing was written
});

test('lists: logins are checked by the plugin\'s own rules and stored normalised', async ({ page, app }) => {
  await open(page, app);
  const channels = field(page, 'Каналы');
  await channels.fill('bad name!');
  await channels.press('Enter');
  const rejected = page.getByRole('alert').filter({ hasText: 'неверное имя канала' });
  await expect(rejected).toBeVisible();
  await expect(rejected).toBeInViewport({ ratio: 1 }); // not hidden behind the save bar
  await channels.fill('#Other_Chan');
  await channels.press('Enter');
  await expect(page.getByText('other_chan', { exact: true })).toBeVisible();
  const ignore = field(page, 'Игнорируемые пользователи');
  await ignore.fill('@Nightbot, moobot');
  await ignore.press('Enter');
  await expect(page.getByText('nightbot', { exact: true })).toBeVisible();
  await expect(page.getByText('moobot', { exact: true })).toBeVisible();
  await saveButton(page).click();
  await expect(page.getByText('Все изменения сохранены')).toBeVisible();
  const saved = JSON.parse(await app.read());
  expect(saved.channels).toEqual(['streamer', 'other_chan']);
  expect(saved.ignore_users).toEqual(['nightbot', 'moobot']);
});

test('undo and redo; revert drops all edits', async ({ page, app }) => {
  await open(page, app);
  await page.getByRole('switch', { name: 'Только когда идёт стрим' }).click();
  await page.getByRole('switch', { name: 'Не реагировать на сообщения модераторов' }).click();
  await page.getByRole('button', { name: 'Шаг назад' }).click();
  await expect(page.getByRole('switch', { name: 'Не реагировать на сообщения модераторов' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch', { name: 'Только когда идёт стрим' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Шаг вперёд' }).click();
  await expect(page.getByRole('switch', { name: 'Не реагировать на сообщения модераторов' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Отменить изменения' }).click();
  await expect(page.getByText('Все изменения сохранены')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Только когда идёт стрим' })).toHaveAttribute('aria-checked', 'false');
});

test('the plugin saved a different field meanwhile: merged, nothing lost, live state kept', async ({ page, app }) => {
  await open(page, app);
  await field(page, 'Пауза для одного зрителя').fill('30');
  const plugin = JSON.parse(sampleConfig());
  delete plugin.active_until; // the plugin turned itself off
  plugin.global_min_gap = 7;
  await app.write(JSON.stringify(plugin, null, 2) + '\n');
  await saveButton(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  await expect(page.getByText('изменения объединены')).toBeVisible();
  const saved = JSON.parse(await app.read());
  expect(saved.per_user_cooldown).toBe(30);
  expect(saved.global_min_gap).toBe(7);
  expect('active_until' in saved).toBe(false);
});

test('the plugin changed the same field: per-field choice, then everything is saved', async ({ page, app }) => {
  await open(page, app);
  await field(page, 'Пауза для одного зрителя').fill('30');
  const plugin = JSON.parse(sampleConfig());
  plugin.per_user_cooldown = 90;
  plugin.timers = [{ id: 1, channel: 'streamer', reply: '{time}', format: 'smart', on_category: 'reset', conditions: [{ type: 'word', match: 'x' }], enabled: true, started_at: 1700000000 }];
  plugin.next_timer_id = 2;
  await app.write(JSON.stringify(plugin, null, 2) + '\n');
  await saveButton(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Плагин изменил то же, что и вы')).toBeVisible();
  const apply = dialog.getByRole('button', { name: 'Сохранить с этим выбором' });
  await expect(apply).toBeDisabled();
  await dialog.getByRole('radio', { name: /Ваше значение/ }).check();
  await apply.click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  const saved = JSON.parse(await app.read());
  expect(saved.per_user_cooldown).toBe(30);
  expect(saved.timers[0]).toMatchObject({ enabled: true, started_at: 1700000000 }); // the plugin's live state survived
});

test('history: restore an older copy', async ({ page, app }) => {
  await open(page, app);
  await field(page, 'Пауза для одного зрителя').fill('30');
  await saveButton(page).click();
  await expect(page.getByText('Все изменения сохранены')).toBeVisible();
  await page.getByRole('button', { name: 'История' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'История копий' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Восстановить' }).click();
  await dialog.getByRole('button', { name: 'Да, восстановить' }).click();
  await expect(dialog).toBeHidden();
  await expect(field(page, 'Пауза для одного зрителя')).toHaveValue('60');
  expect(JSON.parse(await app.read()).per_user_cooldown).toBe(60);
});

test('a missing config offers to create the defaults', async ({ page }) => {
  const app = await startApp({ config: null });
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.getByRole('heading', { name: 'Файла настроек ещё нет' })).toBeVisible();
  await page.getByRole('button', { name: 'Создать настройки по умолчанию' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
  expect(JSON.parse(await app.read())).toMatchObject({ version: 1, per_user_cooldown: 60 });
  await app.stop();
});

test('an invalid file is shown read-only and never rewritten', async ({ page }) => {
  const app = await startApp({ config: '{half a file' });
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.getByRole('heading', { name: 'Файл настроек повреждён' })).toBeVisible();
  expect(await app.read()).toBe('{half a file');
  await app.stop();
});

test('an older plugin disables the setting it cannot use', async ({ page }) => {
  const app = await startApp({ pluginVersion: '0.4.0' });
  await open(page, app);
  await expect(page.getByRole('switch', { name: 'Не реагировать на сообщения модераторов' })).toBeDisabled();
  await expect(page.getByText('Нужна версия плагина 0.5.0 или новее.')).toBeVisible();
  await app.stop();
});
