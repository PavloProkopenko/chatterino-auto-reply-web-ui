import { delimiter } from 'node:path';
import { startServer, type Asset } from './app.ts';
import { ASSETS } from './assets.generated.ts';
import { createLifecycle } from './lifecycle.ts';
import { openBrowser } from './open-browser.ts';

// The UI is built into the executable by scripts/build-ui.mjs (assets.generated.ts).
const assets = new Map<string, Asset>(Object.entries(ASSETS).map(([url, a]) => [url, { type: a.type, body: Buffer.from(a.data, 'base64') }]));
if (!assets.has('/')) assets.set('/', { type: 'text/plain; charset=utf-8', body: 'UI not built: run pnpm build:ui' });

const roots = process.env.AUTO_REPLY_WEB_ROOTS?.split(delimiter).filter(Boolean);

// Development and tests keep the process alive and do not open a browser.
const exitWithLastTab = process.env.AUTO_REPLY_WEB_NO_EXIT !== '1';
const stop = () => void server.close().then(() => process.exit(0)); // runs only after `server` exists
const lifecycle = exitWithLastTab ? createLifecycle({ onExit: stop }) : undefined;

const server = await startServer({ ...(roots ? { roots } : {}), assets, ...(lifecycle ? { lifecycle } : {}) });

// The token is in the fragment: it is never sent to a server and never appears in a log.
console.log(server.url);
lifecycle?.start();
if (process.env.AUTO_REPLY_WEB_NO_BROWSER !== '1' && !(await openBrowser(server.url))) {
  console.log('Не удалось открыть браузер сам. Откройте ссылку выше вручную.');
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
