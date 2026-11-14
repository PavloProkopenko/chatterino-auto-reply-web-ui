import version from '../../../vendor/plugin/VERSION.json';
import type { PluginBundle } from './plugin-install.ts';

// The plugin files the site can install: vendored by `pnpm sync-plugin`, hash-checked by `pnpm sync-plugin:check`.
const texts = import.meta.glob(['../../../vendor/plugin/*.lua', '../../../vendor/plugin/info.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function build(): PluginBundle {
  const files: PluginBundle['files'] = {};
  for (const [path, text] of Object.entries(texts)) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    files[name] = { text, hash: (version.files as Record<string, string>)[name] ?? '' };
  }
  return { version: version.version, files };
}

export const pluginBundle: PluginBundle = build();
