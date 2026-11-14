import { test as base, expect, type Page } from '@playwright/test';

export const DEV = 'http://127.0.0.1:5199';

export const sampleConfig = (over: Record<string, unknown> = {}) =>
  JSON.stringify(
    {
      version: 1,
      active_until: 'forever',
      channels: ['streamer'],
      ignore_users: {},
      protect_users: {},
      per_user_cooldown: 60,
      per_rule_cooldown: 10,
      global_min_gap: 2,
      only_when_live: false,
      next_rule_id: 2,
      rules: [{ id: 1, enabled: true, reply: 'один', channels: {}, conditions: [{ type: 'word', match: 'x' }] }],
      next_timer_id: 1,
      timers: {},
      next_redeem_id: 1,
      redeems: {},
      ...over,
    },
    null,
    2,
  ) + '\n';

/**
 * A stand-in for the user's plugin folder. The browser's private file system (OPFS) has the same handle API as a
 * real folder but, unlike a native dialog, can be driven by a test. The page's pickers are replaced to return it.
 * What a test does with it mirrors reality: `write` is the running plugin saving the file.
 */
export interface Sandbox {
  install(opts?: { config?: string | null; version?: string }): Promise<void>;
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  names(): Promise<string[]>;
}

const PICKERS = () => {
  const w = window as unknown as Record<string, unknown>;
  const plugin = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('plugin');
  w.showDirectoryPicker = async () => plugin();
  w.showOpenFilePicker = async () => [await (await (await plugin()).getDirectoryHandle('data')).getFileHandle('config.json')];
};

/** Permission and write-failure switches for tests (`sessionStorage.__perm`, `window.__busy`, `window.__denied`). */
const SWITCHES = () => {
  const proto = FileSystemHandle.prototype as unknown as Record<string, unknown>;
  proto.queryPermission = async () => sessionStorage.getItem('__perm') ?? 'granted';
  proto.requestPermission = async () => {
    sessionStorage.setItem('__perm', 'granted');
    (window as unknown as Record<string, unknown>).__denied = false;
    return 'granted';
  };
  const original = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = function (this: FileSystemFileHandle, ...args) {
    const w = window as unknown as Record<string, unknown>;
    if (w.__busy) throw new DOMException('locked by another program', 'NoModificationAllowedError');
    if (w.__denied) throw new DOMException('no permission', 'NotAllowedError');
    return original.apply(this, args);
  };
};

export function sandboxFor(page: Page): Sandbox {
  return {
    async install({ config = sampleConfig(), version = '0.5.0' } = {}) {
      await page.evaluate(
        async ({ config, version }) => {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry('plugin', { recursive: true }).catch(() => undefined);
          const plugin = await root.getDirectoryHandle('plugin', { create: true });
          const put = async (dir: FileSystemDirectoryHandle, name: string, text: string) => {
            const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
            await w.write(text);
            await w.close();
          };
          await put(plugin, 'info.json', JSON.stringify({ name: 'Auto Reply', version }));
          if (config !== null) await put(await plugin.getDirectoryHandle('data', { create: true }), 'config.json', config);
        },
        { config, version },
      );
    },
    read: () =>
      page.evaluate(async () => {
        try {
          const data = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('plugin')).getDirectoryHandle('data');
          return await (await (await data.getFileHandle('config.json')).getFile()).text();
        } catch {
          return null;
        }
      }),
    write: (text) =>
      page.evaluate(async (text) => {
        const data = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('plugin')).getDirectoryHandle('data');
        const w = await (await data.getFileHandle('config.json', { create: true })).createWritable();
        await w.write(text);
        await w.close();
      }, text),
    names: () =>
      page.evaluate(async () => {
        const data = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('plugin')).getDirectoryHandle('data');
        const out: string[] = [];
        for await (const [name] of (data as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) out.push(name);
        return out.sort();
      }),
  };
}

/** Open the site with the stub pickers and switches installed, and a plugin folder in place. */
export async function openSite(page: Page, opts: { config?: string | null; version?: string; direct?: boolean; install?: boolean } = {}): Promise<Sandbox> {
  if (opts.direct !== false) await page.addInitScript(PICKERS);
  else await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showDirectoryPicker;
    delete w.showOpenFilePicker;
  });
  await page.addInitScript(SWITCHES);
  await page.goto('/');
  const sandbox = sandboxFor(page);
  if (opts.install !== false) await sandbox.install({ config: opts.config === undefined ? sampleConfig() : opts.config, version: opts.version ?? '0.5.0' });
  return sandbox;
}

/** Welcome screen -> pick the folder -> Settings. */
export async function pickPluginFolder(page: Page) {
  await page.getByRole('button', { name: 'Выбрать папку плагина' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
}

/** Fails a test on any CSP violation or uncaught page error: they mean the build is broken under the strict CSP. */
export function watchPage(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text());
  });
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error('CSP violation: ' + e.violatedDirective + ' ' + e.blockedURI));
  });
  return problems;
}

export { base as test, expect };
