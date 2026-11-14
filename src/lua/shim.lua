-- Minimal c2 shim so the plugin's pure modules load outside Chatterino.
-- Only what util/rules/names/config touch at load or validation time.
c2 = {
  -- The flag bits the plugin's rules look up (rules.FLAGS). Values are the shim's own: only consistency matters, because
  -- rules.flags_from_names builds the mask from the same table.
  MessageFlag = { System = 1, RecentMessage = 2, Debug = 4, Timeout = 8, Untimeout = 16, Disabled = 32, FirstMessage = 64, Highlighted = 128, ReplyMessage = 256, Announcement = 512, Subscription = 1024, CheerMessage = 2048 },
  MessageElementFlag = {},
  LogLevel = { Info = 1, Warning = 2, Debug = 0, Critical = 3 },
  log = function() end,
  DateTime = { current_utc = function()
    return { to_unix_seconds = function() return 0 end, to_unix_milliseconds = function() return 0 end }
  end },
}
