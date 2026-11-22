import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openSite, pickPluginFolder, sampleConfig, test, watchPage, type Sandbox } from './harness.ts';
import { mockHelixApi, mockTwitch, type HelixApiOptions } from './twitch-mock.ts';

// 0.9.0 has mute exceptions (unprotect_users); 0.8.3 does not.
const SCOPES = ['channel:read:redemptions', 'moderation:read', 'channel:read:vips', 'user:read:moderated_channels'];
const LOGIN = (scopes = SCOPES) => JSON.stringify({ client_id: 'cid1234567', access_token: 'AT-SECRET', refresh_token: 'RT-SECRET', expires_at: 1_900_000_000, user_id: '1000', login: 'streamer', scopes });
const config = (more: Record<string, unknown> = {}) => sampleConfig({ channels: ['streamer', 'friend'], helix_enabled: true, ...more });
const save = (page: Page) => page.getByRole('button', { name: 'Сохранить', exact: true });
// an empty list may be absent or `{}` in the file (the app never writes a key it has nothing to say about)
const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const saved = async (sandbox: Sandbox) => {
  const c = JSON.parse((await sandbox.read())!) as Record<string, unknown>;
  return { protect_users: list(c.protect_users), unprotect_users: list(c.unprotect_users), redeems: c.redeems as Record<string, unknown>[] };
};
const group = (page: Page, kind: 'mods' | 'vips') => page.locator(`details[data-kind="${kind}"]`);

async function open(page: Page, o: { version?: string; scopes?: string[]; config?: string; api?: HelixApiOptions } = {}) {
  await mockTwitch(page);
  const api = await mockHelixApi(page, o.api ?? {});
  const sandbox = await openSite(page, { version: o.version ?? '0.9.0', config: o.config ?? config() });
  await sandbox.writeHelix(LOGIN(o.scopes));
  await pickPluginFolder(page);
  await expect(page.getByTestId('twitch-status')).toContainText('Вход выполнен: streamer');
  return { sandbox, api };
}

async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Награды', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить награду' }).click();
  return page.getByRole('region', { name: 'Новая награда' });
}

test('settings: mods and VIPs are two separate dropdowns (both open at once), fetched from the own channel, one switch per person', async ({ page }) => {
  const problems = watchPage(page);
  const { sandbox, api } = await open(page, { api: { mods: ['Mod1', 'mod2'], vips: ['Vip1', 'vip2', 'vip3'] } });
  await group(page, 'mods').locator('summary').first().click();
  await group(page, 'vips').locator('summary').first().click();
  await expect(group(page, 'mods')).toHaveAttribute('open', '');
  await expect(group(page, 'vips')).toHaveAttribute('open', '');
  await group(page, 'mods').getByRole('button', { name: 'Загрузить с Twitch' }).click();
  await expect(group(page, 'mods').getByRole('switch')).toHaveCount(2);
  await group(page, 'vips').getByRole('button', { name: 'Загрузить с Twitch' }).click();
  await expect(group(page, 'vips').getByRole('switch')).toHaveCount(3);
  for (const s of await page.getByTestId('protect-users').getByRole('switch').all()) await expect(s).toHaveAttribute('aria-checked', 'true'); // protected by default
  // one VIP may be muted
  await group(page, 'vips').getByRole('switch', { name: 'Защитить vip2 от мута' }).click();
  await expect(group(page, 'vips').getByRole('switch', { name: 'Защитить vip2 от мута' })).toHaveAttribute('aria-checked', 'false');
  await expect(group(page, 'vips').getByRole('switch', { name: 'Защитить vip1 от мута' })).toHaveAttribute('aria-checked', 'true');
  await save(page).click();
  await expect(page.getByText('Есть несохранённые изменения')).toHaveCount(0);
  const s = await saved(sandbox);
  expect([...s.protect_users].sort()).toEqual(['mod1', 'mod2', 'vip1', 'vip3']);
  expect(s.unprotect_users).toEqual(['vip2']);
  // the calls went to the account's own channel with the token and the client id
  const lists = api.calls.filter((c) => c.path.endsWith('/moderators') || c.path.endsWith('/vips'));
  expect(lists.map((c) => c.query.broadcaster_id)).toEqual(['1000', '1000']);
  expect(lists.every((c) => c.authorization === 'Bearer AT-SECRET' && c.clientId === 'cid1234567')).toBe(true);
  expect(await page.locator('body').innerText()).not.toContain('SECRET');
  expect(problems).toEqual([]);
});

test('settings: "protect all" and "allow muting all" for one list, and the exception list shows who may be muted', async ({ page }) => {
  const { sandbox } = await open(page, { api: { mods: ['m1', 'm2'] } });
  await group(page, 'mods').locator('summary').first().click();
  await group(page, 'mods').getByRole('button', { name: 'Загрузить с Twitch' }).click();
  await expect(group(page, 'mods').getByRole('switch')).toHaveCount(2);
  await group(page, 'mods').getByRole('button', { name: 'Разрешить мутить всех' }).click();
  for (const s of await group(page, 'mods').getByRole('switch').all()) await expect(s).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('protect-users').locator('.chip', { hasText: 'm1' })).toBeVisible(); // in "Можно мутить"
  await group(page, 'mods').getByRole('button', { name: 'Защитить всех' }).click();
  for (const s of await group(page, 'mods').getByRole('switch').all()) await expect(s).toHaveAttribute('aria-checked', 'true');
  await save(page).click();
  await expect(page.getByText('Есть несохранённые изменения')).toHaveCount(0);
  const s = await saved(sandbox);
  expect([...s.protect_users].sort()).toEqual(['m1', 'm2']);
  expect(s.unprotect_users).toEqual([]);
});

test('settings: another channel cannot be fetched (Twitch answers only the owner): explained, and the pasted /mods answer fills the list', async ({ page }) => {
  const { sandbox, api } = await open(page, { api: { mods: ['nope'] } });
  await page.locator('#st-protect-ch').selectOption('friend');
  await group(page, 'mods').locator('summary').first().click();
  await expect(group(page, 'mods').getByRole('button', { name: 'Загрузить с Twitch' })).toBeDisabled();
  await expect(group(page, 'mods').getByText('Twitch отдаёт список только владельцу канала')).toBeVisible();
  await group(page, 'mods').locator('.protect-paste summary').click();
  await group(page, 'mods').getByLabel('Или вставьте ответ чата').fill('The moderators of this channel are: Alice, bob_1, @Carol');
  await group(page, 'mods').getByRole('button', { name: 'Добавить из текста' }).click();
  await expect(group(page, 'mods').getByText('Добавлено ников: 3')).toBeVisible();
  await expect(group(page, 'mods').getByRole('switch')).toHaveCount(3);
  await group(page, 'mods').getByLabel('Или вставьте ответ чата').fill('This channel does not have any moderators.');
  await group(page, 'mods').getByRole('button', { name: 'Добавить из текста' }).click();
  await expect(group(page, 'mods').getByText('Не нашёл ни одного ника.')).toBeVisible();
  await save(page).click();
  await expect(page.getByText('Есть несохранённые изменения')).toHaveCount(0);
  expect([...(await saved(sandbox)).protect_users].sort()).toEqual(['alice', 'bob_1', 'carol']);
  expect(api.calls.filter((c) => c.path.endsWith('/moderators'))).toHaveLength(0); // nothing was asked of Twitch
});

test('settings: a plugin before 0.9.0 cannot keep someone unprotected, so the off switches are disabled with a note', async ({ page }) => {
  await open(page, { version: '0.8.3', api: { vips: ['v1'] } });
  await group(page, 'vips').locator('summary').first().click();
  await group(page, 'vips').getByRole('button', { name: 'Загрузить с Twitch' }).click();
  await expect(group(page, 'vips').getByRole('switch', { name: 'Защитить v1 от мута' })).toBeDisabled();
  await expect(page.getByTestId('protect-users').getByText('с версией плагина 0.9.0 или новее')).toBeVisible();
});

test('settings: not logged in: the fetch buttons are disabled and say why, pasting still works', async ({ page }) => {
  await mockTwitch(page);
  await mockHelixApi(page);
  const sandbox = await openSite(page, { version: '0.9.0', config: config() });
  await sandbox.writeHelix(JSON.stringify({ client_id: 'cid1234567' }));
  await pickPluginFolder(page);
  await group(page, 'mods').locator('summary').first().click();
  await expect(group(page, 'mods').getByRole('button', { name: 'Загрузить с Twitch' })).toBeDisabled();
  await expect(group(page, 'mods').getByText('Войдите через Twitch')).toBeVisible();
});

test('redeem editor: a new reward needs the moderator check; the owner of the channel passes, then the reward can be added', async ({ page }) => {
  const { api } = await open(page);
  const form = await openEditor(page);
  await form.getByLabel('Название награды').fill('Тихий час');
  await form.getByLabel('Время мута').fill('10m');
  const done = form.getByRole('button', { name: 'Готово' });
  await expect(done).toBeDisabled();
  await expect(form.getByText('Сначала проверьте свои права на канале.')).toBeVisible();
  await form.getByRole('button', { name: 'Проверить мои права на канале' }).click();
  await expect(form.getByTestId('mod-check-result')).toContainText('Вы владелец канала streamer.');
  expect(api.calls).toHaveLength(0); // the owner is known from the login: no request
  await expect(done).toBeEnabled();
  await done.click();
  await expect(page.locator('.rule-row')).toHaveCount(1);
});

test('redeem editor: a moderator of another channel passes; changing the channel asks for a new check; a non-moderator is blocked', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  const { api } = await open(page, { api: { moderated: ['friend'] } });
  const form = await openEditor(page);
  await form.getByLabel('Название награды').fill('Тихий час');
  await form.getByLabel('Время мута').fill('10m');
  const done = form.getByRole('button', { name: 'Готово' });
  await form.getByLabel('Канал', { exact: true }).selectOption('friend');
  await form.getByRole('button', { name: 'Проверить мои права на канале' }).click();
  await expect(form.getByTestId('mod-check-result')).toContainText('Вы модератор канала friend.');
  await expect(done).toBeEnabled();
  expect(api.calls.map((c) => c.path)).toEqual(['/helix/moderation/channels']);
  expect(api.calls[0]!.query.user_id).toBe('1000');
  // another channel: the result is for the old one
  await form.getByLabel('Канал', { exact: true }).selectOption('streamer');
  await expect(form.getByTestId('mod-check-result')).toHaveCount(0);
  await expect(done).toBeDisabled();
  // and back: it must be checked again
  await form.getByLabel('Канал', { exact: true }).selectOption('friend');
  await expect(done).toBeDisabled();
  const own = new URL(page.url()).host;
  expect([...hosts].filter((h) => h !== own).sort()).toEqual(['api.twitch.tv']);
});

test('redeem editor: not a moderator there: the reward cannot be added and the reason is on screen', async ({ page }) => {
  await open(page, { api: { moderated: ['somebody_else'] } });
  const form = await openEditor(page);
  await form.getByLabel('Канал', { exact: true }).selectOption('friend');
  await form.getByRole('button', { name: 'Проверить мои права на канале' }).click();
  await expect(form.getByRole('alert').filter({ hasText: 'Вы не модератор канала friend' })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Готово' })).toBeDisabled();
  await expect(form.getByText('Награду нельзя добавить, пока вы не модератор этого канала.')).toBeVisible();
});

test('redeem editor: a login from before the scope existed is asked to log in again; the owner check still works', async ({ page }) => {
  await open(page, { scopes: ['channel:read:redemptions', 'moderation:read', 'channel:read:vips'], api: { moderated: ['friend'] } });
  await expect(page.getByTestId('twitch-relogin')).toBeVisible(); // Settings
  const form = await openEditor(page);
  await form.getByLabel('Канал', { exact: true }).selectOption('friend');
  await form.getByRole('button', { name: 'Проверить мои права на канале' }).click();
  await expect(form.getByRole('alert').filter({ hasText: 'нужны новые права' })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Готово' })).toBeDisabled();
  await form.getByLabel('Канал', { exact: true }).selectOption('streamer');
  await form.getByRole('button', { name: 'Проверить мои права на канале' }).click();
  await expect(form.getByTestId('mod-check-result')).toContainText('Вы владелец канала');
});

test('redeem editor: an expired token is explained and the reward stays blocked', async ({ page }) => {
  await open(page, { api: { error: { status: 401, message: 'Invalid OAuth token' } } });
  const form = await openEditor(page);
  await form.getByLabel('Канал', { exact: true }).selectOption('friend');
  await form.getByRole('button', { name: 'Проверить мои права на канале' }).click();
  await expect(form.getByRole('alert').filter({ hasText: 'Токен Twitch истёк' })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Готово' })).toBeDisabled();
});

test('redeem editor: editing an existing reward is never blocked, and the protection lists are here too', async ({ page }) => {
  await open(page, { config: config({ redeems: [{ id: 1, channel: 'friend', title: 'Мут', action: 'timeout', seconds: 600, enabled: true }], next_redeem_id: 2 }), api: { mods: ['m1'] } });
  await page.getByRole('button', { name: 'Награды', exact: true }).click();
  await page.locator('[data-act="edit"]').first().click();
  const form = page.getByRole('region', { name: /Мут/ });
  await expect(form.getByRole('button', { name: 'Готово' })).toBeEnabled();
  await expect(form.getByTestId('redeem-protect')).toBeVisible();
});

test('redeem editor in a demo or an old plugin: no Twitch check, nothing blocked', async ({ page }) => {
  await mockTwitch(page);
  const sandbox = await openSite(page, { version: '0.7.2', config: config({ helix_enabled: false }) });
  await sandbox.writeHelix(LOGIN());
  await pickPluginFolder(page);
  await page.getByRole('button', { name: 'Награды', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить награду' }).click();
  const form = page.getByRole('region', { name: 'Новая награда' });
  await expect(form.getByTestId('mod-check')).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Готово' })).toBeEnabled();
});

test('a phone: the protection card and the editor do not scroll sideways and have no accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page, { api: { mods: ['a_long_moderator_login_name', 'm2'], vips: ['v1'], moderated: ['friend'] } });
  await group(page, 'mods').locator('summary').first().click();
  await group(page, 'mods').getByRole('button', { name: 'Загрузить с Twitch' }).click();
  await group(page, 'vips').locator('summary').first().click();
  await expect(group(page, 'mods').getByRole('switch')).toHaveCount(2);
  const overflow = () =>
    page.evaluate(() => {
      const de = document.documentElement;
      if (de.scrollWidth <= de.clientWidth) return [];
      return [`scrollWidth=${de.scrollWidth} clientWidth=${de.clientWidth}`, ...Array.from(document.querySelectorAll('body *')).filter((e) => e.getBoundingClientRect().right > de.clientWidth + 0.5).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${(e as HTMLElement).className}`)];
    });
  const axe = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`);
  expect(await overflow()).toEqual([]);
  expect(await axe()).toEqual([]);
  const form = await openEditor(page);
  await form.getByLabel('Канал', { exact: true }).selectOption('friend');
  await form.getByRole('button', { name: 'Проверить мои права на канале' }).click();
  await expect(form.getByTestId('mod-check-result')).toBeVisible();
  expect(await overflow()).toEqual([]);
  expect(await axe()).toEqual([]);
});
