import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export interface Candidate {
  configPath: string;
  pluginDir: string;
  appFolder: string;
  pluginVersion: string | null;
  configExists: boolean;
  mtimeMs: number | null;
}

const PLUGIN_NAME = 'Auto Reply';

/** OS roots that hold one folder per Chatterino-style app. */
export function defaultRoots(platform: string, env: Record<string, string | undefined>): string[] {
  if (platform === 'darwin') return env.HOME ? [`${env.HOME}/Library/Application Support`] : [];
  if (platform === 'win32') return env.APPDATA ? [env.APPDATA] : [];
  return env.HOME ? [`${env.HOME}/.local/share`] : [];
}

async function readInfo(dir: string): Promise<{ name: string; version: string | null } | null> {
  try {
    const info = JSON.parse(await readFile(join(dir, 'info.json'), 'utf8')) as { name?: unknown; version?: unknown };
    if (typeof info.name !== 'string') return null;
    return { name: info.name, version: typeof info.version === 'string' ? info.version : null };
  } catch {
    return null;
  }
}

const list = (dir: string) => readdir(dir, { withFileTypes: true }).catch(() => []);

/** Scans `<root>/<app>/Plugins/<plugin>/info.json` for the Auto Reply plugin. Newest config first. */
export async function discover(roots: string[]): Promise<Candidate[]> {
  const found: Candidate[] = [];
  for (const root of roots) {
    for (const app of await list(root)) {
      if (!app.isDirectory()) continue;
      for (const plug of await list(join(root, app.name, 'Plugins'))) {
        if (!plug.isDirectory()) continue;
        const pluginDir = join(root, app.name, 'Plugins', plug.name);
        const info = await readInfo(pluginDir);
        if (info?.name !== PLUGIN_NAME) continue;
        const configPath = join(pluginDir, 'data', 'config.json');
        const st = await stat(configPath).catch(() => null);
        found.push({ configPath, pluginDir, appFolder: app.name, pluginVersion: info.version, configExists: st !== null, mtimeMs: st?.mtimeMs ?? null });
      }
    }
  }
  return found.sort((a, b) => (b.mtimeMs ?? -1) - (a.mtimeMs ?? -1));
}

export type InspectResult =
  | { ok: true; path: string; exists: boolean; pluginVersion: string | null; warnings: ('no-plugin-info' | 'other-plugin')[] }
  | { ok: false; error: 'not-config-json' };

/** Checks a path the user typed or picked: it must be named config.json; warn if it does not look like the plugin's. */
export async function inspectConfigPath(path: string): Promise<InspectResult> {
  if (basename(path) !== 'config.json') return { ok: false, error: 'not-config-json' };
  const exists = (await stat(path).catch(() => null)) !== null;
  const info = await readInfo(dirname(dirname(path)));
  const warnings: ('no-plugin-info' | 'other-plugin')[] = [];
  if (!info) warnings.push('no-plugin-info');
  else if (info.name !== PLUGIN_NAME) warnings.push('other-plugin');
  return { ok: true, path, exists, pluginVersion: info?.name === PLUGIN_NAME ? info.version : null, warnings };
}
