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
