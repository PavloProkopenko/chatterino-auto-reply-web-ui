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

  /** `…/Chatterino/Plugins/auto-reply/data/config.json` -> ['Chatterino', 'Plugins', 'auto-reply'], without the user folder. */
  function shortName(path: string): string[] {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    const i = parts.lastIndexOf('Plugins');
    if (i > 0 && parts[i + 1]) return [parts[i - 1]!, 'Plugins', parts[i + 1]!];
    const tail = parts.slice(-3, -1);
    return tail.length ? tail : [ru.file.label];
  }

  const path = $derived(session.info?.path ?? '');
  let copied = $state(false);
  async function copyPath() {
    try {
      await navigator.clipboard.writeText(path);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* clipboard not available: the path is visible and can be selected */
    }
  }
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
    <span class="muted">{ru.file.label}</span>
    <span class="path" class:full={nav.showPath}>{#if nav.showPath}{path}{:else}{#each shortName(path) as seg, i (i)}{#if i > 0}{' › '}{/if}<span class="seg">{seg}</span>{/each}{/if}</span>
    {#if !nav.showPath}<span class="help">{ru.file.hiddenNote}</span>{/if}
    <div class="file-actions">
      <button class="btn ghost small" type="button" aria-pressed={nav.showPath} onclick={() => (nav.showPath = !nav.showPath)}>
        <Icon name={nav.showPath ? 'eye-off' : 'eye'} size={16} />{nav.showPath ? ru.file.hide : ru.file.show}
      </button>
      {#if nav.showPath}
        <button class="btn ghost small" type="button" onclick={copyPath}><Icon name={copied ? 'check' : 'copy'} size={16} />{ru.file.copy}</button>
      {/if}
      <button class="btn ghost small" type="button" onclick={() => (nav.historyOpen = true)}><Icon name="history" size={16} />{ru.file.history}</button>
      <button class="btn ghost small" type="button" disabled={session.dirty} title={session.dirty ? ru.file.changeBlocked : undefined} onclick={() => void session.openPicker()}>
        <Icon name="folder" size={16} />{ru.file.change}
      </button>
    </div>
  </div>
</aside>
