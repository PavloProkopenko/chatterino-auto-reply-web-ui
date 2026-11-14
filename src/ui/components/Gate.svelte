<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { nav, session } from '../state/app.svelte.ts';
  import { detectPlatform, pluginsDir } from '../state/place.ts';
  import Icon from './Icon.svelte';

  const platform = detectPlatform(navigator.userAgent + ' ' + (navigator.platform ?? ''));
  const where = pluginsDir(platform);
  const tip = $derived(platform === 'win' ? ru.welcome.tipWin : platform === 'mac' ? ru.welcome.tipMac : ru.welcome.tipOther);

  let copied = $state(false);
  async function copyPath() {
    try {
      await navigator.clipboard.writeText(where);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* the path is on screen and can be selected by hand */
    }
  }

  const showDirect = import.meta.env.DEV || import.meta.env.MODE === 'e2e';
  let showFile = $state(false);
  const problem = $derived(
    session.pickProblem === 'not-plugin' ? ru.welcome.notPlugin(session.pickedName ?? '') : session.pickProblem ? ru.welcome.problems[session.pickProblem] : null,
  );

  function filesFrom(e: Event & { currentTarget: HTMLInputElement }) {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = ''; // picking the same folder again must fire again
    if (files.length) void session.openFiles(files);
  }
</script>

<div class="gate">
  {#if session.phase === 'loading'}
    <p class="muted" role="status">{ru.loading}</p>

  {:else if session.phase === 'welcome'}
    <div class="panel">
      <h1>{ru.welcome.title}</h1>
      <p class="muted">{ru.welcome.intro}</p>

      {#if problem}<p class="error-text" role="alert"><Icon name="alert" size={14} />{problem}</p>{/if}

      <div class="stack">
        <label class="btn primary file-pick"><Icon name="folder" size={16} />{ru.welcome.openConfig}
          <input class="sr-only" type="file" accept=".json,application/json" onchange={filesFrom} />
        </label>
        <p class="help">{ru.welcome.openConfigHelp}</p>
      </div>
      <section class="stack" aria-labelledby="where">
        <h2 id="where">{ru.welcome.whereTitle}</h2>
        <div class="row">
          <code class="cmd mono" translate="no">{where}</code>
          <button class="btn small" type="button" onclick={copyPath}><Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? ru.welcome.copied : ru.welcome.copyPath}</button>
        </div>
        <p class="help">{tip}</p>
        <p class="help">{ru.welcome.folderNote}</p>
      </section>

      {#if showDirect}
        <!-- Chrome and Edge refuse the plugin's usual location, so customers never see this; it keeps the direct-access code testable. -->
        <section class="stack" aria-labelledby="other">
          <h2 id="other">{ru.welcome.otherWays}</h2>
          <label class="btn small file-pick"><Icon name="folder" size={16} />{ru.welcome.openFolderRead}
            <input class="sr-only" type="file" webkitdirectory onchange={filesFrom} />
          </label>
          {#if session.directAccess}
            <div class="file-actions">
              <button class="btn small" type="button" onclick={() => void session.pickFolder()}>{ru.welcome.pickFolder}</button>
              <button class="btn small" type="button" onclick={() => void session.pickFile()}>{ru.welcome.pickFile}</button>
            </div>
          {/if}
        </section>
      {/if}

      <div class="stack demo">
        <button class="btn" type="button" onclick={() => void session.startDemo()}>{ru.welcome.demo}</button>
        <p class="help">{ru.welcome.demoHelp}</p>
      </div>
      {#if !session.persistent}<p class="help">{ru.notice.notPersistent}</p>{/if}
    </div>

  {:else if session.phase === 'needs-permission'}
    <div class="panel">
      <h1>{ru.permission.title(session.remembered?.name ?? '')}</h1>
      <p class="muted">{ru.permission.body}</p>
      <div class="file-actions">
        <button class="btn primary" type="button" onclick={() => void session.grantAccess()}>{ru.permission.action}</button>
        <button class="btn" type="button" onclick={() => void session.leave()}>{ru.permission.other}</button>
      </div>
    </div>

  {:else if session.phase === 'missing'}
    <div class="panel">
      <h1>{ru.missing.title}</h1>
      <p class="muted">{ru.missing.body}</p>
      <div class="file-actions">
        <button class="btn primary" type="button" onclick={() => void session.createDefault()}>{ru.missing.create}</button>
        <button class="btn" type="button" onclick={() => void session.leave()}>{ru.permission.other}</button>
      </div>
    </div>

  {:else if session.phase === 'invalid'}
    <div class="panel" role="alert">
      <h1>{ru.invalid.title}</h1>
      <p class="muted">{ru.invalid.body}</p>
      <p><strong>{ru.invalid.error}:</strong> <span class="mono">{session.invalid?.error}</span></p>
      <div class="file-actions">
        <button class="btn small" type="button" aria-expanded={showFile} onclick={() => (showFile = !showFile)}>{ru.invalid.showFile}</button>
        <button class="btn small" type="button" onclick={() => (nav.historyOpen = true)}><Icon name="history" size={16} />{ru.invalid.history}</button>
        <button class="btn small" type="button" onclick={() => void session.leave()}>{ru.permission.other}</button>
      </div>
      {#if showFile}<pre class="file">{session.invalid?.text}</pre>{/if}
    </div>
  {/if}
</div>
