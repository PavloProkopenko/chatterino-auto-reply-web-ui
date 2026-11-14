<script lang="ts">
  import { untrack } from 'svelte';
  import { ru } from '../../i18n/ru.ts';
  import type { Condition, Rule } from '../../shared/config.ts';
  import { lua } from '../lua.ts';
  import { session } from '../state/app.svelte.ts';
  import { analyseRules, checkCondition, suggestName, type RuleAnalysis } from '../state/rule-checks.ts';
  import { ruleLabel } from '../state/rule-text.ts';
  import { emptyRule, saveRule, type RuleDraft, type RuleFields } from '../state/rules.ts';
  import ConditionsEditor from './ConditionsEditor.svelte';
  import Icon from './Icon.svelte';
  import NameField from './NameField.svelte';
  import ReplyField from './ReplyField.svelte';
  import PreviewDialog from './PreviewDialog.svelte';
  import SkipOptions from './SkipOptions.svelte';

  let { ruleId, onclose }: { ruleId: number | null; onclose: () => void } = $props();
  const T = ru.rules.editor;
  const uid = $props.id();
  const NEW_ID = -1; // stands in for the id of a rule that has not been saved yet

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
  let touched = $state(false);
  let previewOpen = $state(false);
  let analysis = $state.raw<RuleAnalysis | null>(null);
  let condErrors = $state.raw<(string | null)[]>([]);
  let formError = $state(false);

  const focusId = untrack(() => ruleId ?? NEW_ID);

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
  const toggleChannel = (c: string, on: boolean) => (channels = on ? [...channels, c] : channels.filter((x) => x !== c));
  const channelOptions = $derived([...cfg.channels, ...channels.filter((c) => !cfg.channels.some((k) => k.toLowerCase() === c.toLowerCase()))]);

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

<div class="editor-page" role="region" aria-labelledby="{uid}-h">
  <form class="card editor" novalidate oninput={() => (touched = true)} onsubmit={(e) => (e.preventDefault(), void done())}>
    <div class="editor-head">
      <h2 id="{uid}-h">{original ? T.titleEdit(ruleLabel(original)) : T.titleNew}</h2>
      <button class="btn ghost small icon-only" type="button" aria-label={T.cancel} onclick={onclose}><Icon name="x" /></button>
    </div>

    <NameField {uid} bind:name error={seen(analysis?.nameError)} disabled={gated(features.names)} canSuggest={!!reply.trim()} onsuggest={() => void suggest()} note={gated(features.names) ? needVersion('0.2.1') : undefined} />

    <ConditionsEditor {uid} bind:conditions errors={condErrors.map((e) => seen(e) ?? null)} />

    <ReplyField {uid} bind:reply error={seen(analysis?.replyError)} />

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

    <SkipOptions {uid} bind:mode={skipMode} bind:users={skipUsers} disabled={gated(features.skipUsers)} note={needVersion('0.5.0')} />

    <div class="switch-row">
      <div class="text"><span class="label" id="{uid}-en">{T.enabled}</span></div>
      <button type="button" role="switch" class="switch" aria-checked={enabled} aria-labelledby="{uid}-en" onclick={() => (enabled = !enabled)}></button>
    </div>

    {#if formError}<p class="error-text" role="alert"><Icon name="alert" size={14} />{T.fixFirst}</p>{/if}
    <div class="editor-foot">
      <button class="btn primary" type="submit">{T.done}</button>
      <button class="btn" type="button" onclick={onclose}>{T.cancel}</button>
      <button class="btn" type="button" onclick={() => (previewOpen = true)}>{ru.rules.preview.title}</button>
    </div>
  </form>

  <PreviewDialog open={previewOpen} onclose={() => (previewOpen = false)} rules={listWithDraft} timers={cfg.timers} channels={cfg.channels} focus={{ kind: 'rule', id: focusId }} focusConditions={conditions} />
</div>
