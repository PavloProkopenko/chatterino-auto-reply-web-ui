-- Shared by the system lua run and the wasmoon run. Expects global CASES_SRC (Lua table text).
local rules = require("rules")
local cases = assert(load("return " .. CASES_SRC))()
local out = {}
for i, c in ipairs(cases) do
  local ok = rules.matches_one({ type = c[1], match = c[2] }, c[3], 0, "inflame_dt")
  out[#out + 1] = i .. ":" .. ((ok and true or false) and "1" or "0") .. ":" .. ((c[4] and true or false) and "1" or "0")
end
return table.concat(out, "\n")
