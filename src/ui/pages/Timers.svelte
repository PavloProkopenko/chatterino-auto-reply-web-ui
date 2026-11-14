<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import type { Timer } from '../../shared/config.ts';
  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import PreviewDialog from '../components/PreviewDialog.svelte';
  import { lua } from '../lua.ts';
  import { session } from '../state/app.svelte.ts';
  import { router } from '../state/route.svelte.ts';
  import { refocusAfterMove } from '../state/focus.ts';
  import { channelMissing, startedText, timerGatingProblems } from '../state/item-text.ts';
  import { deleteItems, moveStep, moveTo } from '../state/lists.ts';
  import { DragOrder } from '../state/order.svelte.ts';
  import { describeConditions, replyStart, ruleLabel } from '../state/rule-text.ts';
  import { analyseTimers, type TimerAnalysis } from '../state/timer-checks.ts';
  import { isRunning, startTimer, stopTimer } from '../state/timers.ts';

  const T = ru.timers;
  const cfg = $derived(session.current!);
  const features = $derived(session.source!.features);
  // Older plugins only know a single trigger word: writing conditions would break them, so those timers are view and switch only.
  const canEdit = $derived(features.timerConditions);

  let previewOpen = $state(false);
  let removing = $state<number | null>(null);
  let starting = $state<number | null>(null);
  let analysis = $state.raw(new Map<number, TimerAnalysis>());
  let moved = $state('');

  $effect(() => {
    const timers = $state.snapshot(cfg.timers) as Timer[];
    const me = cfg.channels[0] ?? '';
    let cancelled = false;
    const handle = setTimeout(() => {
      analyseTimers(lua, timers, me).then(
        (a) => void (cancelled || (analysis = a)),
        () => undefined,
      );
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  });

  function hints(t: Timer): { text: string; error: boolean }[] {
    const out: { text: string; error: boolean }[] = [];
    const a = analysis.get(t.id);
    if (a?.replyError) out.push({ text: T.warn.replyBad(a.replyError), error: true });
    if (a?.conditionError) out.push({ text: T.warn.conditionBad(a.conditionError), error: true });
    if (a?.nameError) out.push({ text: T.warn.nameBad(a.nameError), error: true });
    if (channelMissing(t.channel, cfg.channels)) out.push({ text: T.warn.dormant(t.channel || '—'), error: true });
    if (a?.shadowedBy !== undefined) {
      const by = cfg.timers.find((x) => x.id === a.shadowedBy);
      if (by) out.push({ text: T.warn.shadowed(ruleLabel(by)), error: false });
    }
    for (const g of timerGatingProblems(t, features)) out.push({ text: g, error: false });
    return out;
  }

  const order = new DragOrder({ enabled: () => true, move: (id, target) => session.edit((c) => moveTo(c, 'timers', id, target)) });

  async function step(id: number, delta: -1 | 1) {
    session.edit((c) => moveStep(c, 'timers', id, delta));
    await refocusAfterMove(id, delta);
    const t = cfg.timers.find((x) => x.id === id);
    if (t) moved = T.row.moved(ruleLabel(t), cfg.timers.indexOf(t) + 1);
  }

  function confirmStart() {
    const id = starting;
    starting = null;
    if (id !== null) session.edit((c) => void startTimer(c, id, Math.floor(Date.now() / 1000)));
  }
  const stop = (id: number) => session.edit((c) => void stopTimer(c, id));

  function confirmRemove() {
    const id = removing;
    removing = null;
    if (id === null) return;
    session.edit((c) => void deleteItems(c, 'timers', [id]));
  }
</script>

<div class="page wide">
  <div class="page-head">
    <div class="stack">
      <h1>{ru.nav.timers}</h1>
      <p class="muted">{T.intro}</p>
    </div>
    <div class="head-actions">
      <button class="btn" type="button" onclick={() => (previewOpen = true)}>{ru.rules.preview.title}</button>
      <button class="btn primary" type="button" disabled={!canEdit} onclick={() => router.go({ page: 'timers', view: 'edit', id: null })}><Icon name="plus" size={16} />{T.add}</button>
    </div>
  </div>

  {#if !canEdit}
    <div class="banner info" role="note"><Icon name="alert" /><div class="body"><p>{features.versionKnown ? T.oldPlugin : T.unknownPlugin}</p></div></div>
  {/if}

  <section class="rules-col" aria-label={T.listLabel}>
    {#if cfg.timers.length === 0}
      <div class="card"><p><strong>{T.empty}</strong></p><p class="help">{T.emptyHelp}</p></div>
    {:else}
      <p class="sr-only" role="status">{moved}</p>
      <ol class="rules">
        {#each cfg.timers as timer, i (timer.id)}
          {@const label = ruleLabel(timer)}
          {@const running = isRunning(timer)}
          <li class="rule-row nocheck" data-item={timer.id} {...order.row(timer.id)}>
            <span class="grip" aria-hidden="true" title={T.row.drag}><Icon name="grip" size={16} /></span>
            <span class="rule-pos"><span class="num">{T.position(i + 1)}</span><span class="id">{T.idLabel(timer.id)}</span></span>
            <div class="rule-main">
              <span class="rule-title">{timer.name ? `${timer.name}: ` : ''}{replyStart(timer.reply) || T.untitled}</span>
              <span class="rule-sub">{describeConditions(timer)}</span>
              <span class="rule-sub">{T.channelOf(timer.channel || '—')}</span>
              <span class="rule-sub">
                {#if running && typeof timer.started_at === 'number'}{T.stateRunning(startedText(timer.started_at))} ({T.stateRunningNote}){:else}{T.stateStopped}{/if}
              </span>
              {#each hints(timer) as h (h.text)}
                <span class="warn-line" class:error={h.error}><Icon name="alert" size={14} />{h.text}</span>
              {/each}
            </div>
            <div class="rule-actions">
              {#if running}
                <button class="btn small" type="button" aria-label={T.row.stop(label)} onclick={() => stop(timer.id)}>{T.stop}</button>
              {:else}
                <button class="btn small" type="button" aria-label={T.row.start(label)} onclick={() => (starting = timer.id)}>{T.start}</button>
              {/if}
              <button class="btn ghost small icon-only" type="button" data-act="up" aria-label={T.row.up(label)} disabled={i === 0} onclick={() => void step(timer.id, -1)}><Icon name="up" size={16} /></button>
              <button class="btn ghost small icon-only" type="button" data-act="down" aria-label={T.row.down(label)} disabled={i === cfg.timers.length - 1} onclick={() => void step(timer.id, 1)}><Icon name="down" size={16} /></button>
              <button class="btn ghost small icon-only" type="button" data-act="edit" aria-label={T.row.edit(label)} disabled={!canEdit} onclick={() => router.go({ page: 'timers', view: 'edit', id: timer.id })}><Icon name="edit" size={16} /></button>
              <button class="btn ghost small icon-only" type="button" aria-label={T.row.remove(label)} onclick={() => (removing = timer.id)}><Icon name="trash" size={16} /></button>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>

<Dialog open={starting !== null} title={T.startConfirm.title(ruleLabel(cfg.timers.find((t) => t.id === starting) ?? { id: starting ?? 0 }))} onclose={() => (starting = null)}>
  <p class="muted">{T.startConfirm.body}</p>
  {#snippet footer()}
    <button class="btn primary" type="button" onclick={confirmStart}>{T.startConfirm.yes}</button>
    <button class="btn" type="button" onclick={() => (starting = null)}>{T.startConfirm.cancel}</button>
  {/snippet}
</Dialog>

<Dialog open={removing !== null} title={T.removeConfirm.title} onclose={() => (removing = null)}>
  <p class="muted">{T.removeConfirm.body}</p>
  {#snippet footer()}
    <button class="btn danger" type="button" onclick={confirmRemove}>{T.removeConfirm.yes}</button>
    <button class="btn" type="button" onclick={() => (removing = null)}>{T.removeConfirm.cancel}</button>
  {/snippet}
</Dialog>

<PreviewDialog open={previewOpen} onclose={() => (previewOpen = false)} rules={cfg.rules} timers={cfg.timers} channels={cfg.channels} />
