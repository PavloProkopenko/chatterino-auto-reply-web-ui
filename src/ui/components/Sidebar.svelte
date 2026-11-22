<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { pluginBundle } from '../data/plugin-bundle.ts';
  import { runPluginUpdate, updateAvailable, type UpdateOutcome } from '../data/plugin-update.ts';
  import { nav, session } from '../state/app.svelte.ts';
  import { router } from '../state/route.svelte.ts';
  import type { Page } from '../state/route.ts';
  import Icon, { type IconName } from './Icon.svelte';

  const items: { id: string; label: string; icon: IconName; ready: boolean }[] = [
    { id: 'rules', label: ru.nav.rules, icon: 'rules', ready: true },
    { id: 'timers', label: ru.nav.timers, icon: 'timer', ready: true },
    { id: 'redeems', label: ru.nav.redeems, icon: 'reward', ready: true },
    { id: 'settings', label: ru.nav.settings, icon: 'settings', ready: true },
  ];

  // One-click plugin update, only while the bundled plugin is newer than the installed one.
  let updating = $state(false);
  let updateResult = $state<UpdateOutcome | null>(null);
  const canUpdate = $derived(session.source?.kind === 'folder' && session.pluginFolder !== null && updateAvailable(session.source.pluginVersion, pluginBundle.version));
  $effect(() => {
    void session.pluginFolder;
    updateResult = null; // another folder: the old message is not about it
  });
  async function doUpdate() {
    const folder = session.pluginFolder;
    if (!folder || updating) return;
    updating = true;
    try {
      const out = await runPluginUpdate(folder.dir, pluginBundle);
      updateResult = out.kind === 'ok' ? { kind: 'ok', text: ru.file.updated(pluginBundle.version) } : out;
      if (out.kind === 'ok') await session.refreshPluginInfo();
    } catch (e) {
      updateResult = { kind: 'error', text: ru.plugin.problem.failed(e instanceof Error ? e.message : String(e)) };
    } finally {
      updating = false;
    }
  }

  const kindLabel = $derived(
    { folder: ru.file.kindFolder, file: ru.file.kindFile, upload: ru.file.kindUpload, demo: ru.file.kindDemo }[session.source?.kind ?? 'folder'],
  );
</script>

<aside class="sidebar">
  <div class="brand">{ru.appTitle}</div>
  <nav class="nav" aria-label={ru.nav.label}>
    {#each items as item (item.id)}
      {#if item.ready}
        <button class="nav-item" type="button" aria-current={router.current.page === item.id ? 'page' : undefined} onclick={() => router.go({ page: item.id as Page, view: 'list' })}><Icon name={item.icon} /><span class="grow">{item.label}</span></button>
      {:else}
        <button class="nav-item" type="button" aria-disabled="true" onclick={(e) => e.preventDefault()}>
          <Icon name={item.icon} /><span class="grow">{item.label}</span><span class="badge">{ru.nav.soon}</span>
        </button>
      {/if}
    {/each}
  </nav>

  <div class="file-box">
    <span class="muted">{kindLabel}</span>
    <span class="path"><span class="seg" translate="no">{session.source?.name}</span></span>
    <span class="help">{ru.file.plugin(session.source?.pluginVersion ?? null)}</span>
    {#if updateResult}<p class={updateResult.kind === 'error' ? 'error-text' : 'help'} role={updateResult.kind === 'error' ? 'alert' : 'status'}>{updateResult.text}</p>{/if}
    <div class="file-actions">
      {#if canUpdate}
        <button class="btn primary small" type="button" disabled={updating} title={ru.file.updateTitle(pluginBundle.version)} onclick={() => void doUpdate()}>
          <Icon name="refresh" size={16} />{updating ? ru.file.updating : ru.file.update}
        </button>
      {/if}
      <button class="btn ghost small" type="button" onclick={() => (nav.historyOpen = true)}><Icon name="history" size={16} />{ru.file.history}</button>
      <button class="btn ghost small" type="button" disabled={session.dirty} title={session.dirty ? ru.file.changeBlocked : undefined} onclick={() => void session.leave()}>
        <Icon name="folder" size={16} />{ru.file.change}
      </button>
    </div>
  </div>
</aside>
