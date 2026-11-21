<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { session } from '../state/app.svelte.ts';
  import { droppedLiveTimers } from '../state/item-text.ts';
  import { detectPlatform, placeCommand } from '../state/place.ts';
  import Icon from './Icon.svelte';

  let copied = $state(false);
  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(ru.reload.command);
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch {
      /* the command is shown on screen and can be selected by hand */
    }
  }
  const auto = $derived(session.source?.features?.autoReload === true);
  const droppedLive = $derived(droppedLiveTimers(session.lastSave?.notes ?? []));
  const timerName = (id: number) => {
    const t = session.current?.timers.find((x) => x.id === id);
    return t?.name ? t.name : `#${id}`;
  };

  const command = $derived(placeCommand(detectPlatform(navigator.userAgent + ' ' + (navigator.platform ?? '')), session.source?.folderName ?? null));
  const showPlace = $derived(session.source?.kind === 'upload' && !session.source.canSaveInPlace);
  let placeCopied = $state(false);
  async function copyPlace() {
    try {
      await navigator.clipboard.writeText(command);
      placeCopied = true;
      setTimeout(() => (placeCopied = false), 1800);
    } catch {
      /* the command is shown on screen and can be selected by hand */
    }
  }
</script>

<div class="banners">
  {#if session.needsReload}
    <div class="banner success" role="status">
      <Icon name="check" />
      <div class="body">
        {#if session.source?.canSaveInPlace}
          <p><strong>{ru.reload.title}</strong> {auto ? ru.reload.autoBody : ru.reload.body}</p>
        {:else if session.source?.kind === 'demo'}
          <p><strong>{ru.reload.downloadedTitle}</strong> {ru.notice.demoMode}</p>
        {:else}
          <p><strong>{ru.reload.downloadedTitle}</strong> {auto ? ru.reload.autoDownloadedBody : ru.reload.downloadedBody}</p>
        {/if}
        <div class="row" class:hidden={session.source?.kind === 'demo' || auto}>
          <code class="cmd mono" translate="no">{ru.reload.command}</code>
          <button class="btn small" type="button" onclick={copyCommand}><Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? ru.reload.copied : ru.reload.copy}</button>
        </div>
        {#if showPlace}
          <p class="help">{ru.reload.placeTitle}</p>
          <div class="row">
            <code class="cmd mono" translate="no">{command}</code>
            <button class="btn small" type="button" onclick={copyPlace}><Icon name={placeCopied ? 'check' : 'copy'} size={16} />{placeCopied ? ru.reload.placeCopied : ru.reload.placeCopy}</button>
          </div>
          <p class="help">{ru.reload.placeHelp}</p>
        {/if}
        {#if !auto}<p class="help">{ru.reload.note}</p>{/if}
        {#if !auto && session.source?.features?.versionKnown}<p class="help">{ru.reload.oldPluginHint}</p>{/if}
        {#if session.lastSave?.merged}<p class="help">{ru.reload.merged}</p>{/if}
        {#each droppedLive as id (id)}<p class="warn-line"><Icon name="alert" size={14} />{ru.timers.droppedLive(timerName(id))}</p>{/each}
        {#if session.lastSave?.backup && session.source?.kind !== 'demo'}<p class="help">{ru.reload.backup}</p>{/if}
      </div>
      <button class="btn ghost small icon-only" type="button" aria-label={ru.reload.close} onclick={() => session.dismissReload()}><Icon name="x" /></button>
    </div>
  {/if}
</div>
