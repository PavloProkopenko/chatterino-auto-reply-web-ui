-- Glue between JS and the plugin modules. Everything crosses the boundary as JSON strings, so no wasmoon
-- table conversion is involved. Needs shim.lua, json.lua (as "chatterino.json") and the plugin modules.
local json = require("chatterino.json")

-- __call(module, function, payload) where payload = {"n": <arg count>, "a": {"1": ..., "2": ...}}
-- returns {"n": <result count>, "r": {"1": ..., ...}} as a JSON string
function __call(mod, fn, payload)
  local p = json.parse(payload)
  local args = {}
  for i = 1, p.n do args[i] = p.a[tostring(i)] end
  local res = table.pack(require(mod)[fn](table.unpack(args, 1, p.n)))
  local out = {}
  for i = 1, res.n do out[tostring(i)] = res[i] end
  return json.stringify({ n = res.n, r = out })
end

-- __sanitise(raw): run the plugin's own config.load() on `raw` in the virtual file system.
-- returns {"config": ..., "warning": string|null, "bad": string|null}
function __sanitise(raw)
  os.remove("config.json.bad")
  local f = assert(io.open("config.json", "w"))
  f:write(raw)
  f:close()
  local cfg, warning = require("config").load()
  local bad
  local bf = io.open("config.json.bad", "r")
  if bf then bad = bf:read("a"); bf:close() end
  os.remove("config.json"); os.remove("config.json.bad")
  return json.stringify({ config = cfg, warning = warning, bad = bad })
end
