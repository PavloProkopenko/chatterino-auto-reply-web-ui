<script lang="ts">
  import { untrack } from 'svelte';
  import { ru } from '../../i18n/ru.ts';
  import type { Condition, Rule } from '../../shared/config.ts';
  import { lua } from '../lua.ts';
  import { previewRules, type PreviewResult } from '../state/rule-checks.ts';
  import { ruleLabel } from '../state/rule-text.ts';

  let { rules, channels, focusId = null, focusConditions = null }: { rules: Rule[]; channels: string[]; focusId?: number | null; focusConditions?: Condition[] | null } = $props();
  const T = ru.rules.preview;
  const uid = $props.id();
  const FLAGS = ['first', 'highlighted', 'reply', 'announcement', 'sub', 'cheer'];

  let text = $state('');
  let sender = $state('');
  let channel = $state(untrack(() => channels[0] ?? ''));
  let me = $state(untrack(() => channels[0] ?? ''));
  let flags = $state<string[]>([]);
  let result = $state.raw<PreviewResult | null>(null);
  let failed = $state(false);

  // Runs the plugin's own Lua in the worker, a moment after the last keystroke.
  $effect(() => {
    const list = $state.snapshot(rules) as Rule[];
    const input = { text, channel: channel.trim().toLowerCase(), flags: [...flags], me: me.trim().toLowerCase() };
    if (!input.text.trim()) {
      result = null;
      failed = false;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      previewRules(lua, list, input).then(
        (r) => {
          if (cancelled) return;
          result = r;
          failed = false;
        },
        () => {
          if (cancelled) return;
          result = null;
          failed = true;
        },
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  const position = (id: number) => rules.findIndex((r) => r.id === id) + 1;
  const ruleOf = (id: number | null) => (id === null ? undefined : rules.find((r) => r.id === id));
  const winner = $derived(ruleOf(result?.winner ?? null));
  const shownReply = $derived(winner ? winner.reply.replaceAll('{user}', sender.trim() || T.senderDefault) : '');
  const mine = $derived(focusId === null ? undefined : result?.rows.find((r) => r.id === focusId));

  const mineVerdict = $derived.by(() => {
    if (!mine || focusId === null) return null;
    if (!mine.active) return T.mineActive;
    if (!mine.applies) return T.mineChannel(channel.trim());
    if (!mine.matched) return T.mineNo;
    if (result?.winner === focusId) return T.mineWins;
    const other = ruleOf(result?.winner ?? null);
    return other ? T.mineLoses(ruleLabel(other), position(other.id)) : T.mineNo;
  });

  async function fillSample() {
    if (!focusConditions) return;
    const [sample, names] = await lua.call('rules', 'sample', $state.snapshot(focusConditions), me.trim().toLowerCase());
    text = typeof sample === 'string' ? sample : '';
    flags = Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [];
  }

  const toggleFlag = (name: string, on: boolean) => (flags = on ? [...flags, name] : flags.filter((f) => f !== name));
</script>

<section class="card" aria-labelledby="{uid}-t">
  <h2 id="{uid}-t">{T.title}</h2>
  <p class="help">{T.intro}</p>

  <div class="field">
    <label for="{uid}-m">{T.message}</label>
    <input id="{uid}-m" class="input" type="text" autocomplete="off" bind:value={text} />
  </div>
  {#if focusConditions}
    <div><button class="btn small" type="button" onclick={() => void fillSample()}>{T.sample}</button></div>
  {/if}

  <div class="field">
    <label for="{uid}-s">{T.sender}</label>
    <input id="{uid}-s" class="input" type="text" autocomplete="off" placeholder={T.senderDefault} bind:value={sender} />
  </div>
  <div class="field">
    <label for="{uid}-c">{T.channel}</label>
    <input id="{uid}-c" class="input" type="text" autocomplete="off" list="{uid}-cl" bind:value={channel} />
    <datalist id="{uid}-cl">{#each channels as c (c)}<option value={c}></option>{/each}</datalist>
  </div>
  <div class="field">
    <label for="{uid}-me">{T.me}</label>
    <input id="{uid}-me" class="input" type="text" autocomplete="off" bind:value={me} aria-describedby="{uid}-meh" />
    <span class="help" id="{uid}-meh">{T.meHelp}</span>
  </div>
  <fieldset>
    <legend>{T.flags}</legend>
    {#each FLAGS as name (name)}
      <label class="choice-row"><input type="checkbox" checked={flags.includes(name)} onchange={(e) => toggleFlag(name, e.currentTarget.checked)} />{ru.rules.flags[name]}</label>
    {/each}
  </fieldset>

  <div aria-live="polite" class="stack">
    {#if failed}
      <p class="error-text" role="alert">{T.failed}</p>
    {:else if !text.trim()}
      <p class="help">{T.noMessage}</p>
    {:else if result}
      {#if winner}
        <div class="preview-result">
          <strong>{T.winner(ruleLabel(winner), position(winner.id))}</strong>
          <span class="preview-reply" translate="no">{shownReply}</span>
        </div>
      {:else}
        <div class="preview-result none"><strong>{T.none}</strong></div>
      {/if}
      {#if mineVerdict}<p><strong>{T.mine}</strong> {mineVerdict}</p>{/if}
    {/if}
  </div>
  <p class="help">{T.limits}</p>
</section>
