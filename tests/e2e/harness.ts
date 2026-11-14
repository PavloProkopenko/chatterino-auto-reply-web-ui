import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

const devstack = join(import.meta.dirname, '../../scripts/devstack.ts');

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

export interface App {
  url: string;
  pluginDir: string;
  configPath: string;
  dataDir: string;
  exited: Promise<number | null>;
  read(): Promise<string>;
  write(text: string): Promise<void>;
  backups(): Promise<string[]>;
  stop(): Promise<void>;
}

export interface StartOptions {
  config?: string | null; // null: plugin installed but no config file yet
  pluginVersion?: string;
  /** Serve through the Vite dev server (source modules, no CSP) instead of the production build. */
  dev?: boolean;
}

export async function startApp(opts: StartOptions = {}): Promise<App> {
  const tmp = await mkdtemp(join(tmpdir(), 'e2e-'));
  const pluginDir = join(tmp, 'roots', 'Chatterino', 'Plugins', 'auto-reply');
  const dataDir = join(tmp, 'app-data');
  await mkdir(join(pluginDir, 'data'), { recursive: true });
  await writeFile(join(pluginDir, 'info.json'), JSON.stringify({ name: 'Auto Reply', version: opts.pluginVersion ?? '0.5.0' }));
  const configPath = join(pluginDir, 'data', 'config.json');
  if (opts.config !== null) await writeFile(configPath, opts.config ?? sampleConfig());

  // The production build (dist-e2e, made by `pnpm test:e2e`) behind `vite preview` with the real CSP, plus the API stand-in.
  const child: ChildProcess = spawn(
    process.execPath,
    opts.dev
      ? ['--experimental-strip-types', '--no-warnings', devstack, 'dev', '--no-open', '--port', '5199', '--roots', join(tmp, 'roots'), '--data', dataDir]
      : ['--experimental-strip-types', '--no-warnings', devstack, 'preview', '--mode', 'e2e', '--no-build', '--roots', join(tmp, 'roots'), '--data', dataDir],
    { env: process.env },
  );
  const exited = new Promise<number | null>((res) => child.on('exit', (code) => res(code)));
  const url = await new Promise<string>((resolve, reject) => {
    let seen = '';
    child.stdout!.on('data', (d) => {
      seen += String(d);
      const line = seen.split('\n').find((l) => l.startsWith('http://'));
      if (line) resolve(line);
    });
    child.on('error', reject);
    setTimeout(() => reject(new Error('server did not start')), 10_000);
  });
  return {
    url,
    pluginDir,
    configPath,
    dataDir,
    exited,
    read: () => readFile(configPath, 'utf8'),
    write: (text) => writeFile(configPath, text),
    backups: async () => (await readdir(join(pluginDir, 'data'))).filter((n) => n.startsWith('config.json.bak-')),
    async stop() {
      child.kill();
      await exited;
      await rm(tmp, { recursive: true, force: true });
    },
  };
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

export const test = base.extend<{ app: App }>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const app = await startApp();
    await use(app);
    await app.stop();
  },
});
export { expect };
