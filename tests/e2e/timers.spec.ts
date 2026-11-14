import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, pickPluginFolder, sampleConfig, test, type Sandbox } from './harness.ts';

const STARTED = 1_800_000_000;
const word = (match: string) => ({ type: 'word', match });
const timer = (id: number, more: object = {}) => ({ id, channel: 'streamer', reply: 'играет {time}', format: 'smart', on_category: 'reset', conditions: [word('!game')], enabled: false, ...more });
const TIMERS = [
  timer(1, { name: 'game', enabled: true, started_at: STARTED }),
  timer(2, { reply: 'ещё {time}' }), // stopped, and its trigger is caught by timer 1
  timer(3, { channel: 'other', reply: 'без времени', conditions: [word('!uptime')] }), // no {time}, channel not listed
];
const config = (timers = TIMERS, more: object = {}) => sampleConfig({ timers, next_timer_id: timers.length + 1, ...more });

const rows = (page: Page) => page.locator('.rule-row');
const save = (page: Page) => page.getByRole('button', { name: 'Сохранить', exact: true });
const savedTimers = async (sandbox: Sandbox) => (JSON.parse((await sandbox.read())!) as { timers: Record<string, unknown>[]; next_timer_id: number }).timers;

async function openTimers(page: Page, opts: { config?: string; version?: string } = {}) {
  const sandbox = await openSite(page, { config: opts.config ?? config(), ...(opts.version ? { version: opts.version } : {}) });
  await pickPluginFolder(page);
  await page.getByRole('button', { name: 'Таймеры', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Таймеры', level: 1 })).toBeVisible();
  return sandbox;
}

test('the list shows each timer\'s state and the plugin\'s own hints', async ({ page }) => {
  await openTimers(page);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText('game: играет {time}');
  await expect(rows(page).nth(0)).toContainText('Запущен');
  await expect(rows(page).nth(0)).toContainText('по файлу на момент открытия');
  await expect(rows(page).nth(1)).toContainText('Остановлен');
  await expect(rows(page).nth(1)).toContainText('Возможно, не срабатывает');
  await expect(rows(page).nth(2)).toContainText('в ответе должен быть {time}');
  await expect(rows(page).nth(2)).toContainText('канала other нет в списке каналов');
});

test('create a timer: saved off, no start time; then start it with the warning, and stop it', async ({ page }) => {
  const sandbox = await openTimers(page);
  await page.getByRole('button', { name: 'Добавить таймер' }).click();
  const form = page.getByRole('region', { name: 'Новый таймер' });
  await expect(form.getByText('сохраняется остановленным')).toBeVisible();
  await form.getByRole('button', { name: 'Готово' }).click();
  await expect(form.getByText('нужен непустой текст для поиска')).toBeVisible();
  await expect(form.getByText('в ответе должен быть {time}').or(form.getByText('нужен текст ответа'))).toBeVisible();

  await form.getByLabel('Текст', { exact: true }).fill('!uptime');
  await form.getByLabel('Ответ', { exact: true }).fill('стрим идёт ');
  await form.getByRole('button', { name: 'Вставить {time}' }).click();
  await expect(form.getByLabel('Ответ', { exact: true })).toHaveValue('стрим идёт {time}');
  await expect(form.getByText('Например: только начал · 35 мин · 2 ч 35 мин')).toBeVisible();
  await form.getByLabel('Полностью').check();
  await expect(form.getByText('Например: 0:00:00 · 0:35:00 · 2:35:00')).toBeVisible();
  await form.getByLabel('Остановить таймер').check();
  await form.getByRole('button', { name: 'Готово' }).click();
  await expect(rows(page)).toHaveCount(4);
  await save(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  let saved = await savedTimers(sandbox);
  expect(saved[3]).toMatchObject({ id: 4, channel: 'streamer', reply: 'стрим идёт {time}', format: 'full', on_category: 'stop', enabled: false, conditions: [word('!uptime')] });
  expect(saved[3]).not.toHaveProperty('started_at');

  await rows(page).nth(3).getByRole('button', { name: /Запустить сейчас: таймер/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Отсчёт пойдёт с нуля');
  await page.getByRole('dialog').getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect(rows(page).nth(3)).toContainText('Запущен');
  await save(page).click();
  await expect(page.getByText('Все изменения сохранены')).toBeVisible();
  saved = await savedTimers(sandbox);
  expect(saved[3]).toMatchObject({ enabled: true });
  expect(Math.abs((saved[3]!.started_at as number) - Date.now() / 1000)).toBeLessThan(300);
  expect(saved[3]).not.toHaveProperty('game_id');

  await rows(page).nth(3).getByRole('button', { name: /Остановить: таймер/ }).click();
  await save(page).click();
  await expect(page.getByText('Все изменения сохранены')).toBeVisible();
  saved = await savedTimers(sandbox);
  expect(saved[3]).toMatchObject({ enabled: false });
  expect(saved[3]).not.toHaveProperty('started_at');
});

test('editing a running timer keeps what the plugin has now, even if it restarted the timer meanwhile', async ({ page }) => {
  const sandbox = await openTimers(page);
  await rows(page).nth(0).getByRole('button', { name: 'Изменить таймер game' }).click();
  const form = page.getByRole('region', { name: 'Таймер game' });
  await form.getByLabel('Ответ', { exact: true }).fill('новый ответ {time}');
  await form.getByRole('button', { name: 'Готово' }).click();
  // the plugin restarts the timer (category changed) after the page loaded the file
  const text = JSON.parse((await sandbox.read())!);
  text.timers[0].started_at = STARTED + 5000;
  text.timers[0].game_id = '12345';
  await sandbox.write(JSON.stringify(text, null, 2) + '\n');
  await save(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  expect((await savedTimers(sandbox))[0]).toMatchObject({ reply: 'новый ответ {time}', enabled: true, started_at: STARTED + 5000, game_id: '12345' });
});

test('a start the plugin overruled is not applied, and the page says so', async ({ page }) => {
  const sandbox = await openTimers(page);
  await rows(page).nth(1).getByRole('button', { name: /Запустить сейчас: таймер/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Запустить', exact: true }).click();
  const text = JSON.parse((await sandbox.read())!);
  text.timers[1].enabled = true; // the plugin started it too, at another moment
  text.timers[1].started_at = STARTED + 100;
  await sandbox.write(JSON.stringify(text, null, 2) + '\n');
  await save(page).click();
  await expect(page.getByText('пока вы редактировали, плагин сам изменил его состояние')).toBeVisible();
  expect((await savedTimers(sandbox))[1]).toMatchObject({ enabled: true, started_at: STARTED + 100 });
});

test('order by buttons and drag, delete with a confirmation; ids are not reused', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  const sandbox = await openTimers(page);
  await rows(page).nth(0).getByRole('button', { name: 'Опустить таймер game ниже' }).click();
  await expect(rows(page).nth(1)).toContainText('game');
  await rows(page).nth(2).dragTo(rows(page).nth(0));
  await rows(page).nth(2).getByRole('button', { name: /Удалить таймер/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Удалить таймер?');
  await page.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(rows(page)).toHaveCount(2);
  await save(page).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  const saved = JSON.parse((await sandbox.read())!) as { timers: { id: number }[]; next_timer_id: number };
  expect(saved.timers.map((t) => t.id)).toEqual([3, 2]);
  expect(saved.next_timer_id).toBe(4);
});

test('an old or unknown plugin: timers can be started, stopped and deleted, not created or edited', async ({ page }) => {
  await openTimers(page, { version: '0.3.0' });
  await expect(page.getByText('Менять таймеры можно с плагином 0.4.0 или новее')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить таймер' })).toBeDisabled();
  await expect(rows(page).nth(0).getByRole('button', { name: 'Изменить таймер game' })).toBeDisabled();
  await expect(rows(page).nth(0).getByRole('button', { name: 'Остановить: таймер game' })).toBeEnabled();
  await expect(rows(page).nth(0).getByRole('button', { name: 'Удалить таймер game' })).toBeEnabled();
});

test('the preview answers with the elapsed time of a running timer, and explains one that is stopped', async ({ page }) => {
  await openTimers(page);
  await page.getByRole('button', { name: 'Проверка', exact: true }).click();
  await page.getByLabel('Сообщение в чате').fill('!game');
  await expect(page.getByText('Ответит таймер № 1 («game»)')).toBeVisible();
  await expect(page.locator('.preview-reply')).toHaveText('играет 2 ч 35 мин');
  await page.getByLabel('Сколько идёт таймер').fill('40m');
  await expect(page.locator('.preview-reply')).toHaveText('играет 40 мин');
  await page.keyboard.press('Escape');
  await rows(page).nth(1).getByRole('button', { name: 'Изменить таймер #2' }).click();
  const form = page.getByRole('region', { name: 'Таймер #2' });
  await form.getByRole('button', { name: 'Проверка', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Подставить пример для этого правила' }).click();
  await expect(dlg.getByLabel('Сообщение в чате')).toHaveValue('!game');
  await expect(dlg.getByText('не запущен: запустите его, иначе он не ответит')).toBeVisible();
});

test('the Rules page preview now runs running timers first', async ({ page }) => {
  await openTimers(page);
  await page.getByRole('button', { name: 'Правила', exact: true }).click();
  await page.getByRole('button', { name: 'Проверка', exact: true }).click();
  await page.getByLabel('Сообщение в чате').fill('!game');
  await expect(page.getByText('Ответит таймер № 1 («game»)')).toBeVisible();
});

test('accessibility: the list, the constructor, the start confirmation; keyboard move keeps the focus', async ({ page }) => {
  await openTimers(page);
  const scan = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`);
  expect(await scan()).toEqual([]);
  await rows(page).nth(1).getByRole('button', { name: 'Изменить таймер #2' }).click();
  await expect(page.getByRole('region', { name: 'Таймер #2' })).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.getByRole('region', { name: 'Таймер #2' }).getByRole('button', { name: 'Проверка', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Сообщение в чате').fill('!game');
  await expect(page.getByText('Ответит таймер № 1')).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('region', { name: 'Таймер #2' }).getByRole('button', { name: 'Отмена' }).last().click();
  await rows(page).nth(1).getByRole('button', { name: /Запустить сейчас: таймер/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.keyboard.press('Escape');
  await rows(page).nth(0).getByRole('button', { name: 'Опустить таймер game ниже' }).focus();
  await page.keyboard.press('Enter');
  await expect(rows(page).nth(1).getByRole('button', { name: 'Опустить таймер game ниже' })).toBeFocused();
});
