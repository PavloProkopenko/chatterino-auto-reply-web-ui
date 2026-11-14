<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import type { Resolutions } from '../../shared/merge.ts';
  import { session } from '../state/app.svelte.ts';
  import Dialog from './Dialog.svelte';

  const LABELS: Record<string, string> = {
    per_user_cooldown: ru.settings.pace.perUser,
    per_rule_cooldown: ru.settings.pace.perRule,
    global_min_gap: ru.settings.pace.gap,
    only_when_live: ru.settings.when.live,
    skip_mods: ru.settings.when.skipMods,
    mute_lurkers: ru.settings.redeems.muteLurkers,
    backfire: ru.settings.redeems.backfire,
    channels: ru.settings.lists.channels,
    ignore_users: ru.settings.lists.ignore,
    protect_users: ru.settings.lists.protect,
  };
  let choices = $state<Resolutions>({});
  const conflicts = $derived(session.conflict?.conflicts ?? []);
  const complete = $derived(conflicts.length > 0 && conflicts.every((c) => choices[c.path]));
  $effect(() => {
    if (!session.conflict) choices = {};
  });

  const show = (v: unknown) => (v === undefined ? ru.conflict.removed : typeof v === 'string' ? v : JSON.stringify(v));
</script>

<Dialog open={session.conflict !== null} title={ru.conflict.title} onclose={() => session.cancelConflict()}>
  <p class="muted">{ru.conflict.intro}</p>
  {#each conflicts as c (c.path)}
    <fieldset>
      <legend>{LABELS[c.path] ?? c.path}</legend>
      <label class="radio"><input type="radio" name={c.path} checked={choices[c.path] === 'theirs'} onchange={() => (choices[c.path] = 'theirs')} /><span>{ru.conflict.theirs}: <strong>{show(c.theirs)}</strong></span></label>
      <label class="radio"><input type="radio" name={c.path} checked={choices[c.path] === 'mine'} onchange={() => (choices[c.path] = 'mine')} /><span>{ru.conflict.mine}: <strong>{show(c.mine)}</strong></span></label>
    </fieldset>
  {/each}
  {#snippet footer()}
    <button class="btn" type="button" onclick={() => session.cancelConflict()}>{ru.conflict.cancel}</button>
    <button class="btn primary" type="button" disabled={!complete} onclick={() => void session.resolveConflicts($state.snapshot(choices))}>{ru.conflict.apply}</button>
  {/snippet}
</Dialog>
