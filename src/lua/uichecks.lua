-- Checks the web UI runs next to the plugin's own modules (rules, names). Not part of the plugin.
-- Everything here calls the plugin's real functions; the only copy is check_reply (see below).
local rules = require("rules")
local names = require("names")

local M = {}

-- COPY of E.check_reply in the plugin's engine.lua. That file needs Chatterino, so it cannot be vendored
-- (docs/CONTRACT.md section 6). tests/lua/reply-contract.test.ts compares this copy with the real function when
-- PLUGIN_REPO is set. Remove it once the plugin exposes the check in a pure module.
function M.check_reply(reply)
    if type(reply) ~= "string" or not reply:match("%S") then
        return false, "нужен текст ответа"
    end
    if #reply > 500 then
        return false, "ответ длиннее 500 символов"
    end
    local first = reply:sub(1, 1)
    if first == "/" or first == "." then
        return false, "ответ не должен начинаться с «/» или «.» (это выполнилось бы как команда)"
    end
    return true
end

-- First problem in a rule's conditions, or nil. Uses the plugin's rules.validate.
local function condition_error(rule)
    for _, c in ipairs(rules.conditions(rule)) do
        local ok, err = rules.validate(c.type, c.match)
        if not ok then
            return err
        end
    end
    return nil
end

-- A rule the plugin would actually run: switched on, with a usable reply and valid conditions.
local function active(rule)
    return rules.is_usable(rule) and M.check_reply(rule.reply) and condition_error(rule) == nil
end

local function has_pattern(rule)
    for _, c in ipairs(rules.conditions(rule)) do
        if c.type == "pattern" then
            return true
        end
    end
    return false
end

-- Per rule: reply, condition and name problems, and the earlier rule that wins this rule's own sample text.
-- The shadow check is a hint: it runs the sample the plugin builds from the rule's conditions through the list.
function M.analyse(list, me)
    local out = {}
    for i, rule in ipairs(list) do
        local item = { id = rule.id }
        local ok, err = M.check_reply(rule.reply)
        if not ok then
            item.reply_error = err
        end
        item.condition_error = condition_error(rule)
        if type(rule.name) == "string" and rule.name ~= "" then
            local nok, nerr = names.check(list, rule.name, "rules", rule)
            if not nok then
                item.name_error = nerr
            end
        end
        if active(rule) and not has_pattern(rule) then
            local text, flag_names = rules.sample(rules.conditions(rule), me)
            local mask = rules.flags_from_names(flag_names)
            local channel = (type(rule.channels) == "table" and rule.channels[1]) or "канал"
            -- only when the sample really satisfies this rule; otherwise nothing can be said
            if rules.applies_to_channel(rule, channel) and rules.matches(rule, text, mask, me) then
                for j = 1, i - 1 do
                    local other = list[j]
                    if active(other) and rules.applies_to_channel(other, channel) and rules.matches(other, text, mask, me) then
                        item.shadowed_by = other.id
                        break
                    end
                end
            end
        end
        out[#out + 1] = item
    end
    return out
end

-- Runs the list in order for one message, the way the plugin does: the first active, matching rule wins.
-- Returns { winner = id|nil, rows = { {id, active, applies, matched}, ... } }.
function M.preview(list, text, flag_names, me, channel)
    local mask = rules.flags_from_names(flag_names or {})
    local rows, winner = {}, nil
    for _, rule in ipairs(list) do
        local is_active = active(rule) and true or false
        local applies = rules.applies_to_channel(rule, channel) and true or false
        local matched = rules.matches(rule, text, mask, me) and true or false
        rows[#rows + 1] = { id = rule.id, active = is_active, applies = applies, matched = matched }
        if winner == nil and is_active and applies and matched then
            winner = rule.id
        end
    end
    return { winner = winner, rows = rows }
end

return M
