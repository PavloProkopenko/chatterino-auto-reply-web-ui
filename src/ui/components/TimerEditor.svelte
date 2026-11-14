<script lang="ts">
  import { untrack } from 'svelte';
  import { ru } from '../../i18n/ru.ts';
  import type { Condition, Timer } from '../../shared/config.ts';
  import { lua } from '../lua.ts';
  import { session } from '../state/app.svelte.ts';
  import { checkCondition, suggestName } from '../state/rule-checks.ts';
  import { ruleLabel } from '../state/rule-text.ts';
  import { analyseTimers, elapsedExample, type TimerAnalysis } from '../state/timer-checks.ts';
  import { emptyTimer, saveTimer, TIMER_CATEGORY, type TimerDraft, type TimerFields } from '../state/timers.ts';
  import ChannelSelect from './ChannelSelect.svelte';
  import ConditionsEditor from './ConditionsEditor.svelte';
  import Icon from './Icon.svelte';
  import NameField from './NameField.svelte';
  import ReplyField from './ReplyField.svelte';
  import PreviewDialog from './PreviewDialog.svelte';
  import SkipOptions from './SkipOptions.svelte';

  let { timerId, onclose }: { timerId: number | null; onclose: () => void } = $props();
  const R = ru.rules.editor;
  const T = ru.timers.editor;
  const uid = $props.id();
  const NEW_ID = -1;

  const cfg = $derived(session.current!);
  const features = $derived(session.source!.features);

  const original = untrack(() => (timerId === null ? null : (cfg.timers.find((t) => t.id === timerId) ?? null)));
  const start: TimerFields = untrack(() => (original ? (structuredClone($state.snapshot(original)) as TimerFields) : emptyTimer(cfg.channels[0] ?? '')));

  let name = $state(start.name ?? '');
  let channel = $state(start.channel);
  let reply = $state(start.reply);
  let format = $state(start.format === 'full' ? 'full' : 'smart');
  let onCategory = $state(start.on_category === 'stop' || start.on_category === 'off' ? start.on_category : 'reset');
  let conditions = $state<Condition[]>(start.conditions.length ? structuredClone(start.conditions) : emptyTimer().conditions);
  let skipMode = $state<'follow' | 'yes' | 'no'>(start.skip_mods === true ? 'yes' : start.skip_mods === false ? 'no' : 'follow');
  let skipUsers = $state<string[]>([...(start.skip_users ?? [])]);
  let touched = $state(false);
  let previewOpen = $state(false);
  let analysis = $state.raw<TimerAnalysis | null>(null);
  let condErrors = $state.raw<(string | null)[]>([]);
  let examples = $state<string[]>([]);
  let formError = $state(false);

  const focusId = untrack(() => timerId ?? NEW_ID);

  function build(): TimerDraft {
    const base = original ? ({ ...($state.snapshot(original) as Timer) } as TimerDraft) : (emptyTimer() as TimerDraft);
    const out: TimerDraft = {
      ...base,
      channel,
      reply,
      format,
      on_category: onCategory,
      conditions: conditions.map((c) => {
        const { match: _m, ...rest } = $state.snapshot(c) as Condition;
        return c.type === 'mention' ? rest : { ...rest, match: c.match ?? '' };
      }) as Condition[],
    };
    const trimmed = name.trim();
    if (trimmed) out.name = trimmed;
    else delete out.name;
    if (skipMode === 'yes') out.skip_mods = true;
    else if (skipMode === 'no') out.skip_mods = false;
    else delete out.skip_mods;
    if (skipUsers.length) out.skip_users = [...skipUsers];
    else delete out.skip_users;
    return out;
  }

  // The timers as they would be with the draft applied: what the checks and the preview run on.
  const listWithDraft = $derived.by<Timer[]>(() => {
    const draft = { enabled: false, ...build(), id: focusId } as Timer;
    const timers = $state.snapshot(cfg.timers) as Timer[];
    return original ? timers.map((t) => (t.id === timerId ? draft : t)) : [...timers, draft];
  });
  const me = $derived(cfg.channels[0] ?? '');

  async function runChecks(): Promise<boolean> {
    const [all, errs] = await Promise.all([analyseTimers(lua, listWithDraft, me), Promise.all(conditions.map((c) => checkCondition(lua, c.type, c.match)))]);
    analysis = all.get(focusId) ?? null;
    condErrors = errs;
    return !analysis?.replyError && !analysis?.nameError && errs.every((e) => e === null);
  }

  $effect(() => {
    void listWithDraft;
    const timer = setTimeout(() => void runChecks().catch(() => undefined), 150);
    return () => clearTimeout(timer);
  });

  // The real `{time}` texts for this format (the plugin's own formatter).
  $effect(() => {
    const f = format;
    let cancelled = false;
    void Promise.all([0, 2100, 9300].map((s) => elapsedExample(lua, f, s))).then((r) => void (cancelled || (examples = r)), () => undefined);
    return () => {
      cancelled = true;
    };
  });

  const seen = (v: string | undefined | null): string | undefined => (touched && v ? v : undefined);
  const channelError = $derived(touched && !channel ? T.channelRequired : undefined);

  async function suggest() {
    const others = ($state.snapshot(cfg.timers) as Timer[]).filter((t) => t.id !== timerId);
    const s = await suggestName(lua, others, reply.replaceAll('{time}', ' '), 'timers');
    if (s) {
      name = s;
      touched = true;
    }
  }

  async function done() {
    touched = true;
    formError = false;
    const ok = await runChecks();
    if (!ok || !channel) {
      formError = true;
      return;
    }
    const draft = build();
    session.edit((c) => void saveTimer(c, draft));
    onclose();
  }

  const gated = (ok: boolean) => !ok;
  const needVersion = (v: string) => (features.versionKnown ? ru.notice.needsPlugin(v) : R.unknownVersion);
  const categoryLabel = { reset: T.catReset, stop: T.catStop, off: T.catOff } as Record<string, string>;
</script>

<div class="editor-page" role="region" aria-labelledby="{uid}-h">
  <form class="card editor" novalidate oninput={() => (touched = true)} onsubmit={(e) => (e.preventDefault(), void done())}>
    <div class="editor-head">
      <h2 id="{uid}-h">{original ? T.titleEdit(ruleLabel(original)) : T.titleNew}</h2>
      <button class="btn ghost small icon-only" type="button" aria-label={R.cancel} onclick={onclose}><Icon name="x" /></button>
    </div>
    {#if !original}<p class="help">{T.newOff}</p>{/if}

    <NameField {uid} bind:name error={seen(analysis?.nameError)} disabled={gated(features.names)} canSuggest={!!reply.replaceAll('{time}', '').trim()} onsuggest={() => void suggest()} note={gated(features.names) ? needVersion('0.2.1') : undefined} />

    <ChannelSelect {uid} bind:channel channels={cfg.channels} label={T.channel} help={T.channelHelp} none={T.channelNone} missing={T.channelMissing} error={channelError} />

    <ConditionsEditor {uid} bind:conditions errors={condErrors.map((e) => seen(e) ?? null)} />

    <ReplyField {uid} bind:reply error={seen(analysis?.replyError)} inserts={['{time}', '{user}']} help={T.replyHelp} />

    <fieldset>
      <legend>{T.format}</legend>
      {#each [['smart', T.formatSmart], ['full', T.formatFull]] as [v, label] (v)}
        <label class="choice-row"><input type="radio" name="{uid}-format" value={v} checked={format === v} onchange={() => (format = v as string)} />{label}</label>
      {/each}
      {#if examples.length}<p class="help" translate="no">{T.example(examples.join(' · '))}</p>{/if}
    </fieldset>

    <fieldset>
      <legend>{T.category}</legend>
      {#each TIMER_CATEGORY as v (v)}
        <label class="choice-row"><input type="radio" name="{uid}-cat" value={v} checked={onCategory === v} onchange={() => (onCategory = v)} />{categoryLabel[v]}</label>
      {/each}
      <p class="help">{T.catHelp}</p>
    </fieldset>

    <SkipOptions {uid} bind:mode={skipMode} bind:users={skipUsers} disabled={gated(features.skipUsers)} note={needVersion('0.5.0')} />

    {#if formError}<p class="error-text" role="alert"><Icon name="alert" size={14} />{R.fixFirst}</p>{/if}
    <div class="editor-foot">
      <button class="btn primary" type="submit">{R.done}</button>
      <button class="btn" type="button" onclick={onclose}>{R.cancel}</button>
      <button class="btn" type="button" onclick={() => (previewOpen = true)}>{ru.rules.preview.title}</button>
    </div>
  </form>

  <PreviewDialog open={previewOpen} onclose={() => (previewOpen = false)} rules={cfg.rules} timers={listWithDraft} channels={cfg.channels} focus={{ kind: 'timer', id: focusId }} focusConditions={conditions} />
</div>
