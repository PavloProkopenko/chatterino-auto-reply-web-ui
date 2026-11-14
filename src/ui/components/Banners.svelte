<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { session } from '../state/app.svelte.ts';
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
  const features = $derived(session.info?.features);
</script>

<div class="banners">
  {#if session.needsReload}
    <div class="banner success" role="status">
      <Icon name="check" />
      <div class="body">
        <p><strong>{ru.reload.title}</strong> {ru.reload.body}</p>
        <div class="row">
          <code class="cmd mono" translate="no">{ru.reload.command}</code>
          <button class="btn small" type="button" onclick={copyCommand}><Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? ru.reload.copied : ru.reload.copy}</button>
        </div>
        <p class="help">{ru.reload.note}</p>
        {#if session.lastSave?.merged}<p class="help">{ru.reload.merged}</p>{/if}
        {#if session.lastSave?.backup}<p class="help">{ru.reload.backup}</p>{/if}
      </div>
      <button class="btn ghost small icon-only" type="button" aria-label={ru.reload.close} onclick={() => session.dismissReload()}><Icon name="x" /></button>
    </div>
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

  {#if features && !features.versionKnown}
    <div class="banner warn" role="status"><Icon name="alert" /><div class="body"><p>{ru.notice.versionUnknown}</p></div></div>
  {:else if features?.newerThanKnown}
    <div class="banner info" role="status"><Icon name="alert" /><div class="body"><p>{ru.notice.versionNewer}</p></div></div>
  {/if}

  {#if !session.exact}
    <div class="banner info" role="status"><Icon name="alert" /><div class="body"><p>{ru.notice.reformat}</p></div></div>
  {/if}
</div>
