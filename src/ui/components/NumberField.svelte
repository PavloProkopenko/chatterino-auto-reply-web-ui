<script lang="ts">
  import Icon from './Icon.svelte';

  let { label, help, value, min, max, unit, error, oninput }: {
    label: string; help: string; value: number; min: number; max: number; unit: string;
    error: string | null; oninput: (text: string) => void;
  } = $props();
  const uid = $props.id();
  // The field keeps what the user typed, so a half-typed or invalid value is not replaced under their fingers.
  let text = $state<string | null>(null);
  const shown = $derived(text ?? String(value));
  let errorEl = $state<HTMLElement | undefined>();
  $effect(() => errorEl?.scrollIntoView({ block: 'nearest' }));
</script>

<div class="field">
  <label for="{uid}-i">{label}</label>
  <div class="number-row">
    <input
      id="{uid}-i"
      class="input"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      value={shown}
      aria-invalid={error ? 'true' : 'false'}
      aria-describedby="{uid}-h{error ? ` ${uid}-e` : ''}"
      oninput={(e) => { text = e.currentTarget.value; oninput(text); }}
      onblur={() => { if (!error) text = null; }}
    />
    <span class="muted">{unit}</span>
  </div>
  <span class="help" id="{uid}-h">{help} ({min}–{max})</span>
  {#if error}<span class="error-text" id="{uid}-e" role="alert" bind:this={errorEl}><Icon name="alert" size={14} />{error}</span>{/if}
</div>
