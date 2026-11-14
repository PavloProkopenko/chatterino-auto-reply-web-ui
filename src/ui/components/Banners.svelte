<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { session } from '../state/app.svelte.ts';
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
  const features = $derived(session.source?.features);

  const command = $derived(placeCommand(detectPlatform(navigator.userAgent + ' ' + (navigator.platform ?? '')), session.source?.folderName ?? null));
  const showPlace = $derived(session.source?.kind === 'upload' && !session.source.canSaveInPlace);
  function infoChosen(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) void session.openInfo(file);
  }
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
          <p><strong>{ru.reload.title}</strong> {ru.reload.body}</p>
        {:else if session.source?.kind === 'demo'}
          <p><strong>{ru.reload.downloadedTitle}</strong> {ru.notice.demoMode}</p>
        {:else}
          <p><strong>{ru.reload.downloadedTitle}</strong> {ru.reload.downloadedBody}</p>
        {/if}
        <div class="row" class:hidden={session.source?.kind === 'demo'}>
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
        <p class="help">{ru.reload.note}</p>
        {#if session.lastSave?.merged}<p class="help">{ru.reload.merged}</p>{/if}
        {#if session.lastSave?.backup && session.source?.kind !== 'demo'}<p class="help">{ru.reload.backup}</p>{/if}
      </div>
      <button class="btn ghost small icon-only" type="button" aria-label={ru.reload.close} onclick={() => session.dismissReload()}><Icon name="x" /></button>
    </div>
  {/if}

  {#if session.writeFailed}
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
  {/if}

  {#if session.source?.kind === 'demo'}
    <div class="banner info" role="note"><Icon name="alert" /><div class="body"><p>{ru.notice.demoMode}</p></div></div>
  {:else if session.source && !session.source.canSaveInPlace}
    <div class="banner info" role="note"><Icon name="alert" /><div class="body"><p>{ru.notice.downloadMode}</p></div></div>
  {/if}

  {#if session.source && session.source.canSaveInPlace && !session.persistent}
    <div class="banner info" role="note"><Icon name="alert" /><div class="body"><p>{ru.notice.notPersistent}</p></div></div>
  {/if}

  {#if session.staleBase}
    <div class="banner error" role="alert">
      <Icon name="alert" />
      <div class="body">
        <p>{ru.notice.staleBase}</p>
        <div class="row"><button class="btn small" type="button" onclick={() => void session.reloadFromDisk()}>{ru.notice.staleBaseAction}</button></div>
      </div>
    </div>
  {/if}

  {#if session.error}
    <div class="banner error" role="alert"><Icon name="alert" /><div class="body"><p>{session.error}</p></div></div>
  {/if}

  {#if session.externalChange}
    <div class="banner info" role="status"><Icon name="alert" /><div class="body"><p>{ru.notice.external}</p></div></div>
  {/if}

  {#if features && !features.versionKnown && session.source?.kind === 'upload'}
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
  {:else if features && !features.versionKnown}
    <div class="banner warn" role="status"><Icon name="alert" /><div class="body"><p>{ru.notice.versionUnknown}</p></div></div>
  {:else if features?.newerThanKnown}
    <div class="banner info" role="status"><Icon name="alert" /><div class="body"><p>{ru.notice.versionNewer}</p></div></div>
  {/if}

  {#if !session.exact}
    <div class="banner info" role="status"><Icon name="alert" /><div class="body"><p>{ru.notice.reformat}</p></div></div>
  {/if}
</div>
