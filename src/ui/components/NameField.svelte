<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import Icon from './Icon.svelte';

  let { name = $bindable(), error, disabled = false, canSuggest = true, onsuggest, note, uid }: { name: string; error?: string | undefined; disabled?: boolean; canSuggest?: boolean; onsuggest: () => void; note?: string | undefined; uid: string } = $props();
  const T = ru.rules.editor;
</script>

<div class="field">
  <label for="{uid}-name">{T.name}</label>
  <span class="help" id="{uid}-nameh">{T.nameHelp}</span>
  <div class="row-between">
    <input id="{uid}-name" class="input" type="text" autocomplete="off" aria-describedby="{uid}-nameh {uid}-namee" aria-invalid={error ? 'true' : undefined} {disabled} bind:value={name} />
    <button class="btn small" type="button" disabled={disabled || !canSuggest} onclick={onsuggest}>{T.suggest}</button>
  </div>
  {#if note}<span class="help">{note}</span>{/if}
  <span id="{uid}-namee" class="error-text" role="alert">{#if error}<Icon name="alert" size={14} />{error}{/if}</span>
</div>
