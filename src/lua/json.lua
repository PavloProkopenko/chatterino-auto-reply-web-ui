-- Stand-in for Chatterino's `chatterino.json`. parse() accepts `[]` and `{}` as empty tables (like the plugin
-- sees them); stringify() writes an empty table as `{}` (the plugin's serializer quirk) and sorts object keys.
local J = {}

local function fail(msg, pos) error("json: " .. msg .. " at " .. tostring(pos), 0) end

local function skip(s, i) return s:find("[^ \t\r\n]", i) or #s + 1 end

local parse_value

local function parse_string(s, i)
  local out, j = {}, i + 1
  while true do
    local c = s:sub(j, j)
    if c == "" then fail("unterminated string", i) end
    if c == '"' then return table.concat(out), j + 1 end
    if c == "\\" then
      local e = s:sub(j + 1, j + 1)
      local map = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
      if map[e] then out[#out + 1] = map[e]; j = j + 2
      elseif e == "u" then
        local hex = s:sub(j + 2, j + 5)
        if not hex:match("^%x%x%x%x$") then fail("bad unicode escape", j) end
        local cp = tonumber(hex, 16)
        j = j + 6
        if cp >= 0xD800 and cp <= 0xDBFF and s:sub(j, j + 1) == "\\u" then
          local lo = tonumber(s:sub(j + 2, j + 5), 16)
          if lo and lo >= 0xDC00 and lo <= 0xDFFF then
            cp = 0x10000 + (cp - 0xD800) * 0x400 + (lo - 0xDC00)
            j = j + 6
          end
        end
        out[#out + 1] = utf8.char(cp)
      else fail("bad escape", j) end
    else
      out[#out + 1] = c; j = j + 1
    end
  end
end

function parse_value(s, i)
  i = skip(s, i)
  local c = s:sub(i, i)
  if c == "{" then
    local t = {}
    i = skip(s, i + 1)
    if s:sub(i, i) == "}" then return t, i + 1 end
    while true do
      i = skip(s, i)
      if s:sub(i, i) ~= '"' then fail("expected key", i) end
      local k; k, i = parse_string(s, i)
      i = skip(s, i)
      if s:sub(i, i) ~= ":" then fail("expected ':'", i) end
      local v; v, i = parse_value(s, i + 1)
      t[k] = v
      i = skip(s, i)
      local d = s:sub(i, i)
      if d == "}" then return t, i + 1 end
      if d ~= "," then fail("expected ',' or '}'", i) end
      i = i + 1
    end
  elseif c == "[" then
    local t, n = {}, 0
    i = skip(s, i + 1)
    if s:sub(i, i) == "]" then return t, i + 1 end
    while true do
      local v; v, i = parse_value(s, i)
      n = n + 1; t[n] = v
      i = skip(s, i)
      local d = s:sub(i, i)
      if d == "]" then return t, i + 1 end
      if d ~= "," then fail("expected ',' or ']'", i) end
      i = i + 1
    end
  elseif c == '"' then return parse_string(s, i)
  elseif s:sub(i, i + 3) == "true" then return true, i + 4
  elseif s:sub(i, i + 4) == "false" then return false, i + 5
  elseif s:sub(i, i + 3) == "null" then return nil, i + 4
  else
    local num = s:match("^-?%d+%.?%d*[eE]?[+-]?%d*", i)
    if not num or num == "" then fail("unexpected character", i) end
    local n = (num:find("[%.eE]") and tonumber(num)) or math.tointeger(tonumber(num)) or tonumber(num)
    if n == nil then fail("bad number", i) end
    return n, i + #num
  end
end

function J.parse(s)
  if type(s) ~= "string" then error("json: input is not a string", 0) end
  local v, i = parse_value(s, 1)
  if skip(s, i) <= #s then fail("trailing characters", i) end
  return v
end

local function quote(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    local map = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t", ["\b"] = "\\b", ["\f"] = "\\f" }
    return map[c] or string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function is_array(t)
  local n = 0
  for _ in pairs(t) do n = n + 1 end
  if n == 0 then return false end
  for i = 1, n do if t[i] == nil then return false end end
  return true
end

local function enc(v)
  local tv = type(v)
  if tv == "string" then return quote(v)
  elseif tv == "number" then
    if v ~= v or v == math.huge or v == -math.huge then error("json: cannot encode " .. tostring(v), 0) end
    return math.type(v) == "integer" and tostring(v) or string.format("%.14g", v)
  elseif tv == "boolean" then return tostring(v)
  elseif tv == "table" then
    if is_array(v) then
      local out = {}
      for i = 1, #v do out[i] = enc(v[i]) end
      return "[" .. table.concat(out, ",") .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    local out = {}
    for _, k in ipairs(keys) do
      local val = v[k]
      if val == nil then val = v[tonumber(k)] end
      out[#out + 1] = quote(k) .. ":" .. enc(val)
    end
    return "{" .. table.concat(out, ",") .. "}"
  elseif tv == "nil" then return "null"
  end
  error("json: cannot encode type " .. tv, 0)
end

J.stringify = enc
return J
