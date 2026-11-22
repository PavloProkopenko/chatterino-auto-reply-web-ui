<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { SCOPE_MODERATED_CHANNELS } from '../../shared/twitch.ts';
  import { session, twitch } from '../state/app.svelte.ts';
  import type { TwitchError } from '../state/twitch.svelte.ts';
  import Icon from './Icon.svelte';
  import Switch from './Switch.svelte';

  const T = ru.settings.twitch;
  const cfg = $derived(session.current!);
  const features = $derived(session.source?.features);
  // an older plugin has no Twitch API at all: only the (sidebar) Update button helps
  const supported = $derived(features?.helix === true);

  let copied = $state(false);
  let loggedInNow = $state(false); // a login made in this visit: show the "save changes" hint

  function errorText(e: TwitchError): string {
    switch (e.kind) {
      case 'failed': return T.errors.failed(e.message);
      default: return T.errors[e.kind];
    }
  }

  async function doLogin() {
    loggedInNow = false;
    await twitch.login();
    loggedInNow = twitch.loggedIn && twitch.error === null;
  }
  async function doLogout() {
    loggedInNow = false;
    await twitch.logout();
  }
  async function copyCode() {
    const code = twitch.code?.userCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* the code is on screen and can be selected by hand */
    }
  }
</script>

<section class="card" aria-labelledby="st-twitch">
  <h2 id="st-twitch">{T.title}</h2>
  <p class="help">{T.intro}</p>

  {#if !supported}
    <p class="help">{ru.notice.needsPlugin('0.8.0')}</p>
  {:else}
    <p class="status-line" data-testid="twitch-status">
      {#if twitch.status === null}
        <span class="muted">{T.checking}</span>
      {:else if twitch.status.loggedIn}
        <span class="dot on"></span><strong>{T.loggedIn(twitch.status.login ?? '?')}</strong>
      {:else}
        <span class="dot"></span><strong>{T.loggedOut}</strong>
      {/if}
    </p>

    {#if twitch.status?.loggedIn && !twitch.status.scopes.includes(SCOPE_MODERATED_CHANNELS)}
      <p class="help" data-testid="twitch-relogin"><Icon name="alert" size={14} />{T.reloginHint}</p>
    {/if}

    {#if twitch.phase === 'waiting' && twitch.code}
      <div class="stack" data-testid="twitch-code">
        <p class="help" role="status">{T.waiting}</p>
        <span class="label">{T.codeLabel}</span>
        <span class="device-code" translate="no">{twitch.code.userCode}</span>
        <div class="file-actions">
          <a class="btn primary" href={twitch.code.verificationUri} target="_blank" rel="noopener noreferrer">{T.openPage}</a>
          <button class="btn" type="button" onclick={() => void copyCode()}><Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? T.copied : T.copyCode}</button>
          <button class="btn ghost" type="button" onclick={() => twitch.cancel()}>{T.cancel}</button>
        </div>
      </div>
    {:else}
      <div class="file-actions">
        {#if twitch.loggedIn}
          <button class="btn" type="button" disabled={twitch.busy} onclick={() => void doLogout()}>{twitch.phase === 'loggingOut' ? T.loggingOut : T.logout}</button>
        {:else}
          <button class="btn primary" type="button" disabled={twitch.busy || twitch.status === null} onclick={() => void doLogin()}>{twitch.phase === 'starting' || twitch.phase === 'saving' ? T.starting : T.login}</button>
        {/if}
      </div>
    {/if}

    {#if twitch.error}
      <p class="error-text" role="alert"><Icon name="alert" size={14} />{errorText(twitch.error)}</p>
    {/if}
    {#if loggedInNow && twitch.loggedIn}
      <p class="help" role="status">{T.loginDone}</p>
      {#if !features?.helixSync}<p class="help">{T.restartHint}</p>{/if}
    {/if}

    <p class="help">{T.modNote}</p>
    <Switch label={T.enable} help={T.enableHelp} checked={cfg.helix_enabled} onchange={(v) => session.edit((c) => (c.helix_enabled = v))} />
  {/if}
</section>
