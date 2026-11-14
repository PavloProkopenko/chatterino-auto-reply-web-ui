import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as v from 'valibot';
import { normalise } from '../shared/config.ts';
import { featuresFor } from '../shared/features.ts';
import { defaultRoots, discover, inspectConfigPath } from './discover.ts';
import { createSettings, settingsDir } from './settings.ts';
import { createStore } from './store.ts';

export interface Asset {
  type: string;
  body: string | Uint8Array;
}

export interface AppOptions {
  /** Where to look for plugin installs. Default: the OS location. */
  roots?: string[];
  /** Where the app keeps its own settings. Default: the OS profile directory. */
  settingsDir?: string;
  /** Receives one line per request: method, path, status. Never bodies, queries or config content. */
  log?: (line: string) => void;
  /** Static files by exact URL path ("/" is the page). */
  assets?: Map<string, Asset>;
  /** Largest accepted request body. Default 5 MB. */
  maxBodyBytes?: number;
  /** Receives the page's heartbeats and goodbyes (see lifecycle.ts). */
  lifecycle?: { heartbeat(tabId: string): void; bye(tabId: string): void };
}

export interface RunningServer {
  port: number;
  address: string;
  token: string;
  /** The URL to open: the token travels in the fragment, so it is never sent to a server or logged. */
  url: string;
  close(): Promise<void>;
}

const DEFAULT_MAX_BODY = 5 * 1024 * 1024;
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

const digest = (s: string) => createHash('sha256').update(s).digest();
const HASH = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));
const SelectBody = v.object({ path: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)) });
// valibot's record() copies arrays into objects, so test the raw input instead.
const PlainObject = v.custom<Record<string, unknown>>((o) => typeof o === 'object' && o !== null && !Array.isArray(o));
const SaveBody = v.object({ baseHash: HASH, config: PlainObject });
const TabBody = v.object({ tab: v.pipe(v.string(), v.regex(/^[\w-]{8,64}$/)) });
const RestoreBody = v.object({ name: v.pipe(v.string(), v.maxLength(200)) });

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function startServer(opts: AppOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? (() => {});
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const assets = opts.assets ?? new Map<string, Asset>();
  const settings = createSettings(opts.settingsDir ?? settingsDir(process.platform, process.env));
  const store = createStore();
  const roots = opts.roots ?? defaultRoots(process.platform, process.env);
  const token = randomBytes(32).toString('hex');
  const tokenDigest = digest(token);
  // The confirmed config file. Remembered paths count as confirmed; auto-detection alone does not.
  let selected: string | null = (await settings.read()).configPath ?? null;
  let port = 0;

  const needSelected = (): string => {
    if (!selected) throw new HttpError(409, 'no-config-selected');
    return selected;
  };

  async function readJson<T>(req: http.IncomingMessage, schema: v.GenericSchema<unknown, T>): Promise<T> {
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'json-required');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > maxBody) throw new HttpError(413, 'too-large');
      chunks.push(chunk as Buffer);
    }
    let data: unknown;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'bad-json');
    }
    const parsed = v.safeParse(schema, data);
    if (!parsed.success) throw new HttpError(400, 'bad-request');
    return parsed.output;
  }

  type Handler = (req: http.IncomingMessage) => Promise<{ status?: number; body: unknown }>;

  async function configInfo(path: string) {
    const info = await inspectConfigPath(path);
    const pluginVersion = info.ok ? info.pluginVersion : null;
    return { path, pluginVersion, features: featuresFor(pluginVersion) };
  }

  const routes: Record<string, Partial<Record<string, Handler>>> = {
    '/api/discover': {
      GET: async () => ({ body: { candidates: await discover(roots), selected } }),
    },
    '/api/config/select': {
      POST: async (req) => {
        const { path } = await readJson(req, SelectBody);
        const info = await inspectConfigPath(path);
        if (!info.ok) throw new HttpError(400, info.error);
        await settings.update({ configPath: path });
        selected = path;
        return { body: info };
      },
    },
    '/api/config': {
      GET: async () => {
        // Not an error: this is the normal first-run state, so it is a 200 (no red entry in the browser console).
        if (!selected) return { body: { status: 'no-config-selected' } };
        const path = selected;
        const base = await configInfo(path);
        const r = await store.load(path);
        if (r.status === 'ok') return { body: { status: 'ok', ...base, snapshot: r.snapshot, config: r.config, exact: r.exact } };
        if (r.status === 'missing') return { body: { status: 'missing', ...base } };
        return { body: { status: 'invalid', readOnly: true, ...base, snapshot: r.snapshot, error: r.error, text: r.text } };
      },
    },
    '/api/config/save': {
      POST: async (req) => {
        const path = needSelected();
        const { baseHash, config } = await readJson(req, SaveBody);
        const r = await store.save(path, baseHash, normalise(config));
        return { status: r.status === 'saved' ? 200 : 409, body: r };
      },
    },
    '/api/config/create-default': {
      POST: async (req) => {
        const path = needSelected();
        await readJson(req, PlainObject);
        const r = await store.createDefault(path);
        return { status: r.status === 'created' ? 201 : 409, body: r };
      },
    },
    '/api/heartbeat': {
      POST: async (req) => {
        opts.lifecycle?.heartbeat((await readJson(req, TabBody)).tab);
        return { body: { ok: true } };
      },
    },
    '/api/bye': {
      POST: async (req) => {
        opts.lifecycle?.bye((await readJson(req, TabBody)).tab);
        return { body: { ok: true } };
      },
    },
    '/api/backups': {
      GET: async () => ({ body: { backups: await store.listBackups(needSelected()) } }),
    },
    '/api/backups/restore': {
      POST: async (req) => {
        const path = needSelected();
        const { name } = await readJson(req, RestoreBody);
        try {
          const r = await store.restore(path, name);
          return { status: r.status === 'restored' ? 200 : 409, body: r };
        } catch (e) {
          if (e instanceof Error && e.message === 'invalid backup name') throw new HttpError(400, 'bad-backup-name');
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'backup-not-found');
          throw e;
        }
      },
    },
  };

  const send = (res: http.ServerResponse, status: number, type: string, body: string | Uint8Array) => {
    res.writeHead(status, { 'content-type': type, ...SECURITY_HEADERS });
    res.end(body);
  };
  const sendJson = (res: http.ServerResponse, status: number, body: unknown) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));

  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    res.on('finish', () => log(`${req.method} ${path} ${res.statusCode}`));
    void (async () => {
      try {
        const host = req.headers.host ?? '';
        if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(421, 'bad-host');

        if (!path.startsWith('/api/')) {
          const asset = req.method === 'GET' || req.method === 'HEAD' ? assets.get(path) : undefined;
          if (!asset) throw new HttpError(404, 'not-found');
          return send(res, 200, asset.type, req.method === 'HEAD' ? '' : asset.body);
        }

        const given = digest(String(req.headers['x-session-token'] ?? ''));
        if (!timingSafeEqual(given, tokenDigest)) throw new HttpError(403, 'bad-token');
        const origin = req.headers.origin;
        if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) throw new HttpError(403, 'bad-origin');

        const route = routes[path];
        if (!route) throw new HttpError(404, 'not-found');
        const handler = route[req.method ?? ''];
        if (!handler) throw new HttpError(405, 'method-not-allowed');
        const out = await handler(req);
        sendJson(res, out.status ?? 200, out.body);
      } catch (e) {
        if (e instanceof HttpError) {
          if (e.status === 413) res.setHeader('connection', 'close');
          sendJson(res, e.status, { error: e.code });
        } else {
          sendJson(res, 500, { error: 'internal' }); // no details: they could carry file paths or content
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as AddressInfo;
  port = addr.port;

  return {
    port,
    address: addr.address,
    token,
    url: `http://127.0.0.1:${port}/#${token}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
