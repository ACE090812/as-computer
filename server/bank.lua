-- Society bank bridge for the Store (paid apps): Bank.balance / remove / add / name.
-- Auto-detects the banking resource. Every call is wrapped so a wrong export name prints a clear message
-- to the server console instead of breaking the shop. Set Config.Store.bank = 'custom' to use your own.

Bank = {}

local function cfg() return Config.Store or {} end
local function log(fmt, ...) print(('^5[as-computer:store]^0 ' .. fmt):format(...)) end
local function started(res) return GetResourceState(res) == 'started' end

-- Each driver: resource, balance(account) -> number|nil, remove(account, amount, reason) -> boolean,
-- add(account, amount, reason), note(account, amount, message, deposit) (optional transaction log).
local drivers = {
    renewed = {
        resource = 'Renewed-Banking',
        balance = function(a) return exports['Renewed-Banking']:getAccountMoney(a) end,
        remove  = function(a, n) return exports['Renewed-Banking']:removeAccountMoney(a, n) end,
        add     = function(a, n) return exports['Renewed-Banking']:addAccountMoney(a, n) end,
        note    = function(a, n, msg, deposit)
            exports['Renewed-Banking']:handleTransaction(a, msg, n, msg, msg, a, deposit and 'deposit' or 'withdraw')
        end,
    },
    ['qb-banking'] = {
        resource = 'qb-banking',
        balance = function(a) return exports['qb-banking']:GetAccountBalance(a) end,
        remove  = function(a, n, r) return exports['qb-banking']:RemoveMoney(a, n, r) end,
        add     = function(a, n, r) return exports['qb-banking']:AddMoney(a, n, r) end,
    },
    ['qb-management'] = {
        resource = 'qb-management',
        balance = function(a) return exports['qb-management']:GetAccount(a) end,
        remove  = function(a, n) return exports['qb-management']:RemoveMoney(a, n) end,
        add     = function(a, n) return exports['qb-management']:AddMoney(a, n) end,
    },
    okokbanking = {
        resource = 'okokBanking',
        balance = function(a) return exports['okokBanking']:GetAccount(a) end,
        remove  = function(a, n) return exports['okokBanking']:RemoveMoney(a, n) end,
        add     = function(a, n) return exports['okokBanking']:AddMoney(a, n) end,
    },
    fd_banking = {
        resource = 'fd_banking',
        balance = function(a) return exports['fd_banking']:GetAccount(a) end,
        remove  = function(a, n, r) return exports['fd_banking']:RemoveMoney(a, n, r) end,
        add     = function(a, n, r) return exports['fd_banking']:AddMoney(a, n, r) end,
    },
    esx_society = {
        resource = 'esx_addonaccount',
        balance = function(a)
            local out
            TriggerEvent('esx_addonaccount:getSharedAccount', 'society_' .. a, function(acc) out = acc and acc.money end)
            return out
        end,
        remove = function(a, n)
            local ok = false
            TriggerEvent('esx_addonaccount:getSharedAccount', 'society_' .. a, function(acc)
                if acc and acc.money >= n then acc.removeMoney(n); ok = true end
            end)
            return ok
        end,
        add = function(a, n)
            TriggerEvent('esx_addonaccount:getSharedAccount', 'society_' .. a, function(acc) if acc then acc.addMoney(n) end end)
        end,
    },
}

local ORDER = { 'renewed', 'qb-banking', 'okokbanking', 'fd_banking', 'qb-management', 'esx_society' }

local active, activeName

local function pick()
    if active then return active end
    local want = cfg().bank or 'auto'
    if want == 'custom' then
        local c = cfg().custom or {}
        active, activeName = {
            balance = c.balance, remove = c.remove,
            add = c.add or function() end,
        }, 'custom'
        return active
    end
    if want ~= 'auto' then
        local d = drivers[want]
        if d and started(d.resource) then active, activeName = d, want; return active end
        return nil
    end
    for _, k in ipairs(ORDER) do
        local d = drivers[k]
        if started(d.resource) then active, activeName = d, k; return active end
    end
    return nil
end

--- Name of the bank in use ('renewed', ...), or nil when none was found.
function Bank.name() pick(); return activeName end

--- Society balance (whole number) or nil when it cannot be read.
function Bank.balance(account)
    local d = pick()
    if not d then return nil end
    local ok, v = pcall(d.balance, account)
    if not ok then log('reading the %s account failed: %s', tostring(account), tostring(v)); return nil end
    return tonumber(v)
end

--- Takes money from the society. Returns true when the full amount was taken.
function Bank.remove(account, amount, reason)
    local d = pick()
    if not d then return false end
    amount = math.floor(tonumber(amount) or 0)
    if amount <= 0 then return true end
    local bal = Bank.balance(account)
    if bal ~= nil and bal < amount then return false end
    local ok, res = pcall(d.remove, account, amount, reason or 'App Store')
    if not ok then log('taking money from %s failed: %s', tostring(account), tostring(res)); return false end
    if res == false then return false end
    if cfg().logTransactions ~= false and d.note then
        pcall(d.note, account, amount, reason or 'App Store', false)
    end
    return true
end

--- Puts money back (refund). Returns true unless the bank raised an error.
function Bank.add(account, amount, reason)
    local d = pick()
    if not d then return false end
    amount = math.floor(tonumber(amount) or 0)
    if amount <= 0 then return true end
    local ok, err = pcall(d.add, account, amount, reason or 'App Store refund')
    if not ok then log('refunding %s failed: %s', tostring(account), tostring(err)); return false end
    if cfg().logTransactions ~= false and d.note then
        pcall(d.note, account, amount, reason or 'App Store refund', true)
    end
    return true
end

--- true when any app in the Store costs money (so a bank is needed).
function Bank.needed()
    for _, def in pairs(Config.Apps or {}) do
        if def.store and (tonumber(def.price) or 0) > 0 then return true end
    end
    return false
end

CreateThread(function()
    Wait(4000)
    if not (Config.Store and Config.Store.enabled ~= false) or not Bank.needed() then return end
    local name = Bank.name()
    if name then
        log('society bank: %s', name)
    else
        log('^1no supported society bank is running^0 (Config.Store.bank = "%s"). Paid apps cannot be bought until one is.', tostring(cfg().bank or 'auto'))
    end
end)
