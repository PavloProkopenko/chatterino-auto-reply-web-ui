<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { session } from '../state/app.svelte.ts';
  import { collectNotices, newErrorIds } from '../state/notices.ts';
  import Icon from './Icon.svelte';
  import NoticePanel from './NoticePanel.svelte';

  const uid = $props.id();
  const notices = $derived(collectNotices(session));
  const hasError = $derived(notices.some((n) => n.level === 'error'));

  let open = $state(false);
  let wrap: HTMLElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();
  let known = new Set<string>();

  // A new error opens the popup once, so a failed save is never missed; the same error does not reopen it after closing.
  $effect(() => {
    const list = notices;
    if (newErrorIds(known, list).length > 0) open = true;
    known = new Set(list.map((n) => n.id));
  });

  function close(refocus: boolean) {
    open = false;
    if (refocus) button?.focus();
  }
  function onWindowClick(e: MouseEvent) {
    // Only real clicks: the page's own download helper clicks a hidden link, which must not close the popup.
    if (open && e.isTrusted && wrap && !wrap.contains(e.target as Node)) close(false);
  }
  function onKey(e: KeyboardEvent) {
    // On the window, not on the panel: a popup that opened by itself does not hold the focus.
    if (open && e.key === 'Escape' && !document.querySelector('dialog[open]')) close(true);
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKey} />

<div class="topbar">
  <div class="notice-wrap" bind:this={wrap}>
    <button
      bind:this={button}
      class="btn ghost icon-only bell"
      class:has-error={hasError}
      type="button"
      aria-label={ru.notices.button(notices.length)}
      aria-expanded={open}
      aria-controls="{uid}-pop"
      onclick={() => (open = !open)}
    >
      <Icon name="bell" />
      {#if notices.length > 0}<span class="bell-count" aria-hidden="true">{notices.length}</span>{/if}
    </button>
    {#if open}
      <div class="notice-pop" id="{uid}-pop" role="region" aria-label={ru.notices.title}>
        <h2 class="notice-title">{ru.notices.title}</h2>
        <NoticePanel {notices} />
      </div>
    {/if}
  </div>
</div>
