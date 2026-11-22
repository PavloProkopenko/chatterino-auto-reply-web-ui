<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { protectFetch, session, twitch, validateUser } from '../state/app.svelte.ts';
  import type { ListKind, ProtectFetchError } from '../state/protect-fetch.svelte.ts';
  import { rows, setAll, setProtected } from '../state/protect-model.ts';
  import ChipList from './ChipList.svelte';
  import Icon from './Icon.svelte';

  // The mods and VIPs of one channel as two separate dropdowns. A switch is ON when the person is protected from
  // being muted by a reward and OFF when they may be muted; the lists live in `protect_users` / `unprotect_users`.
  let { channel, showExceptions = true }: { channel: string; showExceptions?: boolean } = $props();

  const T = ru.settings.protect;
  const uid = $props.id();

  const cfg = $derived(session.current!);
  const features = $derived(session.source?.features);
  // turning someone OFF needs the plugin's mute exceptions (0.9.0): an older plugin would keep protecting them
  const canOff = $derived(features?.protectOverride === true);
  const account = $derived(twitch.status?.login ?? null);
  // the owner of the channel and the account itself can never be muted
  const always = $derived([channel, account ?? ''].filter((l) => l !== ''));

  // why "Загрузить с Twitch" is not available (null: it is)
  const reason = $derived.by(() => {
    if (!channel) return T.reasons.noChannel;
    if (!session.pluginFolder) return T.reasons.noFolder;
    if (!twitch.status?.loggedIn) return T.reasons.notLoggedIn;
    if (channel.toLowerCase() !== account) return T.reasons.notOwner(channel);
    return null;
  });

  const kinds: { kind: ListKind; title: string; command: string }[] = [
    { kind: 'mods', title: T.mods, command: '/mods' },
    { kind: 'vips', title: T.vips, command: '/vips' },
  ];

  let pasted = $state<Record<ListKind, string>>({ mods: '', vips: '' });
  let pasteNote = $state<Record<ListKind, string>>({ mods: '', vips: '' });

  function errorText(e: ProtectFetchError): string {
    switch (e.kind) {
      case 'notLoggedIn': return T.reasons.notLoggedIn;
      case 'other': return T.errors.other(e.message);
      default: return T.errors[e.kind];
    }
  }

  function applyPaste(kind: ListKind) {
    const n = protectFetch.paste(channel, kind, pasted[kind]);
    pasteNote[kind] = n === 0 ? T.pasteNone : T.pasted(n);
    if (n > 0) pasted[kind] = '';
  }

  // exceptions typed by hand: a new one also stops being protected; removing one only forgets the exception
  function setExceptions(items: string[]) {
    session.edit((c) => {
      for (const login of items) if (!c.unprotect_users.includes(login)) setProtected(c, login, false, always);
      c.unprotect_users = c.unprotect_users.filter((l) => items.includes(l));
    });
  }
</script>

<div class="stack protect-users" data-testid="protect-users">
  {#if !canOff}<p class="help">{T.needsPlugin}</p>{/if}
  {#each kinds as k (k.kind)}
    {@const entry = protectFetch.entry(channel, k.kind)}
    {@const list = rows(entry.logins, cfg, always)}
    <details class="protect-group" data-kind={k.kind}>
      <summary><strong>{k.title}</strong> <span class="muted">({T.count(list.length)})</span></summary>
      <div class="stack">
        <div class="file-actions">
          <button class="btn small" type="button" disabled={reason !== null || entry.status === 'loading'} aria-describedby={reason ? `${uid}-${k.kind}-why` : undefined} onclick={() => void protectFetch.fetch(channel, k.kind)}>
            <Icon name="refresh" size={16} />{entry.status === 'loading' ? T.fetching : T.fetch}
          </button>
          {#if list.length > 0}
            <button class="btn small" type="button" onclick={() => session.edit((c) => setAll(c, list.map((r) => r.login), true, always))}>{T.allOn}</button>
            <button class="btn small" type="button" disabled={!canOff} onclick={() => session.edit((c) => setAll(c, list.map((r) => r.login), false, always))}>{T.allOff}</button>
          {/if}
        </div>
        {#if reason}<p class="help" id="{uid}-{k.kind}-why">{reason}</p>{/if}
        {#if entry.error}<p class="error-text" role="alert"><Icon name="alert" size={14} />{errorText(entry.error)}</p>{/if}
        {#if entry.status === 'loaded' && list.length === 0}<p class="help">{T.empty}</p>{/if}
        {#if list.length > 0}
          <ul class="protect-rows" aria-label={k.title}>
            {#each list as r (r.login)}
              <li>
                <span class="login" translate="no">{r.login}</span>
                <button type="button" role="switch" class="switch" aria-checked={r.enabled} aria-label={T.rowLabel(r.login)} disabled={r.locked || (r.enabled && !canOff)} onclick={() => session.edit((c) => setProtected(c, r.login, !r.enabled, always))}></button>
              </li>
            {/each}
          </ul>
        {/if}
        <details class="protect-paste">
          <summary>{T.pasteSummary}</summary>
          <div class="stack">
            <p class="help">{T.pasteHelp(k.command)}</p>
            <label class="sr-only" for="{uid}-{k.kind}-paste">{T.pasteSummary}</label>
            <textarea id="{uid}-{k.kind}-paste" class="input" rows="3" placeholder={T.pastePlaceholder} bind:value={pasted[k.kind]}></textarea>
            <div class="file-actions"><button class="btn small" type="button" disabled={pasted[k.kind].trim() === ''} onclick={() => applyPaste(k.kind)}>{T.pasteApply}</button></div>
            <p class="help" role="status">{pasteNote[k.kind]}</p>
          </div>
        </details>
      </div>
    </details>
  {/each}
  {#if showExceptions && canOff}
    <ChipList label={T.unprotectLabel} help={T.unprotectHelp} placeholder={ru.settings.lists.usersPlaceholder} items={cfg.unprotect_users} validate={validateUser} onchange={setExceptions} />
  {/if}
</div>
