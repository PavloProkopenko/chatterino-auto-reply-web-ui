import { spawn } from 'node:child_process';

export function browserCommand(platform: string, url: string): { cmd: string; args: string[] } {
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  if (platform === 'win32') return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  return { cmd: 'xdg-open', args: [url] };
}

interface Spawned {
  once(event: string, cb: (e?: Error) => void): unknown;
  unref(): void;
}

/** Opens the default browser. Resolves false if the opener cannot be started, so the caller can print the URL. */
export function openBrowser(
  url: string,
  platform: string = process.platform,
  start: (cmd: string, args: string[]) => Spawned = (cmd, args) => spawn(cmd, args, { stdio: 'ignore', detached: true }),
): Promise<boolean> {
  const { cmd, args } = browserCommand(platform, url);
  return new Promise((resolve) => {
    try {
      const child = start(cmd, args);
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
