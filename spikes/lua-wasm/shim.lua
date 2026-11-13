-- Minimal c2 shim so the vendored pure modules load outside Chatterino.
c2 = {
  MessageFlag = { System = 1, RecentMessage = 2, Debug = 4, Timeout = 8, Untimeout = 16, Disabled = 32 },
  MessageElementFlag = {},
  LogLevel = { Info = 1, Warning = 2, Debug = 0, Critical = 3 },
  log = function() end,
  DateTime = { current_utc = function()
    return { to_unix_seconds = function() return 0 end, to_unix_milliseconds = function() return 0 end }
  end },
}
