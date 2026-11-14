<script lang="ts">
  let { label, help, checked, disabled = false, note, onchange }: { label: string; help?: string; checked: boolean; disabled?: boolean; note?: string; onchange: (v: boolean) => void } = $props();
  const uid = $props.id();
</script>

<div class="switch-row">
  <div class="text">
    <span class="label" id="{uid}-l">{label}</span>
    {#if help}<span class="help" id="{uid}-h">{help}</span>{/if}
    {#if note}<span class="help">{note}</span>{/if}
  </div>
  <button type="button" role="switch" class="switch" aria-checked={checked} aria-labelledby="{uid}-l" aria-describedby={help ? `${uid}-h` : undefined} {disabled} onclick={() => onchange(!checked)}></button>
</div>
