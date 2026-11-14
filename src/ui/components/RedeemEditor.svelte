<script lang="ts">
  import { untrack } from 'svelte';
  import { ru } from '../../i18n/ru.ts';
  import type { Redeem } from '../../shared/config.ts';
  import { lua } from '../lua.ts';
  import { session } from '../state/app.svelte.ts';
  import { describeDuration, durationText, LONG_MUTE_SECONDS, QUICK_DURATIONS } from '../state/duration.ts';
  import { suggestName } from '../state/rule-checks.ts';
  import { ruleLabel } from '../state/rule-text.ts';
  import { emptyRedeem, saveRedeem, type RedeemDraft, type RedeemFields } from '../state/redeems.ts';
  import { analyseRedeems, parseDuration, type RedeemAnalysis } from '../state/timer-checks.ts';
  import ChannelSelect from './ChannelSelect.svelte';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';
  import NameField from './NameField.svelte';

  let { redeemId, onclose }: { redeemId: number | null; onclose: () => void } = $props();
  const R = ru.rules.editor;
  const T = ru.redeems.editor;
  const uid = $props.id();
  const NEW_ID = -1;

  const cfg = $derived(session.current!);
  const features = $derived(session.source!.features);

  const original = untrack(() => (redeemId === null ? null : (cfg.redeems.find((r) => r.id === redeemId) ?? null)));
  const start: RedeemFields = untrack(() => (original ? (structuredClone($state.snapshot(original)) as RedeemFields) : emptyRedeem(cfg.channels[0] ?? '')));

  let name = $state(start.name ?? '');
  let channel = $state(start.channel);
  let title = $state(start.title);
  let action = $state(start.action === 'untimeout' ? 'untimeout' : 'timeout');
  let durationInput = $state(typeof start.seconds === 'number' && start.seconds > 0 ? durationText(start.seconds) : '');
  let enabled = $state(start.enabled !== false);
  let touched = $state(false);
  let analysis = $state.raw<RedeemAnalysis | null>(null);
  let seconds = $state<number | null>(null);
  let formError = $state(false);
  let confirmLong = $state(false);

  const focusId = untrack(() => redeemId ?? NEW_ID);

  // The plugin's own parser reads the text; the readout in words comes from the number it returns.
  $effect(() => {
    const text = durationInput.trim();
    let cancelled = false;
    if (text === '') {
      seconds = null;
      return;
    }
    void parseDuration(lua, text).then((n) => void (cancelled || (seconds = n)), () => undefined);
    return () => {
      cancelled = true;
    };
  });

  function build(): RedeemDraft {
    const base = original ? ({ ...($state.snapshot(original) as Redeem) } as RedeemDraft) : (emptyRedeem() as RedeemDraft);
    const out: RedeemDraft = { ...base, channel, title: title.trim(), action, enabled };
    if (action === 'timeout') out.seconds = seconds ?? 0;
    else delete out.seconds;
    const trimmed = name.trim();
    if (trimmed) out.name = trimmed;
    else delete out.name;
    return out;
  }

  const listWithDraft = $derived.by<Redeem[]>(() => {
    const draft = { ...build(), id: focusId } as Redeem;
    const list = $state.snapshot(cfg.redeems) as Redeem[];
    return original ? list.map((r) => (r.id === redeemId ? draft : r)) : [...list, draft];
  });

  async function runChecks(): Promise<boolean> {
    const all = await analyseRedeems(lua, listWithDraft);
    analysis = all.get(focusId) ?? null;
    return !analysis?.titleError && !analysis?.duplicateOf && !analysis?.nameError && (action === 'untimeout' || !analysis?.secondsError);
  }

  $effect(() => {
    void listWithDraft;
    const handle = setTimeout(() => void runChecks().catch(() => undefined), 150);
    return () => clearTimeout(handle);
  });

  const seen = (v: string | undefined | null): string | undefined => (touched && v ? v : undefined);
  const channelError = $derived(touched && !channel ? T.channelRequired : undefined);
  const durationError = $derived.by(() => {
    if (action !== 'timeout' || !touched) return undefined;
    if (durationInput.trim() === '') return T.durationRequired;
    if (seconds === null) return T.durationBad;
    return analysis?.secondsError;
  });
  const label = (id: number) => {
    const r = cfg.redeems.find((x) => x.id === id);
    return r ? (r.name ? r.name : `«${r.title}»`) : `#${id}`;
  };
  const titleProblem = $derived(analysis?.titleError ?? (analysis?.duplicateOf !== undefined ? ru.redeems.warn.duplicate(label(analysis.duplicateOf)) : undefined));
  const shadow = $derived(analysis?.shadowedBy !== undefined ? ru.redeems.warn.shadowed(label(analysis.shadowedBy)) : undefined);

  async function suggest() {
    const others = ($state.snapshot(cfg.redeems) as Redeem[]).filter((r) => r.id !== redeemId);
    const s = await suggestName(lua, others, title, 'redeems');
    if (s) {
      name = s;
      touched = true;
    }
  }

  function save() {
    const draft = build();
    session.edit((c) => void saveRedeem(c, draft));
    onclose();
  }

  async function done() {
    touched = true;
    formError = false;
    const ok = await runChecks();
    if (!ok || !channel || (action === 'timeout' && seconds === null)) {
      formError = true;
      return;
    }
    if (action === 'timeout' && (seconds ?? 0) > LONG_MUTE_SECONDS) {
      confirmLong = true;
      return;
    }
    save();
  }

  const needVersion = (v: string) => (features.versionKnown ? ru.notice.needsPlugin(v) : R.unknownVersion);
</script>

<div class="editor-page" role="region" aria-labelledby="{uid}-h">
  <form class="card editor" novalidate oninput={() => (touched = true)} onsubmit={(e) => (e.preventDefault(), void done())}>
    <div class="editor-head">
      <h2 id="{uid}-h">{original ? T.titleEdit(original.name || `«${original.title}»`) : T.titleNew}</h2>
      <button class="btn ghost small icon-only" type="button" aria-label={R.cancel} onclick={onclose}><Icon name="x" /></button>
    </div>

    <ChannelSelect {uid} bind:channel channels={cfg.channels} label={T.channel} help={T.channelHelp} none={T.channelNone} missing={T.channelMissing} error={channelError} />

    <div class="field">
      <label for="{uid}-title">{T.title}</label>
      <span class="help" id="{uid}-titleh">{T.titleHelp}</span>
      <input id="{uid}-title" class="input" type="text" autocomplete="off" bind:value={title} aria-describedby="{uid}-titleh {uid}-titlee" aria-invalid={seen(titleProblem) ? 'true' : undefined} />
      <span id="{uid}-titlee" class="error-text" role="alert">{#if seen(titleProblem)}<Icon name="alert" size={14} />{titleProblem}{/if}</span>
      {#if shadow}<span class="warn-line"><Icon name="alert" size={14} />{shadow}</span>{/if}
    </div>

    <fieldset>
      <legend>{T.action}</legend>
      {#each [['timeout', T.actionTimeout], ['untimeout', T.actionUntimeout]] as [v, text] (v)}
        <label class="choice-row"><input type="radio" name="{uid}-action" value={v} checked={action === v} onchange={() => (action = v as string)} />{text}</label>
      {/each}
    </fieldset>
    {#if action === 'timeout'}
      <div class="field">
        <label for="{uid}-dur">{T.duration}</label>
        <span class="help" id="{uid}-durh">{T.durationHelp}</span>
        <input id="{uid}-dur" class="input" type="text" autocomplete="off" bind:value={durationInput} aria-describedby="{uid}-durh {uid}-durr {uid}-dure" aria-invalid={durationError ? 'true' : undefined} />
        <span id="{uid}-durr" class="help" aria-live="polite">{#if seconds !== null}{T.durationIs(describeDuration(seconds))}{/if}</span>
        <span class="file-actions" role="group" aria-label={T.durationQuick}>
          {#each QUICK_DURATIONS as q (q.seconds)}<button class="btn small" type="button" onclick={() => ((durationInput = durationText(q.seconds)), (touched = true))}>{q.label}</button>{/each}
        </span>
        <span id="{uid}-dure" class="error-text" role="alert">{#if durationError}<Icon name="alert" size={14} />{durationError}{/if}</span>
      </div>
    {/if}

    <NameField {uid} bind:name error={seen(analysis?.nameError)} disabled={!features.names} canSuggest={!!title.trim()} onsuggest={() => void suggest()} note={!features.names ? needVersion('0.2.1') : undefined} />

    <div class="switch-row">
      <div class="text"><span class="label" id="{uid}-en">{T.enabled}</span></div>
      <button type="button" role="switch" class="switch" aria-checked={enabled} aria-labelledby="{uid}-en" onclick={() => (enabled = !enabled)}></button>
    </div>

    {#if formError}<p class="error-text" role="alert"><Icon name="alert" size={14} />{R.fixFirst}</p>{/if}
    <div class="editor-foot">
      <button class="btn primary" type="submit">{R.done}</button>
      <button class="btn" type="button" onclick={onclose}>{R.cancel}</button>
    </div>
  </form>
</div>

<Dialog open={confirmLong} title={T.longTitle} onclose={() => (confirmLong = false)}>
  <p class="muted">{T.longBody(describeDuration(seconds ?? 0))}</p>
  {#snippet footer()}
    <button class="btn primary" type="button" onclick={() => ((confirmLong = false), save())}>{T.longYes}</button>
    <button class="btn" type="button" onclick={() => (confirmLong = false)}>{T.longNo}</button>
  {/snippet}
</Dialog>
