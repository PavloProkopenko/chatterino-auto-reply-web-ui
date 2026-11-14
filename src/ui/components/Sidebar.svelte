<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { nav, session } from '../state/app.svelte.ts';
  import Icon, { type IconName } from './Icon.svelte';

  const items: { id: string; label: string; icon: IconName; ready: boolean }[] = [
    { id: 'rules', label: ru.nav.rules, icon: 'rules', ready: false },
    { id: 'timers', label: ru.nav.timers, icon: 'timer', ready: false },
    { id: 'redeems', label: ru.nav.redeems, icon: 'reward', ready: false },
    { id: 'settings', label: ru.nav.settings, icon: 'settings', ready: true },
  ];

  const kindLabel = $derived(
    { folder: ru.file.kindFolder, file: ru.file.kindFile, upload: ru.file.kindUpload, demo: ru.file.kindDemo }[session.source?.kind ?? 'folder'],
  );
</script>

<aside class="sidebar">
  <div class="brand">{ru.appTitle}</div>
  <nav class="nav" aria-label={ru.nav.label}>
    {#each items as item (item.id)}
      {#if item.ready}
        <button class="nav-item" type="button" aria-current="page"><Icon name={item.icon} /><span class="grow">{item.label}</span></button>
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
    <div class="file-actions">
      <button class="btn ghost small" type="button" onclick={() => (nav.historyOpen = true)}><Icon name="history" size={16} />{ru.file.history}</button>
      <button class="btn ghost small" type="button" disabled={session.dirty} title={session.dirty ? ru.file.changeBlocked : undefined} onclick={() => void session.leave()}>
        <Icon name="folder" size={16} />{ru.file.change}
      </button>
    </div>
  </div>
</aside>
