<script lang="ts">
  import { untrack } from 'svelte';
  import { ru } from '../../i18n/ru.ts';
  import type { Condition, Rule, Timer } from '../../shared/config.ts';
  import { lua } from '../lua.ts';
  import { preview as P } from '../state/preview-state.svelte.ts';
  import { type PreviewAllResult, parseDuration, previewAll } from '../state/timer-checks.ts';
  import { ruleLabel } from '../state/rule-text.ts';

  let {
    rules,
    timers = [],
    channels,
    focus = null,
    focusConditions = null,
    embedded = false,
  }: { rules: Rule[]; timers?: Timer[]; channels: string[]; focus?: { kind: 'rule' | 'timer'; id: number } | null; focusConditions?: Condition[] | null; embedded?: boolean } = $props();
  const T = ru.rules.preview;
  const uid = $props.id();
  const FLAGS = ['first', 'highlighted', 'reply', 'announcement', 'sub', 'cheer'];

  // The inputs live in a shared store so they survive closing the modal and moving between pages.
  untrack(() => {
    if (!P.channel) P.channel = channels[0] ?? '';
    if (!P.me) P.me = channels[0] ?? '';
  });
  let elapsedBad = $state(false);
  let result = $state.raw<PreviewAllResult | null>(null);
  let failed = $state(false);

  // Runs the plugin's own Lua in the worker, a moment after the last keystroke: running timers first, then rules.
  $effect(() => {
    const rulesNow = $state.snapshot(rules) as Rule[];
    const timersNow = $state.snapshot(timers) as Timer[];
    const input = { text: P.text, channel: P.channel.trim().toLowerCase(), flags: [...P.flags], me: P.me.trim().toLowerCase() };
    const elapsedText = P.elapsed.trim();
    if (!input.text.trim()) {
      result = null;
      failed = false;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const seconds = elapsedText === '' ? 0 : await parseDuration(lua, elapsedText);
          const r = await previewAll(lua, timersNow, rulesNow, { ...input, elapsedSeconds: seconds ?? 0 });
          if (cancelled) return;
          elapsedBad = seconds === null;
          result = r;
          failed = false;
        } catch {
          if (cancelled) return;
          result = null;
          failed = true;
        }
      })();
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  const timerAt = (id: number) => timers.findIndex((x) => x.id === id) + 1;
  const ruleAt = (id: number) => rules.findIndex((x) => x.id === id) + 1;
  const winnerItem = $derived.by(() => {
    const w = result?.winner;
    if (!w) return null;
    return w.kind === 'timer' ? { kind: 'timer' as const, item: timers.find((x) => x.id === w.id), time: w.time ?? '' } : { kind: 'rule' as const, item: rules.find((x) => x.id === w.id), time: '' };
  });
  const shownReply = $derived.by(() => {
    const w = winnerItem;
    if (!w?.item) return '';
    return w.item.reply.replaceAll('{user}', P.sender.trim() || T.senderDefault).replaceAll('{time}', w.time);
  });
  const winnerTitle = $derived.by(() => {
    const w = winnerItem;
    if (!w?.item) return '';
    return w.kind === 'timer' ? T.winnerTimer(ruleLabel(w.item), timerAt(w.item.id)) : T.winner(ruleLabel(w.item), ruleAt(w.item.id));
  });

  const mineVerdict = $derived.by(() => {
    if (!focus || !result) return null;
    const row = focus.kind === 'timer' ? result.timers.find((r) => r.id === focus.id) : result.rules.find((r) => r.id === focus.id);
    if (!row) return null;
    if (!row.active) return T.mineActive;
    if (!row.applies) return T.mineChannel(P.channel.trim());
    if (!row.matched) return T.mineNo;
    const w = result.winner;
    if (w && w.kind === focus.kind && w.id === focus.id) return T.mineWins;
    if (focus.kind === 'timer' && !(row as { running?: boolean }).running) return T.mineStopped;
    if (!w) return T.mineNo;
    const other = w.kind === 'timer' ? timers.find((x) => x.id === w.id) : rules.find((x) => x.id === w.id);
    return other ? T.mineLoses(w.kind === 'timer' ? T.kindTimer : T.kindRule, ruleLabel(other), w.kind === 'timer' ? timerAt(w.id) : ruleAt(w.id)) : T.mineNo;
  });

  async function fillSample() {
    if (!focusConditions) return;
    const [sample, names] = await lua.call('rules', 'sample', $state.snapshot(focusConditions), P.me.trim().toLowerCase());
    P.text = typeof sample === 'string' ? sample : '';
    P.flags = Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [];
  }

  const toggleFlag = (name: string, on: boolean) => (P.flags = on ? [...P.flags, name] : P.flags.filter((f) => f !== name));
</script>

<section class={embedded ? 'stack' : 'card'} aria-labelledby={embedded ? undefined : `${uid}-t`} aria-label={embedded ? T.title : undefined}>
  {#if !embedded}<h2 id="{uid}-t">{T.title}</h2>{/if}
  <p class="help">{T.intro}</p>
  {#if timers.length > 0}<p class="help">{T.timersNote}</p>{/if}

  <div class="field">
    <label for="{uid}-m">{T.message}</label>
    <input id="{uid}-m" class="input" type="text" autocomplete="off" bind:value={P.text} />
  </div>
  {#if focusConditions}
    <div><button class="btn small" type="button" onclick={() => void fillSample()}>{T.sample}</button></div>
  {/if}

  <div class="field">
    <label for="{uid}-s">{T.sender}</label>
    <input id="{uid}-s" class="input" type="text" autocomplete="off" placeholder={T.senderDefault} bind:value={P.sender} />
  </div>
  <div class="field">
    <label for="{uid}-c">{T.channel}</label>
    <input id="{uid}-c" class="input" type="text" autocomplete="off" list="{uid}-cl" bind:value={P.channel} />
    <datalist id="{uid}-cl">{#each channels as c (c)}<option value={c}></option>{/each}</datalist>
  </div>
  <div class="field">
    <label for="{uid}-me">{T.me}</label>
    <input id="{uid}-me" class="input" type="text" autocomplete="off" bind:value={P.me} aria-describedby="{uid}-meh" />
    <span class="help" id="{uid}-meh">{T.meHelp}</span>
  </div>
  {#if timers.length > 0}
    <div class="field">
      <label for="{uid}-el">{T.elapsed}</label>
      <input id="{uid}-el" class="input" type="text" autocomplete="off" bind:value={P.elapsed} aria-describedby="{uid}-elh" />
      <span class="help" id="{uid}-elh">{T.elapsedHelp}</span>
      {#if elapsedBad}<span class="error-text" role="status">{T.elapsedBad}</span>{/if}
    </div>
  {/if}
  <fieldset>
    <legend>{T.flags}</legend>
    {#each FLAGS as name (name)}
      <label class="choice-row"><input type="checkbox" checked={P.flags.includes(name)} onchange={(e) => toggleFlag(name, e.currentTarget.checked)} />{ru.rules.flags[name]}</label>
    {/each}
  </fieldset>

  <div aria-live="polite" class="stack">
    {#if failed}
      <p class="error-text" role="alert">{T.failed}</p>
    {:else if !P.text.trim()}
      <p class="help">{T.noMessage}</p>
    {:else if result}
      {#if winnerItem?.item}
        <div class="preview-result">
          <strong>{winnerTitle}</strong>
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
