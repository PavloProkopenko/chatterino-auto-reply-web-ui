import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, openSection, openSite, pickPluginFolder, sampleConfig, test, watchPage } from './harness.ts';

/** Paths of every file in the stand-in plugin folder ("a/b.txt"), and one file's text. */
const files = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const h of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
        if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, prefix + h.name + '/');
        else out.push(prefix + h.name);
      }
    };
    await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('plugin'), '');
    return out.sort();
  });
const text = (page: Page, path: string) =>
  page.evaluate(async (path) => {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('plugin');
    const parts = path.split('/');
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    return await (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).text();
  }, path);
const emptyFolder = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('plugin', { recursive: true }).catch(() => undefined);
    await root.getDirectoryHandle('plugin', { create: true });
  });

test('welcome: install the plugin into an empty folder, never into a foreign one', async ({ page }) => {
  const problems = watchPage(page);
  await openSite(page, { install: false });
  await emptyFolder(page);
  await openSection(page, 'Установить плагин и подключить');
  await page.getByRole('button', { name: 'Выбрать папку для плагина' }).click();
  await expect(page.getByTestId('plugin-state')).toContainText('плагина ещё нет');
  await page.getByRole('button', { name: 'Установить плагин в эту папку' }).click();
  await expect(page.getByTestId('plugin-state')).toContainText('это последняя');
  const list = await files(page);
  expect(list).toEqual(expect.arrayContaining(['info.json', 'init.lua', 'engine.lua', 'commands.lua', 'data/.external']));
  expect(list.some((f) => f.startsWith('tests/'))).toBe(false);
  expect(JSON.parse(await text(page, 'info.json')).name).toBe('Auto Reply');
  // continuing opens that folder as the config source (no config.json yet)
  await page.getByRole('button', { name: 'Открыть настройки из этой папки' }).click();
  await expect(page.getByRole('heading', { level: 1 }).first()).not.toHaveText('С чего начнём?');
  expect(problems).toEqual([]);
});

test('welcome: a folder with foreign files is refused and left alone', async ({ page }) => {
  await openSite(page, { install: false });
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('plugin', { recursive: true }).catch(() => undefined);
    const dir = await root.getDirectoryHandle('plugin', { create: true });
    const w = await (await dir.getFileHandle('notes.txt', { create: true })).createWritable();
    await w.write('keep me');
    await w.close();
  });
  await openSection(page, 'Установить плагин и подключить');
  await page.getByRole('button', { name: 'Выбрать папку для плагина' }).click();
  await expect(page.getByTestId('plugin-state')).toContainText('чужие файлы');
  await expect(page.getByRole('button', { name: 'Установить плагин в эту папку' })).toHaveCount(0);
  expect(await files(page)).toEqual(['notes.txt']);
});

test('settings: update an older plugin (backup, config untouched), then roll back', async ({ page }) => {
  const problems = watchPage(page);
  const sandbox = await openSite(page, { version: '0.5.0' });
  await pickPluginFolder(page);
  await expect(page.getByTestId('plugin-state')).toContainText('Установлена версия 0.5.0, на сайте');
  await page.getByRole('button', { name: /^Обновить до / }).click();
  await expect(page.getByTestId('plugin-state')).toContainText('это последняя');
  await expect(page.getByText('сохранена в .backup/0.5.0')).toBeVisible();
  expect(JSON.parse(await text(page, '.backup/0.5.0/info.json')).version).toBe('0.5.0');
  expect(await files(page)).toContain('engine.lua');
  expect(await sandbox.read()).toBe(sampleConfig()); // data/config.json is never touched
  await page.getByRole('button', { name: 'Откатить обновление' }).click();
  await expect(page.getByTestId('plugin-state')).toContainText('Установлена версия 0.5.0, на сайте');
  expect(JSON.parse(await text(page, 'info.json')).version).toBe('0.5.0');
  expect(problems).toEqual([]);
});

const bundledVersion = () => (JSON.parse(readFileSync(new URL('../../vendor/plugin/VERSION.json', import.meta.url), 'utf8')) as { version: string }).version;

test('sidebar: the Update button shows for an older plugin, updates with a backup, then goes away', async ({ page }) => {
  const problems = watchPage(page);
  const sandbox = await openSite(page, { version: '0.5.0' });
  await pickPluginFolder(page);
  const sidebar = page.locator('.file-box');
  await expect(sidebar.getByText('Плагин 0.5.0')).toBeVisible();
  await sidebar.getByRole('button', { name: 'Обновить плагин' }).click();
  await expect(sidebar.getByRole('status')).toContainText(`Обновлено до ${bundledVersion()}`);
  await expect(sidebar.getByText(`Плагин ${bundledVersion()}`)).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Обновить плагин' })).toHaveCount(0);
  expect(JSON.parse(await text(page, '.backup/0.5.0/info.json')).version).toBe('0.5.0');
  expect(JSON.parse(await text(page, 'info.json')).version).toBe(bundledVersion());
  expect(await sandbox.read()).toBe(sampleConfig()); // config untouched
  expect(problems).toEqual([]);
});

test('sidebar: no Update button when the plugin is current', async ({ page }) => {
  await openSite(page, { version: bundledVersion() });
  await pickPluginFolder(page);
  await expect(page.locator('.file-box').getByText(`Плагин ${bundledVersion()}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Обновить плагин' })).toHaveCount(0);
});

test('link helper builds a quoted command and refuses unsafe paths', async ({ page }) => {
  await openSite(page, { version: '0.5.0' });
  await pickPluginFolder(page);
  await page.locator('summary', { hasText: 'Подключить папку к Leafyrino' }).click();
  await page.getByLabel('Полный путь к вашей папке на компьютере').fill('/Users/me/auto-reply-plugin');
  await expect(page.getByTestId('link-command')).toContainText('ln -s "/Users/me/auto-reply-plugin"');
  await page.getByLabel('Полный путь к вашей папке на компьютере').fill('/x"; rm -rf ~; "');
  await expect(page.getByTestId('link-command')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'нельзя безопасно вставить' })).toBeVisible();
});
