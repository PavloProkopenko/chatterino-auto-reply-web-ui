<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { session } from '../state/app.svelte.ts';
  import { detectPlatform, pluginsDir } from '../state/place.ts';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';

  const where = pluginsDir(detectPlatform(navigator.userAgent + ' ' + (navigator.platform ?? '')));

  function chosen(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // choosing the same file again must fire again
    if (file) void session.saveWithFile(file);
  }
</script>

<Dialog open={session.askFreshFile} title={ru.fresh.title} onclose={() => session.cancelFreshFile()}>
  <p class="muted">{ru.fresh.body}</p>
  <p class="help"><code class="mono" translate="no">{where}</code></p>
  {#if session.freshProblem}<p class="error-text" role="alert"><Icon name="alert" size={14} />{ru.fresh[session.freshProblem]}</p>{/if}
  {#snippet footer()}
    <label class="btn primary file-pick">
      {ru.fresh.action}
      <input class="sr-only" type="file" accept=".json,application/json" onchange={chosen} />
    </label>
    <button class="btn" type="button" onclick={() => session.cancelFreshFile()}>{ru.fresh.cancel}</button>
  {/snippet}
</Dialog>
