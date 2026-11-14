<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import type { BackupInfo } from '../../shared/api-types.ts';
  import { client, nav, session } from '../state/app.svelte.ts';
  import Dialog from './Dialog.svelte';

  let backups = $state<BackupInfo[] | null>(null);
  let failed = $state(false);
  let confirming = $state<string | null>(null);

  $effect(() => {
    if (!nav.historyOpen) return;
    backups = null;
    failed = false;
    confirming = null;
    client.backups().then((b) => (backups = b), () => (failed = true));
  });

  /** config.json.bak-20261114T001530123Z-000 -> a Date (UTC) */
  function stamp(name: string): string {
    const m = /bak-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(name);
    if (!m) return name;
    const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'medium' }).format(d);
  }

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
      {#each backups as b (b.name)}
        <li>
          <span>{stamp(b.name)} <span class="muted">· {ru.history.size(b.size)}</span></span>
          {#if confirming === b.name}
            <span class="stack">
              <span class="help">{ru.history.confirm}</span>
              <span class="file-actions">
                <button class="btn danger small" type="button" onclick={() => void restore(b.name)}>{ru.history.confirmYes}</button>
                <button class="btn small" type="button" onclick={() => (confirming = null)}>{ru.history.cancel}</button>
              </span>
            </span>
          {:else}
            <button class="btn small" type="button" onclick={() => (confirming = b.name)}>{ru.history.restore}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Dialog>
