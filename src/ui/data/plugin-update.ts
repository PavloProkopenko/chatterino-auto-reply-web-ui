import { compareVersions } from '../../shared/features.ts';
import { ru } from '../../i18n/ru.ts';
import { updatePlugin, type PluginBundle } from './plugin-install.ts';
import type { PluginDir } from './ports.ts';

export interface UpdateOutcome {
  kind: 'ok' | 'error';
  text: string;
}

/**
 * True when the installed plugin is older than the bundled one. A cheap version comparison (no file
 * hashing), for the sidebar button; `inspectPlugin` stays the full check behind the Plugin card.
 * An unknown version offers nothing: the Plugin card explains that case.
 */
export function updateAvailable(installed: string | null, bundledVersion: string): boolean {
  return installed !== null && compareVersions(installed, bundledVersion) < 0;
}

/** Runs the update with a backup (see `updatePlugin`) and turns the result into the text to show. Never throws. */
export async function runPluginUpdate(dir: PluginDir, bundle: PluginBundle, now?: () => number): Promise<UpdateOutcome> {
  const r = await updatePlugin(dir, bundle, now);
  if (r.status === 'updated') return { kind: 'ok', text: ru.plugin.done.updated(r.from, r.backup) };
  return { kind: 'error', text: r.status === 'failed' ? ru.plugin.problem.failed(r.message) : ru.plugin.problem.refused };
}
