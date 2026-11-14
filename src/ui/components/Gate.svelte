<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { nav, session } from '../state/app.svelte.ts';
  import { detectPlatform, pluginsDir } from '../state/place.ts';
  import { defaultSection, isSectionDisabled, problemSection, type SectionId } from '../state/welcome.ts';
  import Accordion, { type AccordionSection } from './Accordion.svelte';
  import Icon from './Icon.svelte';
  import PluginPanel from './PluginPanel.svelte';

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

  // Which section the last pick came from: its problem message is shown there, and that section opens.
  let pickSource = $state<'direct' | 'upload' | null>(null);
  let open = $state<string | null>(defaultSection(session.directAccess));
  $effect(() => {
    if (session.pickProblem) open = problemSection(pickSource);
  });
  $effect(() => {
    if (session.installTarget || session.installBlocked) open = 'install';
  });

  const sections: AccordionSection[] = $derived(
    (['direct', 'install', 'upload', 'demo'] as SectionId[]).map((id) => ({
      id,
      title: ru.welcome.sections[id].title,
      summary: ru.welcome.sections[id].summary,
      disabledReason: isSectionDisabled(id, session.directAccess) ? ru.welcome.sections.needsDirect : null,
    })),
  );
  const pickDirect = (run: () => Promise<void>) => {
    pickSource = 'direct';
    void run();
  };

  function filesFrom(e: Event & { currentTarget: HTMLInputElement }) {
    pickSource = 'upload';
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

      <Accordion {sections} bind:open>
        {#snippet children(id)}
          {#if id === 'direct'}
            {#if problem && problemSection(pickSource) === 'direct'}<p class="error-text" role="alert"><Icon name="alert" size={14} />{problem}</p>{/if}
            <p class="help">{ru.welcome.sections.direct.body}</p>
            {#if session.directAccess}
              <p class="help">{ru.welcome.directHelp}</p>
              <div class="file-actions">
                <button class="btn primary" type="button" onclick={() => pickDirect(session.pickFolder)}><Icon name="folder" size={16} />{ru.welcome.pickFolder}</button>
                <button class="btn" type="button" onclick={() => pickDirect(session.pickFile)}>{ru.welcome.pickFile}</button>
              </div>
            {/if}
          {:else if id === 'install'}
            {#if session.directAccess}
              {#if session.installTarget}
                <PluginPanel folder={session.installTarget.plugin} mode="install" onopen={() => void session.adoptInstallTarget()} />
                <button class="btn small" type="button" onclick={() => session.cancelInstall()}>{ru.plugin.cancel}</button>
              {:else}
                <p class="help">{ru.plugin.pickHelp}</p>
                {#if session.installBlocked}<p class="error-text" role="alert"><Icon name="alert" size={14} />{ru.plugin.pickBlocked}</p>{/if}
                <div class="file-actions"><button class="btn" type="button" onclick={() => void session.pickInstallFolder()}><Icon name="folder" size={16} />{ru.plugin.pick}</button></div>
              {/if}
            {/if}
          {:else if id === 'upload'}
            {#if problem && problemSection(pickSource) === 'upload'}<p class="error-text" role="alert"><Icon name="alert" size={14} />{problem}</p>{/if}
            <div class="stack">
              <label class="btn primary file-pick"><Icon name="folder" size={16} />{ru.welcome.openConfig}
                <input class="sr-only" type="file" accept=".json,application/json" onchange={filesFrom} />
              </label>
              <p class="help">{ru.welcome.openConfigHelp}</p>
            </div>
            <div class="stack" role="group" aria-labelledby="where">
              <h3 id="where">{ru.welcome.whereTitle}</h3>
              <div class="row">
                <code class="cmd mono" translate="no">{where}</code>
                <button class="btn small" type="button" onclick={copyPath}><Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? ru.welcome.copied : ru.welcome.copyPath}</button>
              </div>
              <p class="help">{tip}</p>
              <p class="help">{ru.welcome.folderNote}</p>
            </div>
            {#if showDirect}
              <!-- Chrome and Edge refuse the plugin's usual location, so customers never see this; it keeps the folder-reading code testable. -->
              <label class="btn small file-pick"><Icon name="folder" size={16} />{ru.welcome.openFolderRead}
                <input class="sr-only" type="file" webkitdirectory onchange={filesFrom} />
              </label>
            {/if}
          {:else if id === 'demo'}
            <div class="file-actions"><button class="btn" type="button" onclick={() => void session.startDemo()}>{ru.welcome.sections.demo.action}</button></div>
            <p class="help">{ru.welcome.demoHelp}</p>
          {/if}
        {/snippet}
      </Accordion>
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
