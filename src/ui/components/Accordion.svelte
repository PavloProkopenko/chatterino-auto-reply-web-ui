<script lang="ts" module>
  export interface AccordionSection {
    id: string;
    title: string;
    summary: string;
    /** When set, the section cannot be opened and this explains why. */
    disabledReason?: string | null;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  // One section open at a time. The content of every section stays in the page (hidden), so a half-filled field survives closing.
  let { sections, open = $bindable(), children }: { sections: AccordionSection[]; open: string | null; children: Snippet<[string]> } = $props();

  function toggle(s: AccordionSection) {
    if (s.disabledReason) return;
    open = open === s.id ? null : s.id;
  }
</script>

<div class="accordion">
  {#each sections as s (s.id)}
    {@const isOpen = open === s.id && !s.disabledReason}
    <section class="acc-item" class:open={isOpen} class:disabled={!!s.disabledReason}>
      <h2 class="acc-head">
        <button
          type="button"
          class="acc-btn"
          id="acc-{s.id}-head"
          aria-expanded={isOpen}
          aria-controls="acc-{s.id}-panel"
          aria-disabled={s.disabledReason ? 'true' : undefined}
          aria-describedby={s.disabledReason ? `acc-${s.id}-reason` : undefined}
          onclick={() => toggle(s)}
        >
          <span class="acc-text"><span class="acc-title">{s.title}</span><span class="acc-summary">{s.summary}</span></span>
          <span class="acc-chevron"><Icon name="down" size={16} /></span>
        </button>
      </h2>
      {#if s.disabledReason}<p class="help acc-reason" id="acc-{s.id}-reason">{s.disabledReason}</p>{/if}
      <div class="acc-body" id="acc-{s.id}-panel" role="region" aria-labelledby="acc-{s.id}-head" hidden={!isOpen}>
        {@render children(s.id)}
      </div>
    </section>
  {/each}
</div>
