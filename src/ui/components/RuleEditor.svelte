<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { ru } from '../../i18n/ru.ts';
  import type { Condition, Rule } from '../../shared/config.ts';
  import { lua } from '../lua.ts';
  import { session, validateUser } from '../state/app.svelte.ts';
  import { analyseRules, checkCondition, suggestName, type RuleAnalysis } from '../state/rule-checks.ts';
  import { ruleLabel } from '../state/rule-text.ts';
  import { emptyRule, saveRule, type RuleDraft, type RuleFields } from '../state/rules.ts';
  import ChipList from './ChipList.svelte';
  import Icon from './Icon.svelte';
  import RulePreview from './RulePreview.svelte';

  let { ruleId, onclose }: { ruleId: number | null; onclose: () => void } = $props();
  const T = ru.rules.editor;
  const uid = $props.id();
  const NEW_ID = -1; // stands in for the id of a rule that has not been saved yet
  const MAX_REPLY = 500;
  const FLAGS = ['first', 'highlighted', 'reply', 'announcement', 'sub', 'cheer'];

  const cfg = $derived(session.current!);
  const features = $derived(session.source!.features);

  // The draft is a private copy: nothing reaches the config until "Готово", which is then one undo step.
  const original = untrack(() => (ruleId === null ? null : (cfg.rules.find((r) => r.id === ruleId) ?? null)));
  const start: RuleFields = untrack(() => (original ? (structuredClone($state.snapshot(original)) as RuleFields) : emptyRule()));

  let name = $state(start.name ?? '');
  let enabled = $state(start.enabled !== false);
  let reply = $state(start.reply);
  let channels = $state<string[]>([...start.channels]);
  let conditions = $state<Condition[]>(start.conditions.length ? structuredClone(start.conditions) : emptyRule().conditions);
  let skipMode = $state<'follow' | 'yes' | 'no'>(start.skip_mods === true ? 'yes' : start.skip_mods === false ? 'no' : 'follow');
  let skipUsers = $state<string[]>([...(start.skip_users ?? [])]);
  let showPattern = $state(untrack(() => conditions.some((c) => c.type === 'pattern')));
  let touched = $state(false);
  let replyEl = $state<HTMLTextAreaElement>();
  let analysis = $state.raw<RuleAnalysis | null>(null);
  let condErrors = $state.raw<(string | null)[]>([]);
  let formError = $state(false);

  const focusId = untrack(() => ruleId ?? NEW_ID);
  const bytes = $derived(new TextEncoder().encode(reply).length);

  function build(): RuleDraft {
    const base = original ? ({ ...($state.snapshot(original) as Rule) } as RuleDraft) : (emptyRule() as RuleDraft);
    const out: RuleDraft = {
      ...base,
      enabled,
      reply,
      channels: [...channels],
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

  // The list as it would be if the draft were applied: what the checks and the preview run on.
  const listWithDraft = $derived.by<Rule[]>(() => {
    const draft = { ...build(), id: focusId } as Rule;
    const rules = $state.snapshot(cfg.rules) as Rule[];
    return original ? rules.map((r) => (r.id === ruleId ? draft : r)) : [...rules, draft];
  });
  const me = $derived(cfg.channels[0] ?? '');

  async function runChecks(): Promise<boolean> {
    const list = listWithDraft;
    const [all, errs] = await Promise.all([analyseRules(lua, list, me), Promise.all(conditions.map((c) => checkCondition(lua, c.type, c.match)))]);
    analysis = all.get(focusId) ?? null;
    condErrors = errs;
    return !analysis?.replyError && !analysis?.nameError && errs.every((e) => e === null);
  }

  $effect(() => {
    void listWithDraft;
    const timer = setTimeout(() => void runChecks().catch(() => undefined), 150);
    return () => clearTimeout(timer);
  });

  const seen = (v: string | undefined | null): string | undefined => (touched && v ? v : undefined);

  function setType(c: Condition, type: string) {
    const was = c.type;
    c.type = type;
    if (type === 'mention') delete c.match;
    else if (type === 'flag') c.match = 'first';
    else if (was === 'mention' || was === 'flag' || c.match === undefined) c.match = '';
  }

  const addCondition = () => (conditions = [...conditions, { type: 'word', match: '' }]);
  const removeCondition = (i: number) => (conditions = conditions.filter((_, k) => k !== i));
  const toggleChannel = (c: string, on: boolean) => (channels = on ? [...channels, c] : channels.filter((x) => x !== c));
  const channelOptions = $derived([...cfg.channels, ...channels.filter((c) => !cfg.channels.some((k) => k.toLowerCase() === c.toLowerCase()))]);

  async function insertUser() {
    const el = replyEl;
    const from = el?.selectionStart ?? reply.length;
    const to = el?.selectionEnd ?? from;
    reply = reply.slice(0, from) + '{user}' + reply.slice(to);
    await tick();
    el?.focus();
    el?.setSelectionRange(from + 6, from + 6);
  }

  async function suggest() {
    const others = ($state.snapshot(cfg.rules) as Rule[]).filter((r) => r.id !== ruleId);
    const s = await suggestName(lua, others, reply);
    if (s) {
      name = s;
      touched = true;
    }
  }

  async function done() {
    touched = true;
    formError = false;
    if (!(await runChecks())) {
      formError = true;
      return;
    }
    const draft = build();
    session.edit((c) => void saveRule(c, draft));
    onclose();
  }

  const gated = (ok: boolean) => !ok;
  const needVersion = (v: string) => (features.versionKnown ? ru.notice.needsPlugin(v) : T.unknownVersion);
</script>

<div class="side-col" role="region" aria-labelledby="{uid}-h">
  <form class="card editor" novalidate oninput={() => (touched = true)} onsubmit={(e) => (e.preventDefault(), void done())}>
    <div class="editor-head">
      <h2 id="{uid}-h">{original ? T.titleEdit(ruleLabel(original)) : T.titleNew}</h2>
      <button class="btn ghost small icon-only" type="button" aria-label={T.cancel} onclick={onclose}><Icon name="x" /></button>
    </div>

    <div class="field">
      <label for="{uid}-name">{T.name}</label>
      <span class="help" id="{uid}-nameh">{T.nameHelp}</span>
      <div class="row-between">
        <input id="{uid}-name" class="input" type="text" autocomplete="off" aria-describedby="{uid}-nameh {uid}-namee" aria-invalid={seen(analysis?.nameError) ? 'true' : undefined} disabled={gated(features.names)} bind:value={name} />
        <button class="btn small" type="button" disabled={gated(features.names) || !reply.trim()} onclick={() => void suggest()}>{T.suggest}</button>
      </div>
      {#if gated(features.names)}<span class="help">{needVersion('0.2.1')}</span>{/if}
      <span id="{uid}-namee" class="error-text" role="alert">{#if seen(analysis?.nameError)}<Icon name="alert" size={14} />{analysis?.nameError}{/if}</span>
    </div>

    <fieldset class="stack">
      <legend>{T.conditions}</legend>
      <p class="help">{T.conditionsHelp}</p>
      {#each conditions as c, i (i)}
        {#if i > 0}<p class="cond-and">{T.and}</p>{/if}
        <div class="cond">
          <div class="cond-head">
            <label for="{uid}-t{i}">{T.type}</label>
            {#if conditions.length > 1}
              <button class="btn ghost small icon-only" type="button" aria-label={T.removeCondition(i + 1)} onclick={() => removeCondition(i)}><Icon name="trash" size={16} /></button>
            {/if}
          </div>
          <select id="{uid}-t{i}" class="input" value={c.type} aria-describedby="{uid}-th{i}" onchange={(e) => setType(c, e.currentTarget.value)}>
            {#each ['keyword', 'word', 'anyword', 'mention', 'flag'] as t (t)}<option value={t}>{ru.rules.types[t]?.label}</option>{/each}
            {#if showPattern || c.type === 'pattern'}<option value="pattern">{ru.rules.types.pattern?.label}</option>{/if}
          </select>
          <span class="help" id="{uid}-th{i}">{ru.rules.types[c.type]?.help}</span>
          {#if c.type === 'flag'}
            <label for="{uid}-m{i}">{T.flag}</label>
            <select id="{uid}-m{i}" class="input" value={c.match} onchange={(e) => (c.match = e.currentTarget.value)}>
              {#each FLAGS as f (f)}<option value={f}>{ru.rules.flags[f]}</option>{/each}
            </select>
          {:else if c.type !== 'mention'}
            <label for="{uid}-m{i}">{c.type === 'anyword' ? T.matchAny : c.type === 'pattern' ? T.matchPattern : T.match}</label>
            <input id="{uid}-m{i}" class="input" type="text" autocomplete="off" aria-invalid={seen(condErrors[i]) ? 'true' : undefined} aria-describedby="{uid}-me{i}" value={c.match ?? ''} oninput={(e) => (c.match = e.currentTarget.value)} />
          {/if}
          <span id="{uid}-me{i}" class="error-text" role="alert">{#if seen(condErrors[i])}<Icon name="alert" size={14} />{condErrors[i]}{/if}</span>
        </div>
      {/each}
      <div class="row-between">
        <button class="btn small" type="button" onclick={addCondition}><Icon name="plus" size={16} />{T.addCondition}</button>
        {#if !showPattern}<button class="btn ghost small" type="button" onclick={() => (showPattern = true)}>{T.advancedShow}</button>{/if}
      </div>
      {#if showPattern}<p class="help">{T.advancedHelp}</p>{/if}
    </fieldset>

    <div class="field">
      <label for="{uid}-reply">{T.reply}</label>
      <span class="help" id="{uid}-replyh">{T.replyHelp} {T.userHelp}</span>
      <textarea id="{uid}-reply" class="input" rows="3" bind:this={replyEl} bind:value={reply} aria-describedby="{uid}-replyh {uid}-replye" aria-invalid={seen(analysis?.replyError) ? 'true' : undefined}></textarea>
      <div class="row-between">
        <button class="btn small" type="button" onclick={() => void insertUser()}>{T.insertUser}</button>
        <span class="counter" class:over={bytes > MAX_REPLY}>{T.counter(bytes)}</span>
      </div>
      <span class="help">{T.replyBytes}</span>
      <span id="{uid}-replye" class="error-text" role="alert">{#if seen(analysis?.replyError)}<Icon name="alert" size={14} />{analysis?.replyError}{/if}</span>
    </div>

    <fieldset>
      <legend>{T.channels}</legend>
      <p class="help">{T.channelsHelp}</p>
      {#each channelOptions as c (c)}
        <label class="choice-row">
          <input type="checkbox" checked={channels.includes(c)} disabled={gated(features.ruleChannels)} onchange={(e) => toggleChannel(c, e.currentTarget.checked)} />
          <span translate="no">{c}</span>
          {#if !cfg.channels.some((k) => k.toLowerCase() === c.toLowerCase())}<span class="help">({T.channelMissing})</span>{/if}
        </label>
      {:else}
        <p class="help">{T.channelsNone}</p>
      {/each}
      {#if gated(features.ruleChannels)}<p class="help">{needVersion('0.3.0')}</p>{/if}
    </fieldset>

    <fieldset>
      <legend>{T.skip}</legend>
      {#if gated(features.skipUsers)}
        <p class="help">{needVersion('0.5.0')}</p>
      {:else}
        {#each [['follow', T.skipFollow], ['yes', T.skipYes], ['no', T.skipNo]] as [v, label] (v)}
          <label class="choice-row"><input type="radio" name="{uid}-skip" value={v} checked={skipMode === v} onchange={() => (skipMode = v as typeof skipMode)} />{label}</label>
        {/each}
        <ChipList label={T.skipUsers} help={T.skipUsersHelp} placeholder={T.skipUsersPlaceholder} items={skipUsers} validate={validateUser} onchange={(v) => (skipUsers = v)} />
      {/if}
    </fieldset>

    <div class="switch-row">
      <div class="text"><span class="label" id="{uid}-en">{T.enabled}</span></div>
      <button type="button" role="switch" class="switch" aria-checked={enabled} aria-labelledby="{uid}-en" onclick={() => (enabled = !enabled)}></button>
    </div>

    {#if formError}<p class="error-text" role="alert"><Icon name="alert" size={14} />{T.fixFirst}</p>{/if}
    <div class="editor-foot">
      <button class="btn primary" type="submit">{T.done}</button>
      <button class="btn" type="button" onclick={onclose}>{T.cancel}</button>
    </div>
  </form>

  <RulePreview rules={listWithDraft} channels={cfg.channels} {focusId} focusConditions={conditions} />
</div>
