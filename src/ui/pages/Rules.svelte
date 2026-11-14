<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { tick } from 'svelte';
  import type { Rule } from '../../shared/config.ts';
  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import RuleEditor from '../components/RuleEditor.svelte';
  import RulePreview from '../components/RulePreview.svelte';
  import { lua } from '../lua.ts';
  import { session } from '../state/app.svelte.ts';
  import { analyseRules, type RuleAnalysis } from '../state/rule-checks.ts';
  import { describeConditions, gatingProblems, missingChannels, replyStart, ruleLabel } from '../state/rule-text.ts';
  import { deleteRules, moveRule, moveRuleTo, moveToEdge, setRulesEnabled } from '../state/rules.ts';

  const T = ru.rules;
  const cfg = $derived(session.current!);
  const features = $derived(session.source!.features);

  let query = $state('');
  let selected = $state<number[]>([]);
  let editor = $state<{ id: number | null } | null>(null);
  let confirming = $state<number[] | null>(null);
  let analysis = $state.raw(new Map<number, RuleAnalysis>());
  let dragId = $state<number | null>(null);
  let overId = $state<number | null>(null);

  // Reply, condition and name problems and shadowing, found by the plugin's own Lua a moment after the list changes.
  $effect(() => {
    const rules = $state.snapshot(cfg.rules) as Rule[];
    const me = cfg.channels[0] ?? '';
    let cancelled = false;
    const timer = setTimeout(() => {
      analyseRules(lua, rules, me).then(
        (a) => void (cancelled || (analysis = a)),
        () => undefined, // the worker was stopped: the list simply shows no hints
      );
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  // Selected rules that disappeared (deleted, undo) drop out of the selection.
  $effect(() => {
    const ids = new Set(cfg.rules.map((r) => r.id));
    if (selected.some((id) => !ids.has(id))) selected = selected.filter((id) => ids.has(id));
  });

  const q = $derived(query.trim().toLowerCase());
  const rows = $derived(
    cfg.rules
      .map((rule, i) => ({ rule, pos: i + 1 }))
      .filter(({ rule }) => !q || [rule.name ?? '', rule.reply, describeConditions(rule)].join(' ').toLowerCase().includes(q)),
  );
  const canReorder = $derived(q === '');
  const allShownSelected = $derived(rows.length > 0 && rows.every(({ rule }) => selected.includes(rule.id)));

  function hints(rule: Rule): { text: string; error: boolean }[] {
    const out: { text: string; error: boolean }[] = [];
    const a = analysis.get(rule.id);
    if (a?.replyError) out.push({ text: T.warn.replyBad(a.replyError), error: true });
    if (a?.conditionError) out.push({ text: T.warn.conditionBad(a.conditionError), error: true });
    if (a?.nameError) out.push({ text: T.warn.nameBad(a.nameError), error: true });
    const ch = missingChannels(rule, cfg.channels);
    if (ch.missing.length) out.push({ text: (ch.all ? T.warn.dormantAll : T.warn.dormantSome)(ch.missing.join(', ')), error: ch.all });
    if (a?.shadowedBy !== undefined) {
      const by = cfg.rules.find((r) => r.id === a.shadowedBy);
      if (by) out.push({ text: T.warn.shadowed(ruleLabel(by)), error: false });
    }
    for (const g of gatingProblems(rule, features)) out.push({ text: g, error: false });
    return out;
  }

  const select = (id: number, on: boolean) => (selected = on ? [...selected, id] : selected.filter((x) => x !== id));
  const selectShown = (on: boolean) => {
    const shown = rows.map(({ rule }) => rule.id);
    selected = on ? [...new Set([...selected, ...shown])] : selected.filter((id) => !shown.includes(id));
  };

  const toggle = (id: number, on: boolean) => session.edit((c) => setRulesEnabled(c, [id], on));
  /** Spoken to screen readers after a move: the row is re-created in a new place, so the new position is announced. */
  let moved = $state('');

  async function step(id: number, delta: -1 | 1) {
    session.edit((c) => moveRule(c, id, delta));
    await tick();
    // The moved row is a new DOM node: put the keyboard focus back on the same action (or its neighbour at the end of the list).
    const row = document.querySelector(`[data-rule="${id}"]`);
    const pick = (act: string) => row?.querySelector<HTMLButtonElement>(`[data-act="${act}"]:not(:disabled)`);
    (pick(delta === 1 ? 'down' : 'up') ?? pick(delta === 1 ? 'up' : 'down') ?? pick('edit'))?.focus();
    const rule = cfg.rules.find((r) => r.id === id);
    if (rule) moved = T.row.moved(ruleLabel(rule), cfg.rules.indexOf(rule) + 1);
  }
  const bulkEnabled = (on: boolean) => session.edit((c) => setRulesEnabled(c, selected, on));
  const bulkEdge = (edge: 'top' | 'bottom') => session.edit((c) => moveToEdge(c, selected, edge));

  function remove() {
    const ids = confirming ?? [];
    confirming = null;
    session.edit((c) => void deleteRules(c, ids));
    selected = selected.filter((id) => !ids.includes(id));
    if (editor?.id != null && ids.includes(editor.id)) editor = null;
  }

  function drop(targetId: number) {
    const id = dragId;
    dragId = overId = null;
    if (id !== null && id !== targetId) session.edit((c) => moveRuleTo(c, id, targetId));
  }
</script>

<div class="page wide">
  <div class="page-head">
    <div class="stack">
      <h1>{T.title}</h1>
      <p class="muted">{T.intro}</p>
    </div>
    <button class="btn primary" type="button" onclick={() => (editor = { id: null })}><Icon name="plus" size={16} />{T.add}</button>
  </div>

  <div class="rules-layout">
    <section class="rules-col" aria-label={T.listLabel}>
      {#if cfg.rules.length === 0}
        <div class="card"><p><strong>{T.empty}</strong></p><p class="help">{T.emptyHelp}</p></div>
      {:else}
        <div class="rules-toolbar">
          <div class="search">
            <label class="sr-only" for="rule-search">{T.searchLabel}</label>
            <Icon name="search" size={16} />
            <input id="rule-search" class="input" type="search" autocomplete="off" placeholder={T.searchPlaceholder} bind:value={query} />
          </div>
          <label class="check"><input type="checkbox" checked={allShownSelected} onchange={(e) => selectShown(e.currentTarget.checked)} />{T.bulk.selectAll}</label>
        </div>
        {#if !canReorder}<p class="help" role="status">{T.orderLocked} {T.shown(rows.length, cfg.rules.length)}.</p>{/if}

        {#if selected.length > 0}
          <div class="bulk" role="toolbar" aria-label={T.bulk.label}>
            <span class="count" role="status">{T.bulk.selected(selected.length)}</span>
            <button class="btn small" type="button" onclick={() => bulkEnabled(true)}>{T.bulk.enable}</button>
            <button class="btn small" type="button" onclick={() => bulkEnabled(false)}>{T.bulk.disable}</button>
            <button class="btn small" type="button" disabled={!canReorder} onclick={() => bulkEdge('top')}><Icon name="top" size={16} />{T.bulk.top}</button>
            <button class="btn small" type="button" disabled={!canReorder} onclick={() => bulkEdge('bottom')}><Icon name="bottom" size={16} />{T.bulk.bottom}</button>
            <button class="btn small danger" type="button" onclick={() => (confirming = [...selected])}><Icon name="trash" size={16} />{T.bulk.remove}</button>
            <button class="btn small ghost" type="button" onclick={() => (selected = [])}>{T.bulk.clear}</button>
          </div>
        {/if}

        <p class="sr-only" role="status">{moved}</p>
        {#if rows.length === 0}
          <p class="muted" role="status">{T.noMatches}</p>
        {:else}
          <ol class="rules">
            {#each rows as { rule, pos } (rule.id)}
              {@const label = ruleLabel(rule)}
              {@const list = hints(rule)}
              <li
                class="rule-row"
                data-rule={rule.id}
                class:off={rule.enabled === false}
                data-over={overId === rule.id && dragId !== rule.id}
                data-editing={editor?.id === rule.id}
                data-draggable={canReorder}
                draggable={canReorder}
                ondragstart={(e) => {
                  dragId = rule.id;
                  e.dataTransfer?.setData('text/plain', String(rule.id));
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }}
                ondragover={(e) => {
                  if (dragId === null || !canReorder) return;
                  e.preventDefault();
                  overId = rule.id;
                }}
                ondragleave={() => void (overId === rule.id && (overId = null))}
                ondrop={(e) => (e.preventDefault(), drop(rule.id))}
                ondragend={() => (dragId = overId = null)}
              >
                <input type="checkbox" aria-label={T.row.select(label)} checked={selected.includes(rule.id)} onchange={(e) => select(rule.id, e.currentTarget.checked)} />
                <span class="grip" aria-hidden="true" title={T.row.drag}><Icon name="grip" size={16} /></span>
                <span class="rule-pos"><span class="num">{T.position(pos)}</span><span class="id">{T.idLabel(rule.id)}</span></span>
                <div class="rule-main">
                  <span class="rule-title">{rule.name ? `${rule.name}: ` : ''}{replyStart(rule.reply) || T.untitled}</span>
                  <span class="rule-sub">{describeConditions(rule)}</span>
                  <span class="rule-sub">{rule.channels.length ? T.scope(rule.channels.join(', ')) : T.scopeAll}{rule.enabled === false ? ` · ${T.row.off}` : ''}</span>
                  {#each list as h (h.text)}
                    <span class="warn-line" class:error={h.error}><Icon name="alert" size={14} />{h.text}</span>
                  {/each}
                </div>
                <div class="rule-actions">
                  <button type="button" role="switch" class="switch" aria-checked={rule.enabled !== false} aria-label={T.row.enabled(label)} onclick={() => toggle(rule.id, rule.enabled === false)}></button>
                  <button class="btn ghost small icon-only" type="button" data-act="up" aria-label={T.row.up(label)} disabled={!canReorder || pos === 1} onclick={() => step(rule.id, -1)}><Icon name="up" size={16} /></button>
                  <button class="btn ghost small icon-only" type="button" data-act="down" aria-label={T.row.down(label)} disabled={!canReorder || pos === cfg.rules.length} onclick={() => step(rule.id, 1)}><Icon name="down" size={16} /></button>
                  <button class="btn ghost small icon-only" type="button" data-act="edit" aria-label={T.row.edit(label)} onclick={() => (editor = { id: rule.id })}><Icon name="edit" size={16} /></button>
                  <button class="btn ghost small icon-only" type="button" aria-label={T.row.remove(label)} onclick={() => (confirming = [rule.id])}><Icon name="trash" size={16} /></button>
                </div>
              </li>
            {/each}
          </ol>
        {/if}
      {/if}
    </section>

    {#if editor}
      {#key editor.id ?? 'new'}
        <RuleEditor ruleId={editor.id} onclose={() => (editor = null)} />
      {/key}
    {:else}
      <div class="side-col"><RulePreview rules={cfg.rules} channels={cfg.channels} /></div>
    {/if}
  </div>
</div>

<Dialog open={confirming !== null} title={T.confirm.title(confirming?.length ?? 0)} onclose={() => (confirming = null)}>
  <p class="muted">{T.confirm.body}</p>
  {#snippet footer()}
    <button class="btn danger" type="button" onclick={remove}>{T.confirm.yes}</button>
    <button class="btn" type="button" onclick={() => (confirming = null)}>{T.confirm.cancel}</button>
  {/snippet}
</Dialog>
