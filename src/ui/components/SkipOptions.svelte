<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { validateUser } from '../state/app.svelte.ts';
  import ChipList from './ChipList.svelte';

  export type SkipMode = 'follow' | 'yes' | 'no';
  let { mode = $bindable(), users = $bindable(), disabled = false, note, uid }: { mode: SkipMode; users: string[]; disabled?: boolean; note?: string | undefined; uid: string } = $props();
  const T = ru.rules.editor;
</script>

<fieldset>
  <legend>{T.skip}</legend>
  {#if disabled}
    <p class="help">{note}</p>
  {:else}
    {#each [['follow', T.skipFollow], ['yes', T.skipYes], ['no', T.skipNo]] as [v, label] (v)}
      <label class="choice-row"><input type="radio" name="{uid}-skip" value={v} checked={mode === v} onchange={() => (mode = v as SkipMode)} />{label}</label>
    {/each}
    <ChipList label={T.skipUsers} help={T.skipUsersHelp} placeholder={T.skipUsersPlaceholder} items={users} validate={validateUser} onchange={(v) => (users = v)} />
  {/if}
</fieldset>
