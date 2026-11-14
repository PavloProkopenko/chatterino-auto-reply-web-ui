<script lang="ts">
  import { tick } from 'svelte';
  import { ru } from '../../i18n/ru.ts';
  import Icon from './Icon.svelte';

  let { reply = $bindable(), error, uid, inserts = ['{user}'], help = '' }: { reply: string; error?: string | undefined; uid: string; inserts?: string[]; help?: string } = $props();
  const T = ru.rules.editor;
  const MAX = 500;
  let el = $state<HTMLTextAreaElement>();
  // The plugin counts bytes (`#reply` in Lua): a Russian letter takes two.
  const bytes = $derived(new TextEncoder().encode(reply).length);

  async function insert(token: string) {
    const area = el;
    const from = area?.selectionStart ?? reply.length;
    const to = area?.selectionEnd ?? from;
    reply = reply.slice(0, from) + token + reply.slice(to);
    await tick();
    area?.focus();
    area?.setSelectionRange(from + token.length, from + token.length);
  }
</script>

<div class="field">
  <label for="{uid}-reply">{T.reply}</label>
  <span class="help" id="{uid}-replyh">{help || T.replyHelp} {T.userHelp}</span>
  <textarea id="{uid}-reply" class="input" rows="3" bind:this={el} bind:value={reply} aria-describedby="{uid}-replyh {uid}-replye" aria-invalid={error ? 'true' : undefined}></textarea>
  <div class="row-between">
    <span class="file-actions">
      {#each inserts as token (token)}<button class="btn small" type="button" onclick={() => void insert(token)}>{T.insert(token)}</button>{/each}
    </span>
    <span class="counter" class:over={bytes > MAX}>{T.counter(bytes)}</span>
  </div>
  <span class="help">{T.replyBytes}</span>
  <span id="{uid}-replye" class="error-text" role="alert">{#if error}<Icon name="alert" size={14} />{error}{/if}</span>
</div>
