import { describe, expect, test } from 'vitest';
import { browserCommand, openBrowser } from '../../src/server/open-browser.ts';

describe('browserCommand', () => {
  test('per platform; the URL is passed as one argument, never through a shell string', () => {
    const url = 'http://127.0.0.1:5000/#abc';
    expect(browserCommand('darwin', url)).toEqual({ cmd: 'open', args: [url] });
    expect(browserCommand('win32', url)).toEqual({ cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] });
    expect(browserCommand('linux', url)).toEqual({ cmd: 'xdg-open', args: [url] });
  });
});

describe('openBrowser', () => {
  test('true when the opener starts, false when it cannot be spawned', async () => {
    const started: string[] = [];
    const good = openBrowser('http://127.0.0.1:1/#t', 'darwin', (cmd) => {
      started.push(cmd);
      return { once: (ev: string, cb: () => void) => void (ev === 'spawn' && cb()), unref() {} };
    });
    expect(await good).toBe(true);
    expect(started).toEqual(['open']);
    const bad = openBrowser('http://127.0.0.1:1/#t', 'linux', () => ({
      once: (ev: string, cb: (e?: Error) => void) => void (ev === 'error' && cb(new Error('ENOENT'))),
      unref() {},
    }));
    expect(await bad).toBe(false);
  });
});
