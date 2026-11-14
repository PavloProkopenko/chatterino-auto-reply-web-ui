<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import RedeemEditor from '../components/RedeemEditor.svelte';
  import Icon from '../components/Icon.svelte';
  import { session } from '../state/app.svelte.ts';
  import { router } from '../state/route.svelte.ts';

  let { id }: { id: number | null } = $props();

  const exists = $derived(id === null || (session.current?.redeems.some((x) => x.id === id) ?? false));
  const back = () => router.replace({ page: 'redeems', view: 'list' });

  // An id that is not in the file (deleted, undone, a stale link) leads back to the list instead of an empty form.
  $effect(() => {
    if (!exists) back();
  });
</script>

{#if exists}
  <div class="page">
    <button class="btn ghost small back-link" type="button" onclick={() => router.go({ page: 'redeems', view: 'list' })}><Icon name="left" size={16} />{ru.nav.back(ru.nav.redeems)}</button>
    {#key id ?? 'new'}
      <RedeemEditor redeemId={id} onclose={back} />
    {/key}
  </div>
{/if}
