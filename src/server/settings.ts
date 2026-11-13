import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import * as v from 'valibot';

/** The app's own settings; kept in the user's profile, never inside the plugin folder. */
const Schema = v.object({
  configPath: v.optional(v.string()),
  firstRunDone: v.optional(v.boolean(), false),
});
export type Settings = { configPath?: string; firstRunDone: boolean };

export function settingsDir(platform: string, env: Record<string, string | undefined>): string {
  if (env.AUTO_REPLY_WEB_DATA) return env.AUTO_REPLY_WEB_DATA;
  if (platform === 'win32') return win32.join(env.APPDATA ?? '', 'auto-reply-web');
  if (platform === 'darwin') return posix.join(env.HOME ?? '', 'Library', 'Application Support', 'auto-reply-web');
  return posix.join(env.HOME ?? '', '.config', 'auto-reply-web');
}

const isConfigPath = (p: string) => /(^|[\\/])config\.json$/.test(p);

export function createSettings(dir: string) {
  const file = join(dir, 'settings.json');

  async function read(): Promise<Settings> {
    try {
      const parsed = v.safeParse(Schema, JSON.parse(await readFile(file, 'utf8')));
      if (!parsed.success) return { firstRunDone: false };
      const { configPath, firstRunDone } = parsed.output;
      // A remembered path must still look like a config.json, whatever the file says.
      return configPath && isConfigPath(configPath) ? { configPath, firstRunDone } : { firstRunDone };
    } catch {
      return { firstRunDone: false };
    }
  }

  async function update(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await read()), ...patch };
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp-${randomBytes(6).toString('hex')}`;
    try {
      await writeFile(tmp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
      await rename(tmp, file);
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
    return next;
  }

  return { read, update };
}
