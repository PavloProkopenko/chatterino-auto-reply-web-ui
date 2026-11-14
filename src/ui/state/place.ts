export type Platform = 'mac' | 'win' | 'other';

export function detectPlatform(userAgent: string): Platform {
  const p = userAgent.toLowerCase();
  return p.includes('win') ? 'win' : p.includes('mac') ? 'mac' : 'other';
}

/** Where the Chatterino-family plugins usually live. UNVERIFIED for Leafyrino's real folder on every system. */
export function pluginsDir(p: Platform): string {
  return p === 'win' ? '%APPDATA%\\Chatterino2\\Plugins\\' : p === 'mac' ? '~/Library/Application Support/chatterino/Plugins/' : '~/.local/share/chatterino/Plugins/';
}

const PLACEHOLDER = '<папка-плагина>';
// Anything a shell could read as more than a name stays out of the command; the placeholder is shown instead.
const SAFE_FOLDER = /^[\p{L}\p{N} ._-]+$/u;

/** A one-line command that moves the downloaded config.json into the plugin's data folder. */
export function placeCommand(p: Platform, folder: string | null): string {
  const name = folder && SAFE_FOLDER.test(folder) ? folder : PLACEHOLDER;
  if (p === 'win') return `copy /Y "%USERPROFILE%\\Downloads\\config.json" "%APPDATA%\\Chatterino2\\Plugins\\${name}\\data\\config.json"`;
  // $HOME, not ~: a tilde does not expand inside double quotes
  const base = p === 'mac' ? '$HOME/Library/Application Support/chatterino/Plugins' : '$HOME/.local/share/chatterino/Plugins';
  return `cp "$HOME/Downloads/config.json" "${base}/${name}/data/config.json"`;
}
