<script lang="ts">
  import Icon from './Icon.svelte';

  // The channel list is the global one from Settings; a channel the item already has that is not in it stays selectable, marked.
  let { channel = $bindable(), channels, uid, label, help, none, missing, error }: { channel: string; channels: string[]; uid: string; label: string; help: string; none: string; missing: string; error?: string | undefined } = $props();
  const options = $derived([...channels, ...(channel && !channels.some((c) => c.toLowerCase() === channel.toLowerCase()) ? [channel] : [])]);
</script>

<div class="field">
  <label for="{uid}-ch">{label}</label>
  <span class="help" id="{uid}-chh">{help}</span>
  {#if options.length === 0}
    <p class="help">{none}</p>
  {:else}
    <select id="{uid}-ch" class="input" bind:value={channel} aria-describedby="{uid}-chh {uid}-che" aria-invalid={error ? 'true' : undefined}>
      <option value="" disabled>—</option>
      {#each options as c (c)}<option value={c}>{c}{channels.some((k) => k.toLowerCase() === c.toLowerCase()) ? '' : ` (${missing})`}</option>{/each}
    </select>
  {/if}
  <span id="{uid}-che" class="error-text" role="alert">{#if error}<Icon name="alert" size={14} />{error}{/if}</span>
</div>
