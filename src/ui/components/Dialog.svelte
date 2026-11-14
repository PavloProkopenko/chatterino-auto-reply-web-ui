<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ru } from '../../i18n/ru.ts';
  import Icon from './Icon.svelte';

  let { open, title, onclose, children, footer }: { open: boolean; title: string; onclose: () => void; children: Snippet; footer?: Snippet } = $props();
  let el: HTMLDialogElement | undefined = $state();

  // The native <dialog> traps focus, closes on Esc and restores focus to the opener.
  $effect(() => {
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  });
</script>

<dialog bind:this={el} aria-labelledby="dlg-title" oncancel={(e) => { e.preventDefault(); onclose(); }}>
  {#if open}
    <div class="dialog-body">
      <div class="dialog-head">
        <h2 id="dlg-title">{title}</h2>
        <button class="btn ghost small icon-only" type="button" aria-label={ru.history.close} onclick={onclose}><Icon name="x" /></button>
      </div>
      {@render children()}
      {#if footer}<div class="dialog-foot">{@render footer()}</div>{/if}
    </div>
  {/if}
</dialog>
