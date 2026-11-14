<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { nav, session } from '../state/app.svelte.ts';
  import Icon from './Icon.svelte';

  let manual = $state('');
  let showFile = $state(false);
  const when = (ms: number | null) => (ms === null ? '' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(ms));
  const pickError = $derived(session.pickError ? (ru.picker.errors[session.pickError] ?? ru.picker.errorFallback) : null);
</script>

<div class="gate">
  {#if session.phase === 'loading'}
    <p class="muted" role="status">{ru.loading}</p>

  {:else if session.phase === 'offline'}
    <div class="panel" role="alert">
      <h1>{ru.notice.offline}</h1>
      <p class="muted">{ru.notice.offlineHelp}</p>
    </div>

  {:else if session.phase === 'unselected'}
    <div class="panel">
      <h1>{ru.picker.title}</h1>
      <p class="muted">{session.candidates.length ? ru.picker.intro : ru.picker.none}</p>
      <div class="stack">
        {#each session.candidates as c (c.configPath)}
          <div class="choice">
            <div class="meta">
              <strong>{c.appFolder}</strong>
              <span class="muted">{ru.picker.version(c.pluginVersion)}{c.configExists ? ` · ${ru.picker.modified} ${when(c.mtimeMs)}` : ` · ${ru.picker.noConfig}`}</span>
              {#if nav.showPath}<span class="path mono">{c.configPath}</span>{/if}
            </div>
            <button class="btn primary" type="button" onclick={() => void session.choose(c.configPath)}>{ru.picker.choose}</button>
          </div>
        {/each}
      </div>
      <button class="btn ghost small" type="button" aria-pressed={nav.showPath} onclick={() => (nav.showPath = !nav.showPath)}>
        <Icon name={nav.showPath ? 'eye-off' : 'eye'} size={16} />{nav.showPath ? ru.file.hide : ru.file.show}
      </button>
      <form class="field" onsubmit={(e) => { e.preventDefault(); void session.choose(manual.trim()); }}>
        <h2>{ru.picker.manualTitle}</h2>
        <label for="manual">{ru.picker.manualLabel}</label>
        <input id="manual" class="input mono" type="text" autocomplete="off" spellcheck="false" bind:value={manual} aria-invalid={pickError ? 'true' : 'false'} aria-describedby="manual-h" />
        <span class="help" id="manual-h">{ru.picker.manualHelp}</span>
        {#if pickError}<span class="error-text" role="alert"><Icon name="alert" size={14} />{pickError}</span>{/if}
        <div><button class="btn" type="submit" disabled={manual.trim() === ''}>{ru.picker.manualButton}</button></div>
      </form>
    </div>

  {:else if session.phase === 'missing'}
    <div class="panel">
      <h1>{ru.missing.title}</h1>
      <p class="muted">{ru.missing.body}</p>
      <div><button class="btn primary" type="button" onclick={() => void session.createDefault()}>{ru.missing.create}</button></div>
    </div>

  {:else if session.phase === 'invalid'}
    <div class="panel" role="alert">
      <h1>{ru.invalid.title}</h1>
      <p class="muted">{ru.invalid.body}</p>
      <p><strong>{ru.invalid.error}:</strong> <span class="mono">{session.invalid?.error}</span></p>
      <div class="file-actions">
        <button class="btn small" type="button" aria-expanded={showFile} onclick={() => (showFile = !showFile)}>{ru.invalid.showFile}</button>
        <button class="btn small" type="button" onclick={() => (nav.historyOpen = true)}><Icon name="history" size={16} />{ru.invalid.history}</button>
      </div>
      {#if showFile}<pre class="file">{session.invalid?.text}</pre>{/if}
    </div>
  {/if}
</div>
