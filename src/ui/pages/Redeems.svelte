<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import type { Redeem } from '../../shared/config.ts';
  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import { lua } from '../lua.ts';
  import { session } from '../state/app.svelte.ts';
  import { router } from '../state/route.svelte.ts';
  import { refocusAfterMove } from '../state/focus.ts';
  import { channelMissing, describeRedeem, redeemGatingProblems } from '../state/item-text.ts';
  import { deleteItems, moveStep, moveTo } from '../state/lists.ts';
  import { DragOrder } from '../state/order.svelte.ts';
  import { setRedeemEnabled } from '../state/redeems.ts';
  import { analyseRedeems, type RedeemAnalysis } from '../state/timer-checks.ts';

  const T = ru.redeems;
  const cfg = $derived(session.current!);
  const features = $derived(session.source!.features);

  let removing = $state<number | null>(null);
  let analysis = $state.raw(new Map<number, RedeemAnalysis>());
  let moved = $state('');

  $effect(() => {
    const list = $state.snapshot(cfg.redeems) as Redeem[];
    let cancelled = false;
    const handle = setTimeout(() => {
      analyseRedeems(lua, list).then(
        (a) => void (cancelled || (analysis = a)),
        () => undefined,
      );
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  });

  const label = (r: Redeem) => (r.name ? r.name : r.title.trim() ? `«${r.title}»` : T.noTitle);
  const byId = (id: number) => cfg.redeems.find((r) => r.id === id);
  // Mutes by redeem are checked against the "protected" list in Settings: an empty list leaves moderators and bots exposed.
  const unprotected = $derived(cfg.protect_users.length === 0 && cfg.redeems.some((r) => r.enabled !== false && r.action === 'timeout'));

  function hints(r: Redeem): { text: string; error: boolean }[] {
    const out: { text: string; error: boolean }[] = [];
    const a = analysis.get(r.id);
    if (a?.titleError) out.push({ text: T.warn.titleBad(a.titleError), error: true });
    if (a?.secondsError) out.push({ text: T.warn.secondsBad(a.secondsError), error: true });
    if (a?.nameError) out.push({ text: T.warn.nameBad(a.nameError), error: true });
    if (a?.duplicateOf !== undefined) {
      const d = byId(a.duplicateOf);
      if (d) out.push({ text: T.warn.duplicate(label(d)), error: true });
    }
    if (channelMissing(r.channel, cfg.channels)) out.push({ text: T.warn.dormant(r.channel || '—'), error: true });
    if (a?.shadowedBy !== undefined) {
      const s = byId(a.shadowedBy);
      if (s) out.push({ text: T.warn.shadowed(label(s)), error: true });
    }
    for (const g of redeemGatingProblems(r, features)) out.push({ text: g, error: false });
    return out;
  }

  const order = new DragOrder({ enabled: () => true, move: (id, target) => session.edit((c) => moveTo(c, 'redeems', id, target)) });

  async function step(id: number, delta: -1 | 1) {
    session.edit((c) => moveStep(c, 'redeems', id, delta));
    await refocusAfterMove(id, delta);
    const r = byId(id);
    if (r) moved = T.row.moved(label(r), cfg.redeems.indexOf(r) + 1);
  }

  function confirmRemove() {
    const id = removing;
    removing = null;
    if (id === null) return;
    session.edit((c) => void deleteItems(c, 'redeems', [id]));
  }
</script>

<div class="page wide">
  <div class="page-head">
    <div class="stack">
      <h1>{ru.nav.redeems}</h1>
      <p class="muted">{T.intro}</p>
    </div>
    <button class="btn primary" type="button" onclick={() => router.go({ page: 'redeems', view: 'edit', id: null })}><Icon name="plus" size={16} />{T.add}</button>
  </div>

  <div class="page-notes">
    <div class="banner info" role="note"><Icon name="alert" /><div class="body"><p>{T.modNote}</p><p class="help">{T.settingsHint}</p></div></div>
    {#if unprotected}
      <div class="banner warn" role="status"><Icon name="alert" /><div class="body"><p>{T.protectWarn}</p></div></div>
    {/if}
  </div>

  <section class="rules-col" aria-label={T.listLabel}>
    {#if cfg.redeems.length === 0}
      <div class="card"><p><strong>{T.empty}</strong></p><p class="help">{T.emptyHelp}</p></div>
    {:else}
      <p class="sr-only" role="status">{moved}</p>
      <ol class="rules">
        {#each cfg.redeems as redeem, i (redeem.id)}
          {@const name = label(redeem)}
          <li class="rule-row nocheck" data-item={redeem.id} class:off={redeem.enabled === false} {...order.row(redeem.id)}>
            <span class="grip" aria-hidden="true" title={T.row.drag}><Icon name="grip" size={16} /></span>
            <span class="rule-pos"><span class="num">{T.position(i + 1)}</span><span class="id">{T.idLabel(redeem.id)}</span></span>
            <div class="rule-main">
              <span class="rule-title">{redeem.name ? `${redeem.name}: ` : ''}{T.titleShown(redeem.title.trim() || T.noTitle)}</span>
              <span class="rule-sub">{describeRedeem(redeem)}</span>
              <span class="rule-sub">{T.channelOf(redeem.channel || '—')}{redeem.enabled === false ? ` · ${T.off}` : ''}</span>
              {#each hints(redeem) as h (h.text)}
                <span class="warn-line" class:error={h.error}><Icon name="alert" size={14} />{h.text}</span>
              {/each}
            </div>
            <div class="rule-actions">
              <button type="button" role="switch" class="switch" aria-checked={redeem.enabled !== false} aria-label={T.row.enabled(name)} onclick={() => session.edit((c) => setRedeemEnabled(c, redeem.id, redeem.enabled === false))}></button>
              <button class="btn ghost small icon-only" type="button" data-act="up" aria-label={T.row.up(name)} disabled={i === 0} onclick={() => void step(redeem.id, -1)}><Icon name="up" size={16} /></button>
              <button class="btn ghost small icon-only" type="button" data-act="down" aria-label={T.row.down(name)} disabled={i === cfg.redeems.length - 1} onclick={() => void step(redeem.id, 1)}><Icon name="down" size={16} /></button>
              <button class="btn ghost small icon-only" type="button" data-act="edit" aria-label={T.row.edit(name)} onclick={() => router.go({ page: 'redeems', view: 'edit', id: redeem.id })}><Icon name="edit" size={16} /></button>
              <button class="btn ghost small icon-only" type="button" aria-label={T.row.remove(name)} onclick={() => (removing = redeem.id)}><Icon name="trash" size={16} /></button>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>

<Dialog open={removing !== null} title={T.removeConfirm.title} onclose={() => (removing = null)}>
  <p class="muted">{T.removeConfirm.body}</p>
  {#snippet footer()}
    <button class="btn danger" type="button" onclick={confirmRemove}>{T.removeConfirm.yes}</button>
    <button class="btn" type="button" onclick={() => (removing = null)}>{T.removeConfirm.cancel}</button>
  {/snippet}
</Dialog>
