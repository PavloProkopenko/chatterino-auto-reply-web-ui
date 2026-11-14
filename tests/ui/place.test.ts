import { describe, expect, test } from 'vitest';
import { detectPlatform, placeCommand, pluginsDir } from '../../src/ui/state/place.ts';

describe('detectPlatform', () => {
  test('tells the systems apart from the user agent', () => {
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('win');
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('other');
  });
});

describe('placeCommand', () => {
  test('macOS: cp with $HOME, because ~ does not expand inside quotes', () => {
    expect(placeCommand('mac', 'auto-reply')).toBe(
      'cp "$HOME/Downloads/config.json" "$HOME/Library/Application Support/chatterino/Plugins/auto-reply/data/config.json"',
    );
  });
  test('Windows: copy with environment variables', () => {
    expect(placeCommand('win', 'auto-reply')).toBe(
      'copy /Y "%USERPROFILE%\\Downloads\\config.json" "%APPDATA%\\Chatterino2\\Plugins\\auto-reply\\data\\config.json"',
    );
  });
  test('an unknown folder name leaves a visible placeholder', () => {
    expect(placeCommand('mac', null)).toContain('/Plugins/<папка-плагина>/data/');
  });
  test('a folder name that could change the meaning of the command is never put into it', () => {
    for (const bad of ['a"b', 'a$(rm -rf ~)', 'a`b`', 'a\\b', '100%', 'a\nb']) {
      expect(placeCommand('mac', bad)).toContain('<папка-плагина>');
      expect(placeCommand('win', bad)).toContain('<папка-плагина>');
    }
  });
});

describe('pluginsDir', () => {
  test('the usual location per system', () => {
    expect(pluginsDir('mac')).toBe('~/Library/Application Support/chatterino/Plugins/');
    expect(pluginsDir('win')).toBe('%APPDATA%\\Chatterino2\\Plugins\\');
    expect(pluginsDir('other')).toBe('~/.local/share/chatterino/Plugins/');
  });
});

import { linkCommand } from '../../src/ui/state/place.ts';

describe('linkCommand', () => {
  test('macOS and Linux: link under Plugins, never into an existing folder', () => {
    const r = linkCommand('mac', '~/Documents/auto-reply-plugin', '~/Library/Application Support/chatterino/Plugins/');
    expect(r).toEqual({
      ok: true,
      command: 'test ! -e "$HOME/Library/Application Support/chatterino/Plugins/auto-reply" && ln -s "$HOME/Documents/auto-reply-plugin" "$HOME/Library/Application Support/chatterino/Plugins/auto-reply" || echo "Already exists: $HOME/Library/Application Support/chatterino/Plugins/auto-reply"',
    });
  });
  test('Windows: junction, checked first', () => {
    const r = linkCommand('win', 'D:\\auto reply', '%APPDATA%\\Chatterino2\\Plugins\\');
    expect(r).toEqual({ ok: true, command: 'if exist "%APPDATA%\\Chatterino2\\Plugins\\auto-reply" (echo Already exists: auto-reply) else mklink /J "%APPDATA%\\Chatterino2\\Plugins\\auto-reply" "D:\\auto reply"' });
  });
  test('empty and unsafe input is refused, not escaped', () => {
    expect(linkCommand('mac', '', '/p')).toEqual({ ok: false, problem: 'folder-empty' });
    expect(linkCommand('mac', '/x', '  ')).toEqual({ ok: false, problem: 'plugins-empty' });
    expect(linkCommand('mac', '/x"; rm -rf ~; "', '/p')).toEqual({ ok: false, problem: 'folder-unsafe' });
    expect(linkCommand('mac', '/x/$(id)', '/p')).toEqual({ ok: false, problem: 'folder-unsafe' });
    expect(linkCommand('other', '/x', '/p`id`')).toEqual({ ok: false, problem: 'plugins-unsafe' });
    expect(linkCommand('win', 'D:\\a" & calc & "', 'C:\\p')).toEqual({ ok: false, problem: 'folder-unsafe' });
    expect(linkCommand('win', 'D:\\%TEMP%\\x', 'C:\\p')).toEqual({ ok: false, problem: 'folder-unsafe' });
  });
});
