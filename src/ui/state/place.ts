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

export const LINK_NAME = 'auto-reply';

export type LinkProblem = 'folder-empty' | 'plugins-empty' | 'folder-unsafe' | 'plugins-unsafe';
export type LinkCommand = { ok: true; command: string } | { ok: false; problem: LinkProblem };

// Paths come from text the user typed and end up inside a shell command: anything the shell or cmd could read as more than
// a path (quotes, expansion characters, line breaks) is refused instead of escaped.
const UNSAFE_POSIX = /["$`\\\n\r\0]/;
const UNSAFE_WIN = /["%^&|<>!\n\r\0]/;

/**
 * The one-line command that makes `<Plugins folder>/auto-reply` a link to `folder`. It refuses to run when something is
 * already at the link's place (so an existing plugin folder is never written into), with the app closed.
 */
export function linkCommand(p: Platform, folder: string, pluginsDirPath: string): LinkCommand {
  const f = folder.trim();
  const d = pluginsDirPath.trim().replace(/[\\/]+$/, '');
  if (!f) return { ok: false, problem: 'folder-empty' };
  if (!d) return { ok: false, problem: 'plugins-empty' };
  if (p === 'win') {
    if (UNSAFE_WIN.test(f)) return { ok: false, problem: 'folder-unsafe' };
    if (UNSAFE_WIN.test(d.replace(/%APPDATA%|%USERPROFILE%|%LOCALAPPDATA%/gi, ''))) return { ok: false, problem: 'plugins-unsafe' };
    const link = `${d}\\${LINK_NAME}`;
    return { ok: true, command: `if exist "${link}" (echo Already exists: ${LINK_NAME}) else mklink /J "${link}" "${f}"` };
  }
  if (UNSAFE_POSIX.test(f.replace(/^\$HOME(?=\/|$)/, ''))) return { ok: false, problem: 'folder-unsafe' };
  if (UNSAFE_POSIX.test(d.replace(/^\$HOME(?=\/|$)/, '').replace(/^~(?=\/|$)/, ''))) return { ok: false, problem: 'plugins-unsafe' };
  // a tilde does not expand inside double quotes: use $HOME
  const home = (s: string) => s.replace(/^~(?=\/|$)/, '$HOME');
  const link = `${home(d)}/${LINK_NAME}`;
  return { ok: true, command: `test ! -e "${link}" && ln -s "${home(f)}" "${link}" || echo "Already exists: ${link}"` };
}
