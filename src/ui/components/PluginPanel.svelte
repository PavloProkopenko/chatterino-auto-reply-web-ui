<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { pluginBundle } from '../data/plugin-bundle.ts';
  import { inspectPlugin, installPlugin, listPluginBackups, rollbackPlugin, type PluginInspection } from '../data/plugin-install.ts';
  import { runPluginUpdate } from '../data/plugin-update.ts';
  import type { PluginFolder } from '../data/workspace.ts';
  import { detectPlatform, linkCommand, pluginsDir } from '../state/place.ts';
  import { session } from '../state/app.svelte.ts';
  import Icon from './Icon.svelte';

  // `settings`: the folder is the open plugin folder. `install`: a folder just chosen on the welcome screen.
  let { folder, mode, onchanged, onopen }: { folder: PluginFolder; mode: 'settings' | 'install'; onchanged?: () => void | Promise<void>; onopen?: () => void } = $props();

  const bundle = pluginBundle;
  const platform = detectPlatform(navigator.userAgent + ' ' + (navigator.platform ?? ''));

  let info = $state.raw<PluginInspection | null>(null);
  let hasBackup = $state(false);
  let busy = $state(false);
  let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function refresh() {
    info = await inspectPlugin(folder.dir, bundle);
    hasBackup = (await listPluginBackups(folder.dir)).length > 0;
  }
  $effect(() => {
    void folder;
    info = null;
    message = null;
    void refresh();
  });
  // the sidebar Update button changes the installed version: re-inspect, but keep the message on screen
  $effect(() => {
    void session.source?.pluginVersion;
    void refresh();
  });

  async function run(action: () => Promise<{ kind: 'ok' | 'error'; text: string }>) {
    busy = true;
    try {
      message = await action();
      await refresh();
      if (message.kind === 'ok') await onchanged?.();
    } catch (e) {
      message = { kind: 'error', text: ru.plugin.problem.failed(e instanceof Error ? e.message : String(e)) };
    } finally {
      busy = false;
    }
  }

  const doInstall = () =>
    run(async () => {
      const r = await installPlugin(folder.dir, bundle);
      if (r.status === 'installed') return { kind: 'ok', text: ru.plugin.done.installed };
      return { kind: 'error', text: r.status === 'failed' ? ru.plugin.problem.failed(r.message) : ru.plugin.problem.refused };
    });
  const doUpdate = () => run(() => runPluginUpdate(folder.dir, bundle));
  const doRollback = () =>
    run(async () => {
      const r = await rollbackPlugin(folder.dir);
      if (r.status === 'rolled-back') return { kind: 'ok', text: ru.plugin.done.rolledBack(r.restored) };
      return { kind: 'error', text: r.status === 'failed' ? ru.plugin.problem.failed(r.message) : ru.plugin.problem.noBackup };
    });

  const stateText = $derived.by(() => {
    if (!info) return ru.plugin.checking;
    const s = ru.plugin.state;
    switch (info.state) {
      case 'missing': return s.missing;
      case 'foreign': return s.foreign;
      case 'current': return s.current(info.installedVersion ?? bundle.version);
      case 'older': return s.older(info.installedVersion, bundle.version);
      case 'newer': return s.newer(info.installedVersion ?? '', bundle.version);
      case 'modified': return s.modified(info.installedVersion ?? bundle.version, info.changedFiles.join(', '));
    }
  });

  // link helper (paths are typed here and live only in this component)
  let folderPath = $state('');
  let pluginsPath = $state(pluginsDir(platform));
  let copied = $state(false);
  const link = $derived(linkCommand(platform, folderPath, pluginsPath));
  async function copyCommand() {
    if (!link.ok) return;
    try {
      await navigator.clipboard.writeText(link.command);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* the command is on screen and can be selected by hand */
    }
  }
  const showLink = $derived(mode === 'install' || info?.state !== 'foreign');
</script>

<section class="card" aria-labelledby="plugin-title">
  <h2 id="plugin-title">{ru.plugin.title}</h2>
  <p class="help">{ru.plugin.intro}</p>
  <p data-testid="plugin-state"><strong>{stateText}</strong></p>

  <div class="file-actions">
    {#if info?.state === 'missing'}
      <button class="btn primary" type="button" disabled={busy} onclick={doInstall}>{ru.plugin.install}</button>
    {:else if info?.state === 'older'}
      <button class="btn primary" type="button" disabled={busy} onclick={doUpdate}>{ru.plugin.update(bundle.version)}</button>
    {:else if info?.state === 'modified'}
      <button class="btn" type="button" disabled={busy} onclick={doUpdate}>{ru.plugin.restore(bundle.version)}</button>
    {/if}
    {#if hasBackup && info && info.state !== 'missing' && info.state !== 'foreign'}
      <button class="btn" type="button" disabled={busy} onclick={doRollback}>{ru.plugin.rollback}</button>
    {/if}
    {#if mode === 'install'}
      {#if info && (info.state === 'current' || info.state === 'older' || info.state === 'modified' || info.state === 'newer')}
        <button class="btn" type="button" disabled={busy} onclick={onopen}>{ru.plugin.openConfig}</button>
      {/if}
    {/if}
  </div>
  {#if info?.state === 'older' || info?.state === 'modified'}<p class="help">{ru.plugin.backupNote}</p>{/if}
  {#if message}<p class={message.kind === 'error' ? 'error-text' : 'help'} role={message.kind === 'error' ? 'alert' : 'status'}>{#if message.kind === 'error'}<Icon name="alert" size={14} />{/if}{message.text}</p>{/if}

  {#if showLink}
    <details>
      <summary>{ru.plugin.link.title}</summary>
      <div class="stack">
        <p class="help">{ru.plugin.link.intro}</p>
        <label class="field">
          <span>{ru.plugin.link.folder}</span>
          <input class="mono" type="text" bind:value={folderPath} spellcheck="false" autocomplete="off" />
          <span class="help">{ru.plugin.link.folderHelp}</span>
        </label>
        <label class="field">
          <span>{ru.plugin.link.plugins}</span>
          <input class="mono" type="text" bind:value={pluginsPath} spellcheck="false" autocomplete="off" />
          <span class="help">{ru.plugin.link.pluginsHelp}</span>
        </label>
        {#if link.ok}
          <div class="row">
            <code class="cmd mono" translate="no" data-testid="link-command">{link.command}</code>
            <button class="btn small" type="button" onclick={copyCommand}><Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? ru.plugin.link.copied : ru.plugin.link.copy}</button>
          </div>
        {:else if folderPath.trim() !== '' || pluginsPath.trim() === ''}
          <p class="error-text" role="alert"><Icon name="alert" size={14} />{ru.plugin.link.problems[link.problem]}</p>
        {/if}
        <p class="help">{ru.plugin.link.exists}</p>
      </div>
    </details>
  {/if}
</section>
