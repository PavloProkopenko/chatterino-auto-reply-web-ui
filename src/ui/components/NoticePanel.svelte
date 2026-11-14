<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { session } from '../state/app.svelte.ts';
  import type { Notice } from '../state/notices.ts';
  import Icon from './Icon.svelte';

  let { notices }: { notices: Notice[] } = $props();

  function infoChosen(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) void session.openInfo(file);
  }
</script>

<div class="notice-list">
  {#if notices.length === 0}
    <p class="help" role="status">{ru.notices.empty}</p>
  {/if}
  {#each notices as n (n.id)}
    {#if n.key === 'writeFailed' && session.writeFailed}
      <div class="banner error" role="alert">
        <Icon name="alert" />
        <div class="body">
          <p>{ru.writeFailed[session.writeFailed.reason]}</p>
          <div class="row">
            {#if session.writeFailed.reason === 'permission'}
              <button class="btn small" type="button" onclick={() => void session.retryAfterGrant()}>{ru.writeFailed.grant}</button>
            {:else}
              <button class="btn small" type="button" onclick={() => void session.save()}>{ru.writeFailed.retry}</button>
            {/if}
            <button class="btn small" type="button" onclick={() => session.downloadFailed()}>{ru.writeFailed.download}</button>
          </div>
        </div>
      </div>
    {:else if n.key === 'staleBase'}
      <div class="banner error" role="alert">
        <Icon name="alert" />
        <div class="body">
          <p>{ru.notice.staleBase}</p>
          <div class="row"><button class="btn small" type="button" onclick={() => void session.reloadFromDisk()}>{ru.notice.staleBaseAction}</button></div>
        </div>
      </div>
    {:else if n.key === 'error'}
      <div class="banner error" role="alert"><Icon name="alert" /><div class="body"><p>{session.error}</p></div></div>
    {:else if n.key === 'versionNeedsInfo'}
      <div class="banner warn" role="status">
        <Icon name="alert" />
        <div class="body">
          <p>{ru.notice.versionNeedsInfo}</p>
          {#if session.infoProblem}<p class="error-text" role="alert">{ru.notice.infoProblems[session.infoProblem]}</p>{/if}
          <div class="row">
            <label class="btn small file-pick">{ru.notice.openInfo}
              <input class="sr-only" type="file" accept=".json,application/json" onchange={infoChosen} />
            </label>
          </div>
        </div>
      </div>
    {:else if n.key === 'versionUnknown'}
      <div class="banner warn" role="status"><Icon name="alert" /><div class="body"><p>{ru.notice.versionUnknown}</p></div></div>
    {:else if n.key === 'versionNewer'}
      <div class="banner info" role="status"><Icon name="alert" /><div class="body"><p>{ru.notice.versionNewer}</p></div></div>
    {:else if n.key === 'demo'}
      <div class="banner info" role="note"><Icon name="alert" /><div class="body"><p>{ru.notice.demoMode}</p></div></div>
    {:else if n.key === 'download'}
      <div class="banner info" role="note"><Icon name="alert" /><div class="body"><p>{ru.notice.downloadMode}</p></div></div>
    {:else if n.key === 'notPersistent'}
      <div class="banner info" role="note"><Icon name="alert" /><div class="body"><p>{ru.notice.notPersistent}</p></div></div>
    {:else if n.key === 'external'}
      <div class="banner info" role="status"><Icon name="alert" /><div class="body"><p>{ru.notice.external}</p></div></div>
    {:else if n.key === 'reformat'}
      <div class="banner info" role="status"><Icon name="alert" /><div class="body"><p>{ru.notice.reformat}</p></div></div>
    {/if}
  {/each}
</div>
