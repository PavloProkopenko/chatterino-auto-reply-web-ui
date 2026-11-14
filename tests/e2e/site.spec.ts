import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV, expect, openNotices, openSection, openSite, pickPluginFolder, sampleConfig, test } from './harness.ts';

const field = (page: import('@playwright/test').Page, label: string) => page.getByLabel(label, { exact: true });
const save = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Сохранить/ }).last();

test('the choice is remembered: a reload opens the same folder, "change" forgets it', async ({ page }) => {
  const sandbox = await openSite(page);
  await pickPluginFolder(page);
  await field(page, 'Пауза для одного зрителя').fill('30');
  await save(page).click();
  await expect(page.getByText('Все изменения сохранены')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
  await expect(field(page, 'Пауза для одного зрителя')).toHaveValue('30');
  // the history survived the reload as well
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Восстановить' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Сменить папку' }).click();
  await expect(page.getByRole('heading', { name: 'С чего начнём?' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'С чего начнём?' })).toBeVisible(); // forgotten
  expect(JSON.parse((await sandbox.read())!).per_user_cooldown).toBe(30); // the file itself was not touched by forgetting
});

test('after a browser restart the permission may need one click', async ({ page }) => {
  await openSite(page);
  await pickPluginFolder(page);
  await page.evaluate(() => sessionStorage.setItem('__perm', 'prompt'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Продолжить с «plugin»?' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
});

test('"choose another" on the permission screen forgets the folder', async ({ page }) => {
  await openSite(page);
  await pickPluginFolder(page);
  await page.evaluate(() => sessionStorage.setItem('__perm', 'prompt'));
  await page.reload();
  await page.getByRole('button', { name: 'Выбрать другую' }).click();
  await expect(page.getByRole('heading', { name: 'С чего начнём?' })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('__perm', 'granted'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'С чего начнём?' })).toBeVisible();
});

test('a file held by another program: retried, then the exact text is offered as a download; retry works later', async ({ page }) => {
  test.setTimeout(45_000);
  const sandbox = await openSite(page);
  await pickPluginFolder(page);
  await field(page, 'Пауза для одного зрителя').fill('45');
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__busy = true));
  await save(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'его держит другая программа' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Есть несохранённые изменения')).toBeVisible();
  expect(await sandbox.read()).toBe(sampleConfig());
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать файл' }).click()]);
  const text = await readFile((await download.path())!, 'utf8');
  expect(JSON.parse(text).per_user_cooldown).toBe(45);
  expect(download.suggestedFilename()).toBe('config.json');
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__busy = false));
  await page.getByRole('button', { name: 'Попробовать снова' }).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  expect(JSON.parse((await sandbox.read())!).per_user_cooldown).toBe(45);
});

test('write permission lost: one click grants it and saves the same edit', async ({ page }) => {
  const sandbox = await openSite(page);
  await pickPluginFolder(page);
  await field(page, 'Пауза для одного зрителя').fill('46');
  await page.evaluate(() => {
    // what a lapsed permission looks like: the browser reports "prompt" and refuses writes until asked again
    sessionStorage.setItem('__perm', 'prompt');
    (window as unknown as Record<string, unknown>).__denied = true;
  });
  await save(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'нет разрешения' })).toBeVisible();
  await page.getByRole('button', { name: 'Разрешить доступ и сохранить' }).click();
  await expect(page.getByText('/autoreply reload')).toBeVisible();
  expect(JSON.parse((await sandbox.read())!).per_user_cooldown).toBe(46);
});

test('while the page is open, a plugin save is noticed: silently when clean, with a notice when editing', async ({ page }) => {
  const sandbox = await openSite(page);
  await pickPluginFolder(page);
  const plugin = JSON.parse(sampleConfig());
  plugin.per_user_cooldown = 33;
  await sandbox.write(JSON.stringify(plugin, null, 2) + '\n');
  await expect(field(page, 'Пауза для одного зрителя')).toHaveValue('33'); // picked up by the poll, no click

  await field(page, 'Минимум между любыми ответами').fill('9');
  plugin.per_rule_cooldown = 44;
  await sandbox.write(JSON.stringify(plugin, null, 2) + '\n');
  await openNotices(page);
  await expect(page.getByText('Плагин сохранил файл, пока вы редактировали')).toBeVisible();
  await expect(field(page, 'Минимум между любыми ответами')).toHaveValue('9'); // edits are kept
});

test('demo mode: an in-memory sample, saving downloads a file, nothing is remembered', async ({ page }) => {
  await openSite(page, { install: false });
  await openSection(page, 'Попробовать на примере');
  await page.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
  await openNotices(page);
  await expect(page.getByText('Это пример: ничего не читается')).toBeVisible();
  await expect(page.locator('.file-box')).toContainText('Пример');
  await field(page, 'Пауза для одного зрителя').fill('15');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить и скачать' }).click()]);
  const saved = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(saved.per_user_cooldown).toBe(15);
  expect(saved.channels).toEqual(['streamer']);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'С чего начнём?' })).toBeVisible();
});

test('browsers without direct access: open the plugin folder, edit, download the result', async ({ page }) => {
  await openSite(page, { direct: false, install: false });
  await expect(page.getByRole('button', { name: 'Выбрать папку плагина' })).toHaveCount(0);
  const dir = await mkdtemp(join(tmpdir(), 'plugin-'));
  try {
    await mkdir(join(dir, 'auto-reply', 'data'), { recursive: true });
    await writeFile(join(dir, 'auto-reply', 'info.json'), JSON.stringify({ name: 'Auto Reply', version: '0.5.0' }));
    await writeFile(join(dir, 'auto-reply', 'data', 'config.json'), sampleConfig());
    await page.locator('input[type=file][webkitdirectory]').setInputFiles(join(dir, 'auto-reply'));
    await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
    await openNotices(page);
    await expect(page.getByText('Сайт не может менять файл сам')).toBeVisible();
    await expect(page.getByText('Плагин 0.5.0')).toBeVisible();
    await field(page, 'Пауза для одного зрителя').fill('20');
    await page.getByRole('button', { name: 'Сохранить и скачать' }).click();
    // the page asks for the current file first; nothing is downloaded before that
    await expect(page.getByRole('dialog', { name: 'Откройте актуальный config.json' })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('dialog').locator('input[type=file]').setInputFiles(join(dir, 'auto-reply', 'data', 'config.json')),
    ]);
    const text = await readFile((await download.path())!, 'utf8');
    expect(text).toBe(sampleConfig().replace('"per_user_cooldown": 60', '"per_user_cooldown": 20'));
    await expect(page.getByText('Файл скачан.')).toBeVisible();
    await expect(page.getByText('cp "$HOME/Downloads/config.json"').or(page.getByText('copy /Y'))).toContainText('auto-reply');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the dev server (pnpm dev) renders the app: a route or proxy rule must not swallow a source file', async ({ page }) => {
  await page.goto(DEV + '/');
  await expect(page.getByRole('heading', { name: 'С чего начнём?' })).toBeVisible();
  await openSection(page, 'Попробовать на примере');
  await page.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
});

test('the plugin changed the file meanwhile: the re-opened file wins for live state, the edits stay', async ({ page }) => {
  await openSite(page, { install: false });
  const dir = await mkdtemp(join(tmpdir(), 'plugin-'));
  try {
    const path = join(dir, 'config.json');
    await writeFile(path, sampleConfig());
    // the main button works in a browser with direct access too, and needs no folder permission
    await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles(path);
    await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
    await field(page, 'Пауза для одного зрителя').fill('20');
    await writeFile(path, sampleConfig({ active_until: 'session', per_rule_cooldown: 33 })); // the plugin saved
    await page.getByRole('button', { name: 'Сохранить и скачать' }).click();
    // a file that is not JSON is refused with a reason, and nothing is downloaded
    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{nope');
    await page.getByRole('dialog').locator('input[type=file]').setInputFiles(bad);
    await expect(page.getByText('Это не похоже на файл настроек')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').locator('input[type=file]').setInputFiles(path)]);
    const saved = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(saved.per_user_cooldown).toBe(20);
    expect(saved.per_rule_cooldown).toBe(33);
    expect(saved.active_until).toBe('session');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Chrome refusing a system folder: the message points to the always-working button', async ({ page }) => {
  await openSite(page, { install: false });
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => {
      throw new DOMException('system folder', 'SecurityError');
    };
  });
  await page.getByRole('button', { name: 'Выбрать папку плагина напрямую' }).click();
  await expect(page.getByRole('alert')).toContainText('системные папки');
  await expect(page.getByRole('button', { name: 'Открыть config.json (любой браузер)' })).toBeVisible();
});

test('only config.json opened: new settings are off until info.json is opened too', async ({ page }) => {
  await openSite(page, { install: false });
  const dir = await mkdtemp(join(tmpdir(), 'plugin-'));
  try {
    const config = join(dir, 'config.json');
    await writeFile(config, sampleConfig());
    await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles(config);
    await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
    await openNotices(page);
    await expect(page.getByText('Версия плагина неизвестна, поэтому')).toBeVisible();
    await field(page, 'Пауза для одного зрителя').fill('21'); // basic settings work without the version
    const other = join(dir, 'other.json');
    await writeFile(other, JSON.stringify({ name: 'Something Else', version: '9.9.9' }));
    await openNotices(page);
    await page.getByLabel('Открыть info.json').setInputFiles(other);
    await expect(page.getByText('Это файл другого плагина')).toBeVisible();
    const info = join(dir, 'info.json');
    await writeFile(info, JSON.stringify({ name: 'Auto Reply', version: '0.5.0' }));
    await page.getByLabel('Открыть info.json').setInputFiles(info);
    await expect(page.getByText('Плагин 0.5.0')).toBeVisible();
    await expect(page.getByText('Версия плагина неизвестна, поэтому')).toHaveCount(0);
    await expect(field(page, 'Пауза для одного зрителя')).toHaveValue('21'); // the edit survived
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
