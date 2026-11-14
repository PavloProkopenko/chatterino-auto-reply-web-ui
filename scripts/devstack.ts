// Local development stack: Vite (hot reload) or `vite preview` (the production build, with the real security headers)
// in front of the existing API server, which stands in for the user's file until the browser file layer exists.
//   pnpm dev                      Vite dev server, opens the browser
//   pnpm preview                  builds, then serves dist with the production CSP
//   options: --roots a:b  --data <dir>  --port N  --mode e2e  --no-open
// First run creates a synthetic plugin install in .app-data/ (gitignored); delete that folder to start over.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { createServer, preview, build, type ProxyOptions } from 'vite';
import { startServer } from '../src/server/app.ts';
import { SECURITY_HEADERS } from '../src/shared/security-headers.ts';

const root = resolve(import.meta.dirname, '..');
const [command = 'dev', ...rest] = process.argv.slice(2);
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const mode = opt('mode');
const open = !rest.includes('--no-open');

function syntheticInstall(base: string): string {
  const plugin = join(base, 'Chatterino', 'Plugins', 'auto-reply');
  const config = join(plugin, 'data', 'config.json');
  if (!existsSync(config)) {
    mkdirSync(join(plugin, 'data'), { recursive: true });
    writeFileSync(join(plugin, 'info.json'), JSON.stringify({ name: 'Auto Reply', version: '0.5.0' }));
    const sample = {
      version: 1, active_until: 'forever', channels: ['streamer'], ignore_users: ['nightbot'], protect_users: {},
      per_user_cooldown: 60, per_rule_cooldown: 10, global_min_gap: 2, only_when_live: false, skip_mods: false,
      next_rule_id: 2, rules: [{ id: 1, enabled: true, reply: 'Донаты тут: {user}', channels: {}, conditions: [{ type: 'word', match: 'донат' }] }],
      next_timer_id: 1, timers: {}, next_redeem_id: 1, redeems: {},
    };
    writeFileSync(config, JSON.stringify(sample, null, 2) + '\n');
  }
  return base;
}

const dataDir = opt('data') ?? join(root, '.app-data');
const roots = opt('roots')?.split(delimiter).filter(Boolean) ?? [syntheticInstall(join(dataDir, 'dev-plugin'))];
const backend = await startServer({ roots, settingsDir: join(dataDir, 'settings'), log: () => {} });

// The browser talks to the UI origin only; /api goes to the backend with a Host and Origin it accepts.
const proxy: Record<string, ProxyOptions> = {
  '/api': {
    target: `http://127.0.0.1:${backend.port}`,
    changeOrigin: true,
    configure: (p) => p.on('proxyReq', (req) => req.removeHeader('origin')),
  },
};
const port = opt('port') ? Number(opt('port')) : undefined;
const configFile = join(root, 'vite.config.ts');
const hash = `#${backend.token}`;

if (command === 'preview') {
  if (!rest.includes('--no-build')) await build({ configFile, mode, logLevel: 'warn' });
  const server = await preview({ configFile, mode, preview: { ...(port ? { port } : {}), host: '127.0.0.1', proxy, headers: SECURITY_HEADERS, open: false } });
  console.log(`http://127.0.0.1:${server.config.preview.port}/${hash}`);
} else {
  const server = await createServer({ configFile, mode, server: { ...(port ? { port } : {}), host: '127.0.0.1', proxy, open: open ? `/${hash}` : false } });
  await server.listen();
  console.log(`http://127.0.0.1:${server.config.server.port}/${hash}`);
}

const stop = () => void backend.close().finally(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
