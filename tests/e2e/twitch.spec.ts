import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, pickPluginFolder, sampleConfig, test, watchPage } from './harness.ts';
import { mockTwitch } from './twitch-mock.ts';

// 0.8.2 is the plugin that has the Twitch API and notices a login made on the site.
const VERSION = '0.8.2';
const CLIENT = JSON.stringify({ client_id: 'cid1234567' }); // the site's own Client ID is not set yet: helix.json carries it
const LOGGED_IN = JSON.stringify({ client_id: 'cid1234567', access_token: 'AT-SECRET', refresh_token: 'RT-SECRET', expires_at: 1_900_000_000, user_id: '1000', login: 'streamer', scopes: [] });
const status = (page: Page) => page.getByTestId('twitch-status');
const login = (page: Page) => page.getByRole('button', { name: 'Войти через Twitch' });
const save = (page: Page) => page.getByRole('button', { name: 'Сохранить', exact: true });

async function open(page: Page, opts: { helix?: string | null; config?: string; version?: string } = {}) {
  const sandbox = await openSite(page, { version: opts.version ?? VERSION, ...(opts.config ? { config: opts.config } : {}) });
  if (opts.helix !== null) await sandbox.writeHelix(opts.helix ?? CLIENT);
  await pickPluginFolder(page);
  return sandbox;
}

test('login: the code and link appear, the login is written to helix.json, the Twitch API switch turns on', async ({ page }) => {
  const problems = watchPage(page);
  const twitch = await mockTwitch(page);
  const sandbox = await open(page);
  await expect(status(page)).toContainText('Вход не выполнен');
  await login(page).click();
  await expect(page.getByTestId('twitch-code')).toContainText('ABCD-EFGH');
  await expect(page.getByRole('link', { name: 'Открыть страницу Twitch' })).toHaveAttribute('href', /^https:\/\/www\.twitch\.tv\/activate/);
  await expect(page.getByRole('link', { name: 'Открыть страницу Twitch' })).toHaveAttribute('rel', /noopener/);
  await expect(status(page)).toContainText('Вход выполнен: streamer', { timeout: 15_000 });
  await expect(page.getByTestId('twitch-code')).toHaveCount(0);
  const file = JSON.parse((await sandbox.readHelix())!);
  expect(file).toMatchObject({ client_id: 'cid1234567', access_token: 'AT-SECRET', refresh_token: 'RT-SECRET', user_id: '1000', login: 'streamer' });
  expect(twitch.calls).toEqual(['POST /oauth2/device', 'POST /oauth2/token', 'POST /oauth2/token', 'GET /oauth2/validate']);
  // the switch went on as a normal unsaved edit; nothing was written to config.json yet
  await expect(page.getByRole('switch', { name: 'Использовать Twitch API' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Есть несохранённые изменения')).toBeVisible();
  expect(JSON.parse((await sandbox.read())!).helix_enabled).toBeUndefined();
  await save(page).click();
  await expect(page.getByText('Есть несохранённые изменения')).toHaveCount(0);
  expect(JSON.parse((await sandbox.read())!).helix_enabled).toBe(true);
  // the token never shows up on the page
  expect(await page.locator('body').innerText()).not.toContain('SECRET');
  // Twitch answers "authorization_pending" with HTTP 400 and Chromium logs every such response; that is expected
  // while the user has not typed the code yet. Anything else (CSP violations, page errors) is still a failure.
  expect(problems.filter((p) => !p.includes('the server responded with a status of 400'))).toEqual([]);
});

test('login: cancelling the code stops the polling and writes nothing', async ({ page }) => {
  const twitch = await mockTwitch(page, { pending: 99 });
  const sandbox = await open(page);
  await login(page).click();
  await expect(page.getByTestId('twitch-code')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.getByTestId('twitch-code')).toHaveCount(0);
  await expect(login(page)).toBeEnabled();
  await page.waitForTimeout(1500);
  const tokenCalls = twitch.calls.filter((c) => c.includes('/oauth2/token')).length;
  await page.waitForTimeout(1500);
  expect(twitch.calls.filter((c) => c.includes('/oauth2/token')).length).toBe(tokenCalls);
  expect(JSON.parse((await sandbox.readHelix())!)).toEqual({ client_id: 'cid1234567' });
});

test('login: a refusal on the Twitch page is explained', async ({ page }) => {
  await mockTwitch(page, { tokenError: 'access_denied' });
  await open(page);
  await login(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Вход отклонён' })).toBeVisible({ timeout: 15_000 });
  await expect(status(page)).toContainText('Вход не выполнен');
});

test('login without any Client ID says so and sends nothing', async ({ page }) => {
  const twitch = await mockTwitch(page);
  await open(page, { helix: null });
  await login(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'не задан Client ID' })).toBeVisible();
  expect(twitch.calls).toEqual([]);
});

test('logout: the token is removed from helix.json (client id stays) and revoked at Twitch', async ({ page }) => {
  const twitch = await mockTwitch(page);
  const sandbox = await open(page, { helix: LOGGED_IN });
  await expect(status(page)).toContainText('Вход выполнен: streamer');
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(status(page)).toContainText('Вход не выполнен');
  expect(JSON.parse((await sandbox.readHelix())!)).toEqual({ client_id: 'cid1234567' });
  expect(twitch.revoked).toHaveLength(1);
  expect(twitch.revoked[0]).toContain('token=AT-SECRET');
});

test('a login made in chat shows up when the tab is looked at again', async ({ page }) => {
  await mockTwitch(page);
  const sandbox = await open(page);
  await expect(status(page)).toContainText('Вход не выполнен');
  await sandbox.writeHelix(LOGGED_IN); // the plugin's /autoreply helix login
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(status(page)).toContainText('Вход выполнен: streamer');
});

test('an older plugin (before 0.8.0): no login, a pointer to the version it needs', async ({ page }) => {
  await mockTwitch(page);
  await open(page, { version: '0.7.2' });
  await expect(page.getByText('Нужна версия плагина 0.8.0 или новее.')).toBeVisible();
  await expect(login(page)).toHaveCount(0);
});

test('plugin 0.8.0/0.8.1 reads the login only at start: the page says to restart it', async ({ page }) => {
  await mockTwitch(page);
  await open(page, { version: '0.8.1' });
  await login(page).click();
  await expect(status(page)).toContainText('Вход выполнен: streamer', { timeout: 15_000 });
  await expect(page.getByText('читает вход только при запуске')).toBeVisible();
});

test('the page talks to Twitch only for the login, and only to id.twitch.tv', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  await mockTwitch(page);
  await open(page);
  await login(page).click();
  await expect(status(page)).toContainText('Вход выполнен', { timeout: 15_000 });
  const own = new URL(page.url()).host;
  expect([...hosts].filter((h) => h !== own)).toEqual(['id.twitch.tv']);
});

test('redeems: Add is disabled until the Twitch login is done and the Twitch API is on', async ({ page }) => {
  await mockTwitch(page);
  const sandbox = await open(page, { helix: CLIENT });
  const add = page.getByRole('button', { name: 'Добавить награду' });
  await page.getByRole('button', { name: 'Награды', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Награды', level: 1 })).toBeVisible();
  // not logged in
  await expect(add).toBeDisabled();
  await expect(page.locator('#redeem-add-why')).toContainText('войдите через Twitch');
  await expect(add).toHaveAttribute('aria-describedby', 'redeem-add-why');
  // a deep link to the new-reward page bounces back to the list
  await page.goto('/#/redeems/new');
  await expect(page.getByRole('heading', { name: 'Награды', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить награду' })).toBeDisabled();
  // logged in, but the switch is off
  await sandbox.writeHelix(LOGGED_IN);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#redeem-add-why')).toContainText('«Использовать Twitch API» выключено');
  await expect(page.getByRole('button', { name: 'Добавить награду' })).toBeDisabled();
  // the banner takes the user to the switch
  await page.getByRole('button', { name: 'Открыть настройки' }).click();
  await page.getByRole('switch', { name: 'Использовать Twitch API' }).click();
  await page.getByRole('button', { name: 'Награды', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Добавить награду' })).toBeEnabled();
  await expect(page.locator('#redeem-add-why')).toHaveCount(0);
  await page.getByRole('button', { name: 'Добавить награду' }).click();
  await expect(page).toHaveURL(/#\/redeems\/new$/);
});

test('redeems: existing rewards stay editable without a login', async ({ page }) => {
  await mockTwitch(page);
  await open(page, { helix: CLIENT, config: sampleConfig({ redeems: [{ id: 1, channel: 'streamer', title: 'Мут', action: 'timeout', seconds: 600, enabled: true }], next_redeem_id: 2 }) });
  await page.getByRole('button', { name: 'Награды', exact: true }).click();
  await page.locator('[data-act="edit"]').first().click();
  await expect(page.getByRole('button', { name: 'Добавить награду' })).toHaveCount(0);
  await expect(page.locator('.page')).toContainText('Мут');
});

test('a phone: the code screen does not scroll sideways and has no accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await mockTwitch(page, { pending: 99 });
  await open(page);
  await login(page).click();
  await expect(page.getByTestId('twitch-code')).toBeVisible();
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    if (de.scrollWidth <= de.clientWidth) return [];
    return [`scrollWidth=${de.scrollWidth} clientWidth=${de.clientWidth}`, ...Array.from(document.querySelectorAll('body *')).filter((e) => e.getBoundingClientRect().right > de.clientWidth + 0.5).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${(e as HTMLElement).className}`)];
  });
  expect(overflow).toEqual([]);
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.help}`);
  expect(violations).toEqual([]);
});
