<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import TimerEditor from '../components/TimerEditor.svelte';
  import Icon from '../components/Icon.svelte';
  import { session } from '../state/app.svelte.ts';
  import { router } from '../state/route.svelte.ts';

  let { id }: { id: number | null } = $props();

  // Older plugins only know a single trigger word: the list blocks editing for them, and so does a typed-in link.
  const canEdit = $derived(session.source?.features.timerConditions ?? false);
  const exists = $derived(canEdit && (id === null || (session.current?.timers.some((x) => x.id === id) ?? false)));
  const back = () => router.replace({ page: 'timers', view: 'list' });

  // An id that is not in the file (deleted, undone, a stale link) leads back to the list instead of an empty form.
  $effect(() => {
    if (!exists) back();
  });
</script>

{#if exists}
  <div class="page">
    <button class="btn ghost small back-link" type="button" onclick={() => router.go({ page: 'timers', view: 'list' })}><Icon name="left" size={16} />{ru.nav.back(ru.nav.timers)}</button>
    {#key id ?? 'new'}
      <TimerEditor timerId={id} onclose={back} />
    {/key}
  </div>
{/if}
