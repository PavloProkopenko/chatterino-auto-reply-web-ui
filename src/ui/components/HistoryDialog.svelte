<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import type { BackupInfo } from '../data/ports.ts';
  import { nav, session } from '../state/app.svelte.ts';
  import Dialog from './Dialog.svelte';

  let backups = $state<BackupInfo[] | null>(null);
  let failed = $state(false);
  let confirming = $state<string | null>(null);

  $effect(() => {
    if (!nav.historyOpen) return;
    backups = null;
    failed = false;
    confirming = null;
    session.listBackups().then((b) => (backups = b), () => (failed = true));
  });

  const when = (at: number) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'medium' }).format(at);

  async function restore(name: string) {
    nav.historyOpen = false;
    await session.restore(name);
  }
</script>

<Dialog open={nav.historyOpen} title={ru.history.title} onclose={() => (nav.historyOpen = false)}>
  <p class="muted">{ru.history.intro}</p>
  {#if failed}
    <p class="error-text" role="alert">{ru.history.loadError}</p>
  {:else if backups === null}
    <p class="muted" role="status">{ru.loading}</p>
  {:else if backups.length === 0}
    <p class="muted">{ru.history.empty}</p>
  {:else}
    <ul class="list">
      {#each backups as b (b.id)}
        <li>
          <span>{when(b.at)} <span class="muted">· {ru.history.size(b.size)}</span></span>
          {#if confirming === b.id}
            <span class="stack">
              <span class="help">{ru.history.confirm}</span>
              <span class="file-actions">
                <button class="btn danger small" type="button" onclick={() => void restore(b.id)}>{ru.history.confirmYes}</button>
                <button class="btn small" type="button" onclick={() => (confirming = null)}>{ru.history.cancel}</button>
              </span>
            </span>
          {:else}
            <button class="btn small" type="button" onclick={() => (confirming = b.id)}>{ru.history.restore}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Dialog>
