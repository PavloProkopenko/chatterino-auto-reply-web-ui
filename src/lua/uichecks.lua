-- Checks the web UI runs next to the plugin's own modules (rules, names). Not part of the plugin.
-- Everything here calls the plugin's real functions; the only copy is check_reply (see below).
local rules = require("rules")
local names = require("names")
local util = require("util")

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
    -- negative conditions (noword) need at least one ordinary condition next to them
    local sok, serr = rules.validate_set(rules.conditions(rule))
    if not sok then
        return serr
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

-- COPY of the {time} requirement inside E.add_timer in the plugin's engine.lua (not pure, not vendored).
-- tests/lua/timer-redeem-checks.test.ts fails when the plugin source stops containing the same check.
local function timer_reply_error(reply)
    local ok, err = M.check_reply(reply)
    if not ok then
        return err
    end
    if not reply:find("{time}", 1, true) then
        return "в ответе должен быть {time}"
    end
    return nil
end

-- A timer with a usable reply and valid conditions (running or not: "running" is live state).
local function timer_valid(t)
    return timer_reply_error(t.reply) == nil and condition_error(t) == nil
end

-- Per timer: reply ({time} required), condition and name problems, and the earlier timer on the same channel that
-- wins this timer's own sample text. Timers are checked in list order, the first match wins.
function M.analyse_timers(list, me)
    local out = {}
    for i, t in ipairs(list) do
        local item = { id = t.id }
        item.reply_error = timer_reply_error(t.reply)
        item.condition_error = condition_error(t)
        if type(t.name) == "string" and t.name ~= "" then
            local nok, nerr = names.check(list, t.name, "timers", t)
            if not nok then
                item.name_error = nerr
            end
        end
        if timer_valid(t) and not has_pattern(t) then
            local text, flag_names = rules.sample(rules.conditions(t), me)
            local mask = rules.flags_from_names(flag_names)
            if rules.matches(t, text, mask, me) then
                for j = 1, i - 1 do
                    local other = list[j]
                    if other.channel == t.channel and timer_valid(other) and rules.matches(other, text, mask, me) then
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

local function has_text(s)
    return type(s) == "string" and s:match("%S") ~= nil
end

-- Per redeem: title, duration and name problems; a duplicate title in the same channel (the plugin refuses it when
-- adding); and the earlier enabled redeem whose title is contained in this one's, which then answers first
-- (engine.lua handle_redeem: plain substring of the lower-cased reward text, in list order).
function M.analyse_redeems(list)
    local out = {}
    for i, r in ipairs(list) do
        local item = { id = r.id }
        if not has_text(r.title) then
            item.title_error = "нужно название награды"
        end
        if r.action == "timeout" then
            local s = r.seconds
            if type(s) ~= "number" or s < 1 or s > 1209600 then
                item.seconds_error = "время мута должно быть от 1s до 14d"
            end
        elseif r.action ~= "untimeout" then
            item.action_error = "действие должно быть timeout или untimeout"
        end
        if type(r.name) == "string" and r.name ~= "" then
            local nok, nerr = names.check(list, r.name, "redeems", r)
            if not nok then
                item.name_error = nerr
            end
        end
        if has_text(r.title) then
            local lt = rules.lower(r.title)
            for j = 1, i - 1 do
                local o = list[j]
                if o.channel == r.channel and has_text(o.title) and rules.lower(o.title) == lt then
                    item.duplicate_of = o.id
                    break
                end
            end
            if not item.duplicate_of and r.enabled ~= false then
                for j = 1, i - 1 do
                    local o = list[j]
                    if o.enabled ~= false and o.channel == r.channel and has_text(o.title) and lt:find(rules.lower(o.title), 1, true) then
                        item.shadowed_by = o.id
                        break
                    end
                end
            end
        end
        out[#out + 1] = item
    end
    return out
end

-- What the plugin would do with one chat message: running timers first (in list order), then rules; the first
-- match ends the check. `elapsed` (seconds) stands in for the timer's real elapsed time.
-- Returns { winner = { kind, id, time? } | nil, timers = {...}, rules = {...} }.
function M.preview_all(timers, list, text, flag_names, me, channel, elapsed)
    local mask = rules.flags_from_names(flag_names or {})
    local winner
    local trows, rrows = {}, {}
    for _, t in ipairs(timers or {}) do
        local running = t.enabled == true and t.started_at ~= nil
        local valid = timer_valid(t)
        local on_channel = t.channel == channel
        local matched = rules.matches(t, text, mask, me) and true or false
        trows[#trows + 1] = { id = t.id, running = running, active = valid, applies = on_channel, matched = matched }
        if winner == nil and running and valid and on_channel and matched then
            winner = { kind = "timer", id = t.id, time = util.format_elapsed(elapsed or 0, t.format) }
        end
    end
    for _, rule in ipairs(list or {}) do
        local is_active = active(rule) and true or false
        local applies = rules.applies_to_channel(rule, channel) and true or false
        local matched = rules.matches(rule, text, mask, me) and true or false
        rrows[#rrows + 1] = { id = rule.id, active = is_active, applies = applies, matched = matched }
        if winner == nil and is_active and applies and matched then
            winner = { kind = "rule", id = rule.id }
        end
    end
    return { winner = winner, timers = trows, rules = rrows }
end

return M
