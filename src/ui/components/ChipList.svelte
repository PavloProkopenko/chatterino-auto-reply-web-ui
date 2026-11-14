<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import type { Checked } from '../state/validators.ts';
  import Icon from './Icon.svelte';

  let { label, help, placeholder, items, validate, onchange }: {
    label: string; help: string; placeholder: string; items: string[];
    validate: (token: string) => Promise<Checked>; onchange: (items: string[]) => void;
  } = $props();
  const uid = $props.id();
  let text = $state('');
  let problem = $state<string | null>(null);
  let problemEl = $state<HTMLElement | undefined>();
  // A new error can appear below the fold, behind the save bar: bring it into view.
  $effect(() => problemEl?.scrollIntoView({ block: 'nearest' }));
  // Entries already in the file that the plugin would not recognise (hand-edited files): shown, not hidden.
  let rejected = $state<Record<string, string>>({});
  const seen = new Set<string>();

  $effect(() => {
    for (const item of items) {
      if (seen.has(item)) continue;
      seen.add(item);
      void validate(item).then((r) => {
        if (!r.ok || r.value !== item) rejected[item] = r.ok ? ru.settings.lists.pluginRejects : r.error;
      });
    }
  });

  /** All or nothing: one invalid token rejects the whole entry, so a typo never leaves half a paste applied. */
  async function add(raw: string) {
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);
    if (tokens.length === 0) return;
    problem = null;
    const results = await Promise.all(tokens.map((t) => validate(t)));
    const bad = results.find((r) => !r.ok);
    if (bad && !bad.ok) {
      problem = bad.error;
      return;
    }
    let next = [...items];
    for (const r of results) {
      if (!r.ok) continue;
      if (next.includes(r.value)) problem = ru.settings.lists.duplicate(r.value);
      else {
        seen.add(r.value);
        next = [...next, r.value];
      }
    }
    if (next.length !== items.length) onchange(next);
    if (!problem) text = '';
  }

  function remove(item: string) {
    onchange(items.filter((x) => x !== item));
    problem = null;
  }
</script>

<div class="field">
  <label for="{uid}-i">{label}</label>
  <span class="help" id="{uid}-h">{help}</span>
  <ul class="chips" aria-label={ru.settings.lists.added(label)}>
    {#each items as item (item)}
      <li class="chip" class:bad={rejected[item]}>
        <span translate="no">{item}</span>
        {#if rejected[item]}<span class="sr-only">{rejected[item]}</span><Icon name="alert" size={14} />{/if}
        <button type="button" aria-label={ru.settings.lists.remove(item)} onclick={() => remove(item)}><Icon name="x" size={14} /></button>
      </li>
    {/each}
  </ul>
  {#if items.some((i) => rejected[i])}
    <span class="error-text" role="status"><Icon name="alert" size={14} />{ru.settings.lists.pluginRejects}: {items.filter((i) => rejected[i]).join(', ')}</span>
  {/if}
  <input
    id="{uid}-i"
    class="input"
    type="text"
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    {placeholder}
    bind:value={text}
    aria-invalid={problem ? 'true' : 'false'}
    aria-describedby="{uid}-h{problem ? ` ${uid}-e` : ''}"
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
        e.preventDefault();
        void add(text);
      } else if (e.key === 'Backspace' && text === '' && items.length > 0) {
        remove(items[items.length - 1]!);
      }
    }}
    onpaste={(e) => {
      const pasted = e.clipboardData?.getData('text') ?? '';
      if (/[\s,;]/.test(pasted.trim())) {
        e.preventDefault();
        void add(pasted);
      }
    }}
    onblur={() => void add(text)}
  />
  {#if problem}<span class="error-text" id="{uid}-e" role="alert" bind:this={problemEl}><Icon name="alert" size={14} />{problem}</span>{/if}
</div>
