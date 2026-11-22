<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import RedeemEditor from '../components/RedeemEditor.svelte';
  import Icon from '../components/Icon.svelte';
  import { currentRedeemBlock, session, twitch } from '../state/app.svelte.ts';
  import { router } from '../state/route.svelte.ts';

  let { id }: { id: number | null } = $props();

  const exists = $derived(id === null || (session.current?.redeems.some((x) => x.id === id) ?? false));
  const back = () => router.replace({ page: 'redeems', view: 'list' });

  // A new reward needs the Twitch login (see Redeems.svelte). Wait until the login has been read, so that opening
  // this address directly (a reload) does not bounce a user who is logged in; editing an existing reward is never blocked.
  const blocked = $derived(id === null && twitch.status !== null && currentRedeemBlock() !== null);

  // An id that is not in the file (deleted, undone, a stale link) leads back to the list instead of an empty form.
  $effect(() => {
    if (!exists || blocked) back();
  });
</script>

{#if exists && !blocked}
  <div class="page">
    <button class="btn ghost small back-link" type="button" onclick={() => router.go({ page: 'redeems', view: 'list' })}><Icon name="left" size={16} />{ru.nav.back(ru.nav.redeems)}</button>
    {#key id ?? 'new'}
      <RedeemEditor redeemId={id} onclose={back} />
    {/key}
  </div>
{/if}
