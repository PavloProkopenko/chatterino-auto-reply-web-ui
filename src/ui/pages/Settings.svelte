<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import ChipList from '../components/ChipList.svelte';
  import NumberField from '../components/NumberField.svelte';
  import PluginPanel from '../components/PluginPanel.svelte';
  import ProtectedUsers from '../components/ProtectedUsers.svelte';
  import TwitchCard from '../components/TwitchCard.svelte';
  import Switch from '../components/Switch.svelte';
  import { session, validateChannel, validateUser } from '../state/app.svelte.ts';
  import { checkSeconds } from '../state/validators.ts';

  // Ranges as enforced by `/autoreply set` in the plugin (UI limit, see validators.ts).
  const MAX_SECONDS = 86400;
  type SecondsKey = 'per_user_cooldown' | 'per_rule_cooldown' | 'global_min_gap';
  type SwitchKey = 'only_when_live' | 'skip_mods' | 'mute_lurkers' | 'backfire';
  type ListKey = 'channels' | 'ignore_users' | 'protect_users';

  const cfg = $derived(session.current!);
  const features = $derived(session.source?.features);
  const P = ru.settings.protect;
  // the channel whose mods and VIPs are shown in the protection card (kept valid when the channel list changes)
  let picked = $state('');
  const protectChannel = $derived(cfg.channels.includes(picked) ? picked : (cfg.channels[0] ?? ''));

  function setSeconds(key: SecondsKey, min: number, text: string) {
    const r = checkSeconds(text, min, MAX_SECONDS);
    if (!r.ok) return session.setFieldError(key, r.error);
    session.setFieldError(key, null);
    session.edit((c) => (c[key] = r.value), key);
  }
  const setSwitch = (key: SwitchKey, v: boolean) => session.edit((c) => (c[key] = v));
  const setList = (key: ListKey, items: string[]) => session.edit((c) => (c[key] = items));

  const status = $derived.by(() => {
    const until = cfg.active_until;
    if (until === 'forever') return { on: true, text: ru.settings.status.forever };
    if (typeof until === 'number' && until * 1000 > Date.now()) {
      return { on: true, text: ru.settings.status.until(new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(until * 1000)) };
    }
    return { on: false, text: ru.settings.status.off };
  });
</script>

<div class="page">
  <h1>{ru.settings.title}</h1>

  <section class="card" aria-labelledby="st-status">
    <h2 id="st-status">{ru.settings.status.label}</h2>
    <p class="status-line"><span class="dot" class:on={status.on}></span><strong>{status.text}</strong></p>
    <p class="help">{ru.settings.status.note}</p>
  </section>

  <section class="card" aria-labelledby="st-pace">
    <h2 id="st-pace">{ru.settings.pace.title}</h2>
    <NumberField label={ru.settings.pace.perUser} help={ru.settings.pace.perUserHelp} value={cfg.per_user_cooldown} min={0} max={MAX_SECONDS} unit={ru.settings.pace.seconds} error={session.fieldErrors.per_user_cooldown ?? null} oninput={(t) => setSeconds('per_user_cooldown', 0, t)} />
    <NumberField label={ru.settings.pace.perRule} help={ru.settings.pace.perRuleHelp} value={cfg.per_rule_cooldown} min={0} max={MAX_SECONDS} unit={ru.settings.pace.seconds} error={session.fieldErrors.per_rule_cooldown ?? null} oninput={(t) => setSeconds('per_rule_cooldown', 0, t)} />
    <NumberField label={ru.settings.pace.gap} help={ru.settings.pace.gapHelp} value={cfg.global_min_gap} min={1} max={MAX_SECONDS} unit={ru.settings.pace.seconds} error={session.fieldErrors.global_min_gap ?? null} oninput={(t) => setSeconds('global_min_gap', 1, t)} />
  </section>

  <section class="card" aria-labelledby="st-when">
    <h2 id="st-when">{ru.settings.when.title}</h2>
    <Switch label={ru.settings.when.live} help={ru.settings.when.liveHelp} checked={cfg.only_when_live} onchange={(v) => setSwitch('only_when_live', v)} />
    <Switch
      label={ru.settings.when.skipMods}
      help={ru.settings.when.skipModsHelp}
      checked={cfg.skip_mods}
      disabled={features !== undefined && features.versionKnown && !features.skipUsers}
      note={features && features.versionKnown && !features.skipUsers ? ru.notice.needsPlugin('0.5.0') : undefined}
      onchange={(v) => setSwitch('skip_mods', v)}
    />
  </section>

  <section class="card" aria-labelledby="st-lists">
    <h2 id="st-lists">{ru.settings.lists.title}</h2>
    <ChipList label={ru.settings.lists.channels} help={ru.settings.lists.channelsHelp} placeholder={ru.settings.lists.channelsPlaceholder} items={cfg.channels} validate={validateChannel} onchange={(v) => setList('channels', v)} />
    <ChipList label={ru.settings.lists.ignore} help={ru.settings.lists.ignoreHelp} placeholder={ru.settings.lists.usersPlaceholder} items={cfg.ignore_users} validate={validateUser} onchange={(v) => setList('ignore_users', v)} />
  </section>

  <section class="card" aria-labelledby="st-redeems">
    <h2 id="st-redeems">{ru.settings.redeems.title}</h2>
    <p class="help">{ru.settings.redeems.needsMod}</p>
    <Switch label={ru.settings.redeems.muteLurkers} help={ru.settings.redeems.muteLurkersHelp} checked={cfg.mute_lurkers} onchange={(v) => setSwitch('mute_lurkers', v)} />
    <Switch label={ru.settings.redeems.backfire} help={ru.settings.redeems.backfireHelp} checked={cfg.backfire} onchange={(v) => setSwitch('backfire', v)} />
    <ChipList label={ru.settings.lists.protect} help={ru.settings.lists.protectHelp} placeholder={ru.settings.lists.usersPlaceholder} items={cfg.protect_users} validate={validateUser} onchange={(v) => setList('protect_users', v)} />
  </section>

  <section class="card" aria-labelledby="st-protect">
    <h2 id="st-protect">{P.title}</h2>
    <p class="help">{P.intro}</p>
    {#if cfg.channels.length === 0}
      <p class="help">{P.noChannels}</p>
    {:else}
      <div class="field">
        <label for="st-protect-ch">{P.channelLabel}</label>
        <select id="st-protect-ch" class="input" value={protectChannel} onchange={(e) => (picked = e.currentTarget.value)}>
          {#each cfg.channels as c (c)}<option value={c}>{c}</option>{/each}
        </select>
      </div>
      <ProtectedUsers channel={protectChannel} />
    {/if}
  </section>

  {#if session.pluginFolder}
    <TwitchCard />
    <PluginPanel folder={session.pluginFolder} mode="settings" onchanged={() => session.refreshPluginInfo()} />
  {/if}
</div>
