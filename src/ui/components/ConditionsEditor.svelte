<script lang="ts">
  import { untrack } from 'svelte';
  import { ru } from '../../i18n/ru.ts';
  import type { Condition } from '../../shared/config.ts';
  import Icon from './Icon.svelte';

  let { conditions = $bindable(), errors = [], uid, disabled = false, note, nowordOk = true, nowordNote, setError }: { conditions: Condition[]; errors?: (string | null)[]; uid: string; disabled?: boolean; note?: string; nowordOk?: boolean; nowordNote?: string; setError?: string } = $props();
  const T = ru.rules.editor;
  const FLAGS = ['first', 'highlighted', 'reply', 'announcement', 'sub', 'cheer'];
  let showPattern = $state(untrack(() => conditions.some((c) => c.type === 'pattern')));

  function setType(c: Condition, type: string) {
    const was = c.type;
    c.type = type;
    if (type === 'mention') delete c.match;
    else if (type === 'flag') c.match = 'first';
    else if (was === 'mention' || was === 'flag' || c.match === undefined) c.match = '';
  }
  const add = () => (conditions = [...conditions, { type: 'word', match: '' }]);
  const remove = (i: number) => (conditions = conditions.filter((_, k) => k !== i));
</script>

<fieldset class="stack" {disabled}>
  <legend>{T.conditions}</legend>
  <p class="help">{T.conditionsHelp}</p>
  {#if note}<p class="help">{note}</p>{/if}
  {#if !nowordOk && nowordNote}<p class="help">{nowordNote}</p>{/if}
  {#each conditions as c, i (i)}
    {#if i > 0}<p class="cond-and">{T.and}</p>{/if}
    <div class="cond">
      <div class="cond-head">
        <label for="{uid}-t{i}">{T.type}</label>
        {#if conditions.length > 1}
          <button class="btn ghost small icon-only" type="button" aria-label={T.removeCondition(i + 1)} onclick={() => remove(i)}><Icon name="trash" size={16} /></button>
        {/if}
      </div>
      <select id="{uid}-t{i}" class="input" value={c.type} aria-describedby="{uid}-th{i}" onchange={(e) => setType(c, e.currentTarget.value)}>
        {#each ['keyword', 'word', 'anyword', 'mention', 'flag'] as t (t)}<option value={t}>{ru.rules.types[t]?.label}</option>{/each}
        {#if nowordOk || c.type === 'noword'}<option value="noword">{ru.rules.types.noword?.label}</option>{/if}
        {#if showPattern || c.type === 'pattern'}<option value="pattern">{ru.rules.types.pattern?.label}</option>{/if}
      </select>
      <span class="help" id="{uid}-th{i}">{ru.rules.types[c.type]?.help}</span>
      {#if c.type === 'flag'}
        <label for="{uid}-m{i}">{T.flag}</label>
        <select id="{uid}-m{i}" class="input" value={c.match} onchange={(e) => (c.match = e.currentTarget.value)}>
          {#each FLAGS as f (f)}<option value={f}>{ru.rules.flags[f]}</option>{/each}
        </select>
      {:else if c.type !== 'mention'}
        <label for="{uid}-m{i}">{c.type === 'anyword' ? T.matchAny : c.type === 'noword' ? T.matchNo : c.type === 'pattern' ? T.matchPattern : T.match}</label>
        <input id="{uid}-m{i}" class="input" type="text" autocomplete="off" aria-invalid={errors[i] ? 'true' : undefined} aria-describedby="{uid}-me{i}" value={c.match ?? ''} oninput={(e) => (c.match = e.currentTarget.value)} />
      {/if}
      <span id="{uid}-me{i}" class="error-text" role="alert">{#if errors[i]}<Icon name="alert" size={14} />{errors[i]}{/if}</span>
    </div>
  {/each}
  {#if setError}<p class="error-text" role="alert"><Icon name="alert" size={14} />{setError}</p>{/if}
  <div class="row-between">
    <button class="btn small" type="button" onclick={add}><Icon name="plus" size={16} />{T.addCondition}</button>
    {#if !showPattern}<button class="btn ghost small" type="button" onclick={() => (showPattern = true)}>{T.advancedShow}</button>{/if}
  </div>
  {#if showPattern}<p class="help">{T.advancedHelp}</p>{/if}
</fieldset>
