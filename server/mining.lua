-- Crypto Mining Rig, Phase 1: buying parts. config/mining.lua is the source of truth for prices/item
-- names; this file is the only place that actually takes the player's money and gives the item, so
-- every purchase path (the future shop ped in Phase 4, this file's own debug command today) goes
-- through Mining.BuyPart rather than duplicating the checks.
--
-- Deliberately NOT in this file (later phases): the shop ped/blip and its target/interact prompt
-- (Phase 4), the tower prop's special inventory slots the parts get slotted into (Phase 4), wear/
-- degradation over time and the mining tick itself (Phase 2), the Mining Rig app (Phase 3).

Mining = {}

local busy = {}   -- citizenid -> true while a purchase is in flight, so a doubled request can't buy twice

-- ---- Phase 5: anti-abuse. A simple per-player cooldown shared by every mutating mining action
-- ---- (buy/install/remove/start/stop/setCoin/link/unlink and Phase 4's place/power) - cheap, in-memory,
-- ---- and enough to stop a macro/spam-clicker from hammering these callbacks; read-only calls (the
-- ---- dashboard's periodic 'info' poll, 'listAvailableRigs') are never throttled.
local lastAction = {}   -- citizenid -> os.clock() of their last throttled action

---@param cid string|nil
---@return boolean throttled true if this call should be rejected (too soon after their last one)
function Mining.Throttled(cid)
  if not cid then return true end
  local now = os.clock()
  local last = lastAction[cid]
  if last and (now - last) < (Config.Mining.RateLimitSeconds or 0.75) then return true end
  lastAction[cid] = now
  return false
end

--- Phase 5: a plain console print for every economy-relevant action (buy/install/remove/start/stop/
--- link), so server staff can grep for abuse the same way they'd grep any other resource's prints -
--- no new logging framework, matching this codebase's existing print-based `log()` helpers elsewhere
--- (server/placement.lua, server/mining_place.lua). Config.Mining.AuditLog turns it off entirely.
function Mining.Audit(fmt, ...)
  if Config.Mining.AuditLog == false then return end
  print(('^6[as-computer:mining:audit]^0 ' .. fmt):format(...))
end

--- Buys one (partKey, tierKey) part for a player: takes the price from their bank, then gives the
--- ox_inventory item with fresh (Config.Mining.StartingWear) wear metadata. Refunds automatically if
--- the item can't actually be given (inventory full, item name typo, etc).
---@param src integer player server id
---@param partKey string one of Config.Mining.Parts[].key ('cpu', 'gpu', 'ram', 'psu', 'hdd')
---@param tierKey string one of Config.Mining.Tiers[].key ('std', 'adv', 'elite')
---@return boolean success, string|nil error one of 'busy' | 'unknown_part' | 'insufficient_funds' | 'inventory_full'
function Mining.BuyPart(src, partKey, tierKey)
  local cid = Bridge.GetIdentifier(src)
  if not cid then return false, 'unknown_part' end
  if busy[cid] then return false, 'busy' end
  busy[cid] = true

  local itemName = Config.Mining.ItemName(partKey, tierKey)
  local price = Config.Mining.PriceOf(partKey, tierKey)
  if not itemName or not price then busy[cid] = nil; return false, 'unknown_part' end

  if not Bridge.RemoveMoney(src, 'bank', price, 'Mining part: ' .. itemName) then
    busy[cid] = nil
    return false, 'insufficient_funds'
  end

  local metadata = { wear = Config.Mining.StartingWear }
  local ok = exports.ox_inventory:AddItem(src, itemName, 1, metadata)
  if not ok then
    Bridge.AddMoney(src, 'bank', price, 'Mining part refund: ' .. itemName)
    busy[cid] = nil
    return false, 'inventory_full'
  end

  busy[cid] = nil
  return true
end

--- Bought part -> shop screen (later phases) or this file's own debug command -> here. Every real
--- purchase in the game goes through this one callback, so Phase 4's shop UI only ever needs to call
--- 'mining:buyPart', never touch Bridge/ox_inventory itself.
MotCallback.Register('mining:buyPart', function(src, respond, partKey, tierKey)
  if Mining.Throttled(Bridge.GetIdentifier(src)) then return respond({ success = false, error = 'throttled' }) end
  local ok, err = Mining.BuyPart(src, tostring(partKey or ''), tostring(tierKey or ''))
  if ok then Mining.Audit('%s bought %s', GetPlayerName(src) or 'console', Config.Mining.ItemName(partKey, tierKey) or '?') end
  respond({ success = ok, error = err })
end)

-- Debug-only: there's no shop ped yet (Phase 4), so this is the only way to test part purchase/item
-- registration in-game right now. Gated behind Config.Debug and removed once the real shop exists.
if Config.Debug then
  RegisterCommand('buypart', function(source, args)
    local src = source
    if src == 0 then return end
    local partKey, tierKey = args[1], args[2]
    if not partKey or not tierKey then
      TriggerClientEvent('chat:addMessage', src, { args = { '^3[mining]', 'Usage: /buypart <cpu|gpu|ram|psu|hdd> <std|adv|elite>' } })
      return
    end
    local ok, err = Mining.BuyPart(src, partKey, tierKey)
    TriggerClientEvent('chat:addMessage', src, {
      args = { '^3[mining]', ok and ('Bought ' .. Config.Mining.ItemName(partKey, tierKey) .. '.') or ('Failed: ' .. tostring(err)) },
    })
  end, false)
end

-- =================================================================================================
-- Phase 2: server core. A tower (a Los Santos OS computer, same 'c<n>'/'p<n>' key as everywhere else
-- in as-computer) mines only once all 5 of its slots are filled AND it's switched on; linked mining
-- rigs (separate placed props, Phase 4) add extra GPU-only slots on top of the tower's own 5. Payout
-- is a periodic tick straight into the OWNER's sd-phone crypto holding (never whoever's logged in -
-- the plan doc's locked "Mining payout ownership" decision) via the exports.creditCrypto added to
-- sd-phone alongside this. NOT included here: the actual slot-insertion UI (Phase 4 - the functions
-- below are what that UI will call), the Mining Rig app's dashboard (Phase 3).

local SLOTS = { 'cpu', 'gpu', 'ram', 'psu', 'hdd' }
local function validSlot(s) for _, v in ipairs(SLOTS) do if v == s then return true end end return false end
-- 'm' = a player-placed mining tower (server/mining_place.lua, Phase 4), matching accounts.lua/session.lua.
local function validKey(k) return type(k) == 'string' and #k <= 24 and k:match('^[cpm]%d+$') ~= nil end
local function validRigKey(k) return type(k) == 'string' and #k <= 24 and k:match('^r%d+$') ~= nil end

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_mining_towers` (
      `computer_key`  VARCHAR(24)   NOT NULL,
      `running`       TINYINT(1)    NOT NULL DEFAULT 0,
      `coin`          VARCHAR(8)    NOT NULL DEFAULT ']] .. (Config.Mining.DefaultCoin or 'SDC') .. [[',
      `cpu_item` VARCHAR(32) NULL, `cpu_tier` VARCHAR(8) NULL, `cpu_wear` DECIMAL(5,2) NULL,
      `gpu_item` VARCHAR(32) NULL, `gpu_tier` VARCHAR(8) NULL, `gpu_wear` DECIMAL(5,2) NULL,
      `ram_item` VARCHAR(32) NULL, `ram_tier` VARCHAR(8) NULL, `ram_wear` DECIMAL(5,2) NULL,
      `psu_item` VARCHAR(32) NULL, `psu_tier` VARCHAR(8) NULL, `psu_wear` DECIMAL(5,2) NULL,
      `hdd_item` VARCHAR(32) NULL, `hdd_tier` VARCHAR(8) NULL, `hdd_wear` DECIMAL(5,2) NULL,
      `last_tick_at`  BIGINT        NOT NULL,
      `started_at`    BIGINT        NULL,
      PRIMARY KEY (`computer_key`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  ]])
  -- Migration for a table created before started_at existed (idempotent - see accounts.lua's own
  -- citizenid migration for the same pattern).
  pcall(function() MySQL.query.await('ALTER TABLE `computer_mining_towers` ADD COLUMN `started_at` BIGINT NULL') end)
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_mining_rigs` (
      `rig_key`      VARCHAR(24)  NOT NULL,
      `computer_key` VARCHAR(24)  NULL,
      `size`         VARCHAR(8)   NOT NULL DEFAULT 'small',
      `gpus`         LONGTEXT     NULL,
      `created_at`   BIGINT       NOT NULL,
      PRIMARY KEY (`rig_key`),
      KEY `idx_rigs_computer` (`computer_key`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  ]])
end)

--- A tower's row, creating a fresh (empty, off) one on first touch.
---@param computerKey string
---@return table row
function Mining.EnsureTower(computerKey)
  local row = MySQL.single.await('SELECT * FROM `computer_mining_towers` WHERE computer_key = ?', { computerKey })
  if row then return row end
  MySQL.insert.await(
    'INSERT INTO `computer_mining_towers` (computer_key, running, coin, last_tick_at) VALUES (?, 0, ?, ?)',
    { computerKey, Config.Mining.DefaultCoin or 'SDC', os.time() })
  return MySQL.single.await('SELECT * FROM `computer_mining_towers` WHERE computer_key = ?', { computerKey })
end

--- A tower's row, or nil if it's never been touched (no need to create one just to read it).
---@param computerKey string
---@return table|nil row
function Mining.GetTower(computerKey)
  if not validKey(computerKey) then return nil end
  return MySQL.single.await('SELECT * FROM `computer_mining_towers` WHERE computer_key = ?', { computerKey })
end

--- All 5 of a tower row's slots filled (the locked spec's requirement to mine at all).
---@param row table a row from Mining.GetTower/EnsureTower
---@return boolean
-- mysql-async/oxmysql sometimes hand back a TINYINT(1) column as a real Lua boolean instead of 0/1
-- (depends on the driver/connector config) - `row.running == 1` is then ALWAYS false even when the
-- tower is genuinely running, since Lua does no boolean<->number coercion (true ~= 1). This is exactly
-- why the Mining Rig app persistently showed "Stopped"/"Start mining" while the tower kept mining and
-- paying out in the background: miningApp.info's `running = row.running == 1` was silently always
-- false. Every running-state check must go through this helper instead of comparing to 1 directly.
local function isRunning(row)
  return row and (row.running == 1 or row.running == true) or false
end

local function allPartsInstalled(row)
  if not row then return false end
  for _, s in ipairs(SLOTS) do if not row[s .. '_item'] then return false end end
  return true
end

--- Installs a part into one of a tower's 5 slots, OVERWRITING whatever was there (call
--- Mining.RemovePart first and give the old part back to the player if it shouldn't be destroyed -
--- this function itself does not touch any inventory, only the DB row; Phase 4's slot-interaction UI
--- owns the actual ox_inventory item movement).
---@param computerKey string
---@param slot string one of 'cpu' | 'gpu' | 'ram' | 'psu' | 'hdd'
---@param itemName string ox_inventory item name, e.g. 'mining_cpu_elite'
---@param tierKey string one of Config.Mining.Tiers[].key
---@param wear number 0-100
---@return boolean ok false only for a bad slot/tier
function Mining.InstallPart(computerKey, slot, itemName, tierKey, wear)
  if not validKey(computerKey) or not validSlot(slot) then return false end
  if not Config.Mining.MultOf(tierKey) then return false end
  Mining.EnsureTower(computerKey)
  wear = math.max(0, math.min(100, tonumber(wear) or 0))
  MySQL.update.await(
    ('UPDATE `computer_mining_towers` SET %s_item = ?, %s_tier = ?, %s_wear = ? WHERE computer_key = ?'):format(slot, slot, slot),
    { itemName, tierKey, wear, computerKey })
  return true
end

--- Removes a slot's part (clearing it) and returns what was there, so the caller can give it back to
--- the player's inventory with its current wear preserved (parts "keep their wear state wherever
--- they go" - the locked spec). nil if the slot was already empty.
---@param computerKey string
---@param slot string one of 'cpu' | 'gpu' | 'ram' | 'psu' | 'hdd'
---@return table|nil removed { item, tier, wear }
function Mining.RemovePart(computerKey, slot)
  if not validKey(computerKey) or not validSlot(slot) then return nil end
  local row = Mining.GetTower(computerKey)
  if not row or not row[slot .. '_item'] then return nil end
  local removed = { item = row[slot .. '_item'], tier = row[slot .. '_tier'], wear = tonumber(row[slot .. '_wear']) or 0 }
  MySQL.update.await(
    ('UPDATE `computer_mining_towers` SET %s_item = NULL, %s_tier = NULL, %s_wear = NULL, running = 0 WHERE computer_key = ?'):format(slot, slot, slot),
    { computerKey })
  return removed
end

--- Which sd-phone crypto symbol a tower pays out to. Not validated against sd-phone's own asset list
--- here (Phase 3's app UI is what restricts the choices a player is offered) - a typo'd symbol just
--- means exports.creditCrypto rejects it as 'unknown_asset' at payout time rather than at set time.
---@param computerKey string
---@param coin string
function Mining.SetCoin(computerKey, coin)
  if not validKey(computerKey) or type(coin) ~= 'string' or coin == '' then return end
  Mining.EnsureTower(computerKey)
  MySQL.update.await('UPDATE `computer_mining_towers` SET coin = ? WHERE computer_key = ?', { coin:upper(), computerKey })
end

--- Starts mining. Fails if any of the 5 slots is empty.
---@param computerKey string
---@return boolean ok, string|nil error 'not_ready' when a slot is missing
function Mining.Start(computerKey)
  local row = Mining.EnsureTower(computerKey)
  local ready = allPartsInstalled(row)
  if Config.Debug then
    print(('^5[as-computer:mining]^0 Start(%s): ready=%s running=%s cpu=%s gpu=%s ram=%s psu=%s hdd=%s'):format(
      tostring(computerKey), tostring(ready), tostring(row.running),
      tostring(row.cpu_item), tostring(row.gpu_item), tostring(row.ram_item), tostring(row.psu_item), tostring(row.hdd_item)))
  end
  if not ready then return false, 'not_ready' end
  if isRunning(row) then return true end -- already running: leave started_at where it was
  local affected = MySQL.update.await(
    'UPDATE `computer_mining_towers` SET running = 1, last_tick_at = ?, started_at = ? WHERE computer_key = ?',
    { os.time(), os.time(), computerKey })
  if Config.Debug then
    print(('^5[as-computer:mining]^0 Start(%s): UPDATE affected=%s'):format(tostring(computerKey), tostring(affected)))
  end
  return true
end

--- Stops mining. Whatever was accrued up to the last tick has already been paid out - there is
--- nothing to "collect" (the locked spec: no sell/collect button on the computer, cash-out is on the
--- phone only) - so this is just a switch, not a payout trigger.
---@param computerKey string
function Mining.Stop(computerKey)
  MySQL.update.await('UPDATE `computer_mining_towers` SET running = 0, started_at = NULL WHERE computer_key = ?', { computerKey })
end

MotCallback.Register('mining:start', function(src, respond, computerKey)
  if Mining.Throttled(Bridge.GetIdentifier(src)) then return respond({ success = false, error = 'throttled' }) end
  local ok, err = Mining.Start(tostring(computerKey or ''))
  respond({ success = ok, error = err })
end)
MotCallback.Register('mining:stop', function(src, respond, computerKey)
  if Mining.Throttled(Bridge.GetIdentifier(src)) then return respond({ success = false, error = 'throttled' }) end
  Mining.Stop(tostring(computerKey or ''))
  respond({ success = true })
end)

-- ---- Mining rigs (Phase 4 will create these via /placeprops kind='miner'; the functions below are
-- ---- what that placement code and its slot UI call - nothing calls them yet).

--- A rig's row, creating a fresh (unlinked, empty) one on first touch.
---@param rigKey string
---@param size string one of Config.Mining.RigSizes' keys ('small' | 'medium' | 'large')
---@return table row
function Mining.EnsureRig(rigKey, size)
  local row = MySQL.single.await('SELECT * FROM `computer_mining_rigs` WHERE rig_key = ?', { rigKey })
  if row then return row end
  MySQL.insert.await(
    'INSERT INTO `computer_mining_rigs` (rig_key, computer_key, size, gpus, created_at) VALUES (?, NULL, ?, ?, ?)',
    { rigKey, size or 'small', json.encode({}), os.time() })
  return MySQL.single.await('SELECT * FROM `computer_mining_rigs` WHERE rig_key = ?', { rigKey })
end

--- Links a rig to a tower (both must be on the same owned property per the plan doc - Phase 4's
--- placement code is what actually checks that; this function just records the link). A rig can only
--- ever be linked to one computer, so linking it elsewhere silently replaces the old link.
---@param rigKey string
---@param computerKey string|nil nil unlinks it
function Mining.LinkRig(rigKey, computerKey)
  if not validRigKey(rigKey) then return end
  if computerKey and not validKey(computerKey) then return end
  MySQL.update.await('UPDATE `computer_mining_rigs` SET computer_key = ? WHERE rig_key = ?', { computerKey, rigKey })
end

--- Every rig currently linked to a computer key - used when that computer is being deleted (a placed
--- mining monitor picked up, server/mining_place.lua Phase 5.5) so its rigs can be auto-unlinked rather
--- than silently left pointing at a key that no longer has a row. The rigs themselves aren't touched
--- beyond the unlink - they stay placed, idle, ready to be linked to a different monitor.
---@param computerKey string
---@return string[] rigKeys
function Mining.RigsLinkedTo(computerKey)
  if not validKey(computerKey) then return {} end
  local rows = MySQL.query.await('SELECT rig_key FROM `computer_mining_rigs` WHERE computer_key = ?', { computerKey }) or {}
  local out = {}
  for _, r in ipairs(rows) do out[#out + 1] = r.rig_key end
  return out
end

--- Sets (or clears, with itemName = nil) one GPU slot on a rig.
---@param rigKey string
---@param slotIndex integer 1-based, must be within the rig's size's gpuSlots
---@param itemName string|nil ox_inventory item name, or nil to clear the slot
---@param tierKey string|nil required when itemName is set
---@param wear number|nil required when itemName is set, 0-100
---@return boolean ok
function Mining.SetGpuSlot(rigKey, slotIndex, itemName, tierKey, wear)
  local row = MySQL.single.await('SELECT size, gpus FROM `computer_mining_rigs` WHERE rig_key = ?', { rigKey })
  if not row then return false end
  local sizeCfg = Config.Mining.RigSizes[row.size]
  if not sizeCfg or slotIndex < 1 or slotIndex > sizeCfg.gpuSlots then return false end
  local ok, gpus = pcall(json.decode, row.gpus or '{}')
  if not ok or type(gpus) ~= 'table' then gpus = {} end
  if itemName then
    if not Config.Mining.MultOf(tierKey) then return false end
    gpus[tostring(slotIndex)] = { item = itemName, tier = tierKey, wear = math.max(0, math.min(100, tonumber(wear) or 0)) }
  else
    gpus[tostring(slotIndex)] = nil
  end
  MySQL.update.await('UPDATE `computer_mining_rigs` SET gpus = ? WHERE rig_key = ?', { json.encode(gpus), rigKey })
  return true
end

--- A single part's contribution to hash rate: tier multiplier scaled by current wear (0 wear = 0
--- contribution, even though the part stays installed - "reduces rate rather than stopping the rig
--- outright").
---@param tierKey string|nil
---@param wear number|nil
---@return number
local function partRate(tierKey, wear)
  if not tierKey then return 0 end
  return (Config.Mining.MultOf(tierKey) or 0) * (math.max(0, math.min(100, tonumber(wear) or 0)) / 100)
end

--- A tower's total hash rate right now: its own 5 parts (0 unless all 5 are installed) plus every
--- GPU slot on every rig linked to it. Does not check `running` - callers that care whether it's
--- switched on check that themselves (the tick loop below; a future dashboard showing "rate if you
--- turned it on").
---@param computerKey string
---@return number rate
function Mining.HashRate(computerKey)
  local row = Mining.GetTower(computerKey)
  if not allPartsInstalled(row) then return 0 end

  local rate = 0
  for _, s in ipairs(SLOTS) do rate = rate + partRate(row[s .. '_tier'], row[s .. '_wear']) end

  local rigs = MySQL.query.await('SELECT gpus FROM `computer_mining_rigs` WHERE computer_key = ?', { computerKey }) or {}
  for _, r in ipairs(rigs) do
    local ok, gpus = pcall(json.decode, r.gpus or '{}')
    if ok and type(gpus) == 'table' then
      for _, g in pairs(gpus) do rate = rate + partRate(g.tier, g.wear) end
    end
  end
  return rate
end

-- ---- The tick: pays out running towers, wears their parts down, restart-safe (last_tick_at persists
-- ---- so a server that was down for an hour catches up exactly one capped tick, not zero and not an
-- ---- unbounded one).

--- One tick's wear loss for a part already installed: the steady per-tick loss, scaled to how many
--- whole ticks actually elapsed (matters after a restart's catch-up), plus an independent roll per
--- elapsed tick for a rare bigger "failure" hit. Clamped to [0, 100].
---@param wear number current wear
---@param ticksElapsed number whole ticks this payout covers (>= 1)
---@return number newWear
--- @return number newWear, boolean failed whether a random failure hit landed this tick (Phase 6:
--- lets the caller notify the owner - the wear loss itself is unconditional either way).
local function wearAfter(wear, ticksElapsed)
  wear = tonumber(wear) or 0
  wear = wear - (Config.Mining.WearPerTick or 0) * ticksElapsed
  local failed = false
  for _ = 1, ticksElapsed do
    if math.random() < (Config.Mining.FailureChancePerTick or 0) then
      wear = wear - (Config.Mining.FailureWearLoss or 0)
      failed = true
    end
  end
  return math.max(0, math.min(100, wear)), failed
end

local function tickTower(row)
  local key = row.computer_key
  local tickSecs = Config.Mining.TickSeconds or 60
  local elapsedSecs = os.time() - (tonumber(row.last_tick_at) or os.time())
  local capSecs = (Config.Mining.OfflineAccrualCapHours or 12) * 3600
  if elapsedSecs > capSecs then elapsedSecs = capSecs end
  local ticksElapsed = math.floor(elapsedSecs / tickSecs)
  if ticksElapsed < 1 then return end -- not due yet

  local rate = Mining.HashRate(key)
  if rate > 0 then
    local amount = rate * (ticksElapsed * tickSecs) * (Config.Mining.CoinPerHashPerSecond or 0)
    local citizenid = Accounts.getOwnerCitizenId(key)
    if citizenid and amount > 0 then
      local ok, err = exports['sd-phone']:creditCrypto(citizenid, row.coin, amount)
      if not ok then
        print(('^1[as-computer:mining]^0 payout failed for %s (%s): %s'):format(key, citizenid, tostring(err)))
      end
    end
  end

  -- Wear every installed slot down, regardless of whether the payout above actually landed - the
  -- hardware still ran for real time, credited or not. Collects which slots took a random failure hit
  -- this tick so the owner (if online) can get a single combined notification below, rather than one
  -- popup per slot.
  local failedSlots = {}
  for _, s in ipairs(SLOTS) do
    if row[s .. '_item'] then
      local newWear, failed = wearAfter(row[s .. '_wear'], ticksElapsed)
      MySQL.update.await(('UPDATE `computer_mining_towers` SET %s_wear = ? WHERE computer_key = ?'):format(s), { newWear, key })
      if failed then failedSlots[#failedSlots + 1] = s end
    end
  end
  MySQL.update.await('UPDATE `computer_mining_towers` SET last_tick_at = ? WHERE computer_key = ?', { os.time(), key })

  if #failedSlots > 0 and Config.Mining.Notifications ~= false then
    local citizenid = Accounts.getOwnerCitizenId(key)
    local ownerSrc = citizenid and Bridge.FindSource(citizenid)
    if ownerSrc then
      TriggerClientEvent('as-computer:client:notify', ownerSrc,
        L('mining_notify_failure', table.concat(failedSlots, ', '):upper()), 'error')
    end
  end
end

CreateThread(function()
  math.randomseed(os.time())
  while true do
    Wait((Config.Mining.TickSeconds or 60) * 1000)
    local ok, rows = pcall(function()
      return MySQL.query.await('SELECT * FROM `computer_mining_towers` WHERE running = 1') or {}
    end)
    if ok then
      for _, row in ipairs(rows) do
        local tok, terr = pcall(tickTower, row)
        if not tok then print(('^1[as-computer:mining]^0 tick failed for %s: %s'):format(row.computer_key, tostring(terr))) end
      end
    else
      print('^1[as-computer:mining]^0 tick query failed: ' .. tostring(rows))
    end
  end
end)

-- ---- Inventory-linked install/remove: what Phase 4's slot UI will actually call (it hands over a
-- ---- specific inventory item; these functions are where that item leaves/returns the player's
-- ---- inventory). Mining.InstallPart/RemovePart above stay inventory-agnostic on purpose.

--- Takes one (slot, tier) item out of the player's own inventory and installs it, giving back
--- whatever was previously in that slot (if anything). Fails without touching either inventory or
--- tower state if the player doesn't actually have the item.
---@param src integer player server id
---@param computerKey string
---@param slot string one of 'cpu' | 'gpu' | 'ram' | 'psu' | 'hdd'
---@param tierKey string one of Config.Mining.Tiers[].key
---@return boolean ok, string|nil error 'invalid' | 'missing_item' | 'inventory_error'
function Mining.InstallFromInventory(src, computerKey, slot, tierKey)
  if not validKey(computerKey) or not validSlot(slot) then return false, 'invalid' end
  local itemName = Config.Mining.ItemName(slot, tierKey)
  if not itemName then return false, 'invalid' end

  local found = exports.ox_inventory:Search(src, 'slots', itemName)
  if not found or #found == 0 then return false, 'missing_item' end
  local it = found[1]
  local wear = (it.metadata and tonumber(it.metadata.wear)) or Config.Mining.StartingWear

  if not exports.ox_inventory:RemoveItem(src, itemName, 1, nil, it.slot) then
    return false, 'inventory_error'
  end

  local old = Mining.RemovePart(computerKey, slot)
  if old then
    if not exports.ox_inventory:AddItem(src, old.item, 1, { wear = old.wear }) then
      -- couldn't hand the old part back (inventory full mid-swap) - put the new item back too rather
      -- than destroy anything, and restore the old part to the slot.
      exports.ox_inventory:AddItem(src, itemName, 1, { wear = wear })
      Mining.InstallPart(computerKey, slot, old.item, old.tier, old.wear)
      return false, 'inventory_error'
    end
  end

  Mining.InstallPart(computerKey, slot, itemName, tierKey, wear)
  return true
end

--- Removes one slot's part and gives it to the player's inventory with its current wear preserved.
--- Puts it back in the slot (never destroys it) if the player's inventory can't take it.
---@param src integer player server id
---@param computerKey string
---@param slot string one of 'cpu' | 'gpu' | 'ram' | 'psu' | 'hdd'
---@return boolean ok, string|nil error 'empty' | 'inventory_full'
function Mining.RemoveToInventory(src, computerKey, slot)
  local removed = Mining.RemovePart(computerKey, slot)
  if not removed then return false, 'empty' end
  if not exports.ox_inventory:AddItem(src, removed.item, 1, { wear = removed.wear }) then
    Mining.InstallPart(computerKey, slot, removed.item, removed.tier, removed.wear)
    return false, 'inventory_full'
  end
  return true
end

MotCallback.Register('mining:installPart', function(src, respond, computerKey, slot, tierKey)
  if Mining.Throttled(Bridge.GetIdentifier(src)) then return respond({ success = false, error = 'throttled' }) end
  local ok, err = Mining.InstallFromInventory(src, tostring(computerKey or ''), tostring(slot or ''), tostring(tierKey or ''))
  if ok then Mining.Audit('%s installed %s (%s) into %s', GetPlayerName(src) or 'console', slot, tierKey, computerKey) end
  respond({ success = ok, error = err })
end)
MotCallback.Register('mining:removePart', function(src, respond, computerKey, slot)
  if Mining.Throttled(Bridge.GetIdentifier(src)) then return respond({ success = false, error = 'throttled' }) end
  local ok, err = Mining.RemoveToInventory(src, tostring(computerKey or ''), tostring(slot or ''))
  if ok then Mining.Audit('%s removed %s from %s', GetPlayerName(src) or 'console', slot, computerKey) end
  respond({ success = ok, error = err })
end)

-- ---- GPU slots on a placed rig (Phase 4: client/mining_place.lua's rig target menu). Mirrors
-- ---- InstallFromInventory/RemoveToInventory above exactly, but against a rig's numbered GPU slots
-- ---- (Mining.SetGpuSlot) instead of a tower's 5 named ones (Mining.InstallPart/RemovePart).

--- Takes a GPU out of the player's inventory and installs it into one rig slot, giving back whatever
--- was previously there (if anything). Fails without touching either side if the player has no GPU of
--- that tier, or the slot index is out of range for this rig's size.
---@param src integer
---@param rigKey string
---@param slotIndex integer 1-based
---@param tierKey string
---@return boolean ok, string|nil error 'invalid' | 'missing_item' | 'inventory_error'
function Mining.InstallGpuFromInventory(src, rigKey, slotIndex, tierKey)
  if not validRigKey(rigKey) then return false, 'invalid' end
  local itemName = Config.Mining.ItemName('gpu', tierKey)
  if not itemName then return false, 'invalid' end

  local found = exports.ox_inventory:Search(src, 'slots', itemName)
  if not found or #found == 0 then return false, 'missing_item' end
  local it = found[1]
  local wear = (it.metadata and tonumber(it.metadata.wear)) or Config.Mining.StartingWear

  if not exports.ox_inventory:RemoveItem(src, itemName, 1, nil, it.slot) then
    return false, 'inventory_error'
  end

  local row = MySQL.single.await('SELECT gpus FROM `computer_mining_rigs` WHERE rig_key = ?', { rigKey })
  local ok, gpus = pcall(json.decode, row and row.gpus or '{}')
  local old = ok and gpus and gpus[tostring(slotIndex)] or nil

  if not Mining.SetGpuSlot(rigKey, slotIndex, itemName, tierKey, wear) then
    exports.ox_inventory:AddItem(src, itemName, 1, { wear = wear })
    return false, 'invalid'
  end

  if old then
    if not exports.ox_inventory:AddItem(src, old.item, 1, { wear = old.wear }) then
      exports.ox_inventory:AddItem(src, itemName, 1, { wear = wear })
      Mining.SetGpuSlot(rigKey, slotIndex, old.item, old.tier, old.wear)
      return false, 'inventory_error'
    end
  end
  return true
end

--- Removes one GPU slot's contents and gives it back to the player's inventory. Puts it back in the
--- slot (never destroys it) if the player's inventory can't take it.
---@param src integer
---@param rigKey string
---@param slotIndex integer
---@return boolean ok, string|nil error 'empty' | 'inventory_full'
function Mining.RemoveGpuToInventory(src, rigKey, slotIndex)
  if not validRigKey(rigKey) then return false, 'empty' end
  local row = MySQL.single.await('SELECT gpus FROM `computer_mining_rigs` WHERE rig_key = ?', { rigKey })
  local ok, gpus = pcall(json.decode, row and row.gpus or '{}')
  local slotData = ok and gpus and gpus[tostring(slotIndex)] or nil
  if not slotData then return false, 'empty' end
  if not exports.ox_inventory:AddItem(src, slotData.item, 1, { wear = slotData.wear }) then
    return false, 'inventory_full'
  end
  Mining.SetGpuSlot(rigKey, slotIndex, nil, nil, nil)
  return true
end

--- Read-only rig state for the target menu: size, total GPU slots and what's currently in each.
MotCallback.Register('mining:rigInfo', function(src, respond, rigKey)
  rigKey = tostring(rigKey or '')
  if not validRigKey(rigKey) then return respond({ success = false }) end
  local row = MySQL.single.await('SELECT size, gpus, computer_key FROM `computer_mining_rigs` WHERE rig_key = ?', { rigKey })
  if not row then return respond({ success = false }) end
  local ok, gpus = pcall(json.decode, row.gpus or '{}')
  respond({
    success = true, size = row.size, linked = row.computer_key ~= nil,
    gpuSlots = (Config.Mining.RigSizes[row.size] or {}).gpuSlots or 0,
    gpus = ok and gpus or {},
  })
end)

MotCallback.Register('mining:installGpu', function(src, respond, rigKey, slotIndex, tierKey)
  if Mining.Throttled(Bridge.GetIdentifier(src)) then return respond({ success = false, error = 'throttled' }) end
  local ok, err = Mining.InstallGpuFromInventory(src, tostring(rigKey or ''), math.floor(tonumber(slotIndex) or 0), tostring(tierKey or ''))
  if ok then Mining.Audit('%s installed a GPU (%s) into %s slot %s', GetPlayerName(src) or 'console', tierKey, rigKey, tostring(slotIndex)) end
  respond({ success = ok, error = err })
end)
MotCallback.Register('mining:removeGpu', function(src, respond, rigKey, slotIndex)
  if Mining.Throttled(Bridge.GetIdentifier(src)) then return respond({ success = false, error = 'throttled' }) end
  local ok, err = Mining.RemoveGpuToInventory(src, tostring(rigKey or ''), math.floor(tonumber(slotIndex) or 0))
  if ok then Mining.Audit('%s removed a GPU from %s slot %s', GetPlayerName(src) or 'console', rigKey, tostring(slotIndex)) end
  respond({ success = ok, error = err })
end)

-- Debug-only: there's no slot-insertion UI yet (Phase 4), so these commands are the only way to test
-- the full buy -> install -> start -> tick -> payout loop in-game right now. Removed once that UI ships.
if Config.Debug then
  local function say(src, msg) TriggerClientEvent('chat:addMessage', src, { args = { '^3[mining]', msg } }) end

  RegisterCommand('installpart', function(source, args)
    local src = source
    if src == 0 then return end
    local key, slot, tier = args[1], args[2], args[3]
    if not key or not slot or not tier then return say(src, 'Usage: /installpart <computerKey> <cpu|gpu|ram|psu|hdd> <std|adv|elite>') end
    local ok, err = Mining.InstallFromInventory(src, key, slot, tier)
    say(src, ok and ('Installed into ' .. slot .. '.') or ('Failed: ' .. tostring(err)))
  end, false)

  RegisterCommand('removepart', function(source, args)
    local src = source
    if src == 0 then return end
    local key, slot = args[1], args[2]
    if not key or not slot then return say(src, 'Usage: /removepart <computerKey> <cpu|gpu|ram|psu|hdd>') end
    local ok, err = Mining.RemoveToInventory(src, key, slot)
    say(src, ok and ('Removed from ' .. slot .. '.') or ('Failed: ' .. tostring(err)))
  end, false)

  RegisterCommand('startmining', function(source, args)
    local src = source
    if src == 0 then return end
    local key = args[1]
    if not key then return say(src, 'Usage: /startmining <computerKey>') end
    local ok, err = Mining.Start(key)
    say(src, ok and 'Mining started.' or ('Failed: ' .. tostring(err)))
  end, false)

  RegisterCommand('stopmining', function(source, args)
    local src = source
    if src == 0 then return end
    local key = args[1]
    if not key then return say(src, 'Usage: /stopmining <computerKey>') end
    Mining.Stop(key)
    say(src, 'Mining stopped.')
  end, false)

  RegisterCommand('miningstatus', function(source, args)
    local src = source
    if src == 0 then return end
    local key = args[1]
    if not key then return say(src, 'Usage: /miningstatus <computerKey>') end
    local row = Mining.GetTower(key)
    if not row then return say(src, 'No tower record for ' .. key .. ' yet (nothing installed).') end
    local owner = Accounts.getOwnerCitizenId(key)
    say(src, ('running=%s coin=%s rate=%.4f owner=%s cpu=%s/%s(%.0f%%) gpu=%s/%s(%.0f%%) ram=%s/%s(%.0f%%) psu=%s/%s(%.0f%%) hdd=%s/%s(%.0f%%)'):format(
      tostring(isRunning(row)), row.coin, Mining.HashRate(key), tostring(owner),
      tostring(row.cpu_item), tostring(row.cpu_tier), tonumber(row.cpu_wear) or 0,
      tostring(row.gpu_item), tostring(row.gpu_tier), tonumber(row.gpu_wear) or 0,
      tostring(row.ram_item), tostring(row.ram_tier), tonumber(row.ram_wear) or 0,
      tostring(row.psu_item), tostring(row.psu_tier), tonumber(row.psu_wear) or 0,
      tostring(row.hdd_item), tostring(row.hdd_tier), tonumber(row.hdd_wear) or 0))
  end, false)
end

-- =================================================================================================
-- Phase 3: Mining Rig app. One NUI callback ('miningApi', client/dui.lua) name-routes to the actions
-- below, same pattern as storeApi/settingsApi - dashboard-only per the locked spec (rate, coin,
-- balance, price, part health, uptime, start/stop; no sell/collect button, cash-out is on the phone).

local miningApp = {}

--- Full dashboard snapshot for the computer the app is open on. `ready` is whether all 5 slots are
--- filled (Start will otherwise fail); balance/price come from sd-phone for the tower's OWNER, not
--- necessarily the player looking at the screen.
---@param src integer player server id (unused directly - the snapshot is the same for anyone looking
---  at this screen, but kept for a consistent action signature and future per-viewer touches)
---@param computerKey string
---@return table result { success, data }
function miningApp.info(src, computerKey)
  if not validKey(computerKey) then return { success = false } end
  local row = Mining.EnsureTower(computerKey)
  local ready = allPartsInstalled(row)
  local hashRate = Mining.HashRate(computerKey)
  local uptime = (isRunning(row) and row.started_at) and (os.time() - tonumber(row.started_at)) or 0

  local ownerCid = Accounts.getOwnerCitizenId(computerKey)
  local price, balance = 0, 0
  if ownerCid then
    local ok, info = exports['sd-phone']:getCryptoInfo(ownerCid, row.coin)
    if ok and type(info) == 'table' then price, balance = info.price or 0, info.quantity or 0 end
  end

  local parts = {}
  for _, s in ipairs(SLOTS) do
    parts[s] = row[s .. '_item'] and { item = row[s .. '_item'], tier = row[s .. '_tier'], wear = tonumber(row[s .. '_wear']) or 0 } or nil
  end

  local rigs = MySQL.query.await('SELECT rig_key, size, gpus FROM `computer_mining_rigs` WHERE computer_key = ?', { computerKey }) or {}
  local linkedRigs = {}
  for _, r in ipairs(rigs) do
    local ok, gpus = pcall(json.decode, r.gpus or '{}')
    linkedRigs[#linkedRigs + 1] = { key = r.rig_key, size = r.size, gpus = ok and gpus or {}, gpuSlots = (Config.Mining.RigSizes[r.size] or {}).gpuSlots or 0 }
  end

  return { success = true, data = {
    ready     = ready,
    running   = isRunning(row),
    coin      = row.coin,
    hashRate  = hashRate,
    uptime    = uptime,
    price     = price,
    balance   = balance,
    hasOwner  = ownerCid ~= nil,
    parts     = parts,
    rigs      = linkedRigs,
  } }
end

--- Every sd-phone coin's balance for the tower's OWNER (not just the one it currently mines) - the
--- Wallet screen's "every coin" view (Phase 8): a player who's mining SDC but holds a BTL bag from
--- before wants to see both without switching the payout coin just to look. One sd-phone call per
--- configured coin (Config.Mining.Coins) - only fired when the Wallet tab is actually opened, never on
--- the 8s dashboard poll, so this doesn't multiply sd-phone traffic for players who never look at it.
---@param src integer player server id (unused - same reasoning as miningApp.info)
---@param computerKey string
---@return table result { success, data } - data is { hasOwner, wallets: [{ coin, price, balance }] }
function miningApp.wallets(src, computerKey)
  if not validKey(computerKey) then return { success = false } end
  local ownerCid = Accounts.getOwnerCitizenId(computerKey)
  if not ownerCid then return { success = true, data = { hasOwner = false, wallets = {} } } end

  local wallets = {}
  for _, coin in ipairs(Config.Mining.Coins) do
    local price, balance = 0, 0
    local ok, info = exports['sd-phone']:getCryptoInfo(ownerCid, coin)
    if ok and type(info) == 'table' then price, balance = info.price or 0, info.quantity or 0 end
    wallets[#wallets + 1] = { coin = coin, price = price, balance = balance }
  end
  return { success = true, data = { hasOwner = true, wallets = wallets } }
end

function miningApp.start(src, computerKey)
  local ok, err = Mining.Start(tostring(computerKey or ''))
  return { success = ok, error = err }
end

function miningApp.stop(src, computerKey)
  Mining.Stop(tostring(computerKey or ''))
  return { success = true }
end

--- Changes which sd-phone crypto symbol this tower pays out to. Only the machine's OWNER may do
--- this (the payout target is a property of ownership, not of who happens to be logged in).
---@param src integer player server id
---@param computerKey string
---@param coin string
function miningApp.setCoin(src, computerKey, coin)
  computerKey = tostring(computerKey or '')
  if not validKey(computerKey) then return { success = false } end
  local cid = Bridge.GetIdentifier(src)
  if not cid or cid ~= Accounts.getOwnerCitizenId(computerKey) then
    return { success = false, error = 'not_owner' }
  end
  Mining.SetCoin(computerKey, tostring(coin or ''))
  return { success = true }
end

--- Rigs not currently linked to ANY computer, for the app's "Add rig" section. NOTE: this is not yet
--- scoped to the same property as the computer (the locked spec requires that) - Phase 4 hasn't built
--- rig placement/property checks yet, so for now this lists every unlinked rig server-wide. Tighten
--- this once Phase 4 gives rigs a property/location to compare against.
---@param src integer player server id
---@param computerKey string unused for now (kept for the property-scoping this will need)
function miningApp.listAvailableRigs(src, computerKey)
  local rows = MySQL.query.await('SELECT rig_key, size FROM `computer_mining_rigs` WHERE computer_key IS NULL') or {}
  local out = {}
  for _, r in ipairs(rows) do out[#out + 1] = { key = r.rig_key, size = r.size } end
  return { success = true, data = out }
end

--- Phase 5 hardening: linking used to accept ANY unlinked rig onto ANY computer, which meant a
--- player could quietly attach someone else's idle rig to their own computer's payout (free hash
--- rate at the rig owner's expense) or dump junk rigs onto a stranger's machine. Now requires the
--- caller to own BOTH the computer (existing setCoin-style check) and the physical rig itself
--- (server/mining_place.lua's computer_mining_placed.owner_cid, looked up by the rig's placed-row id -
--- rig_key is always 'r' .. that id). Full same-property scoping is still the documented Phase 4 gap.
---@param rigKey string
---@return string|nil ownerCid nil if the rig key is malformed or the row doesn't exist
local function rigOwnerCid(rigKey)
  local rigId = tonumber(tostring(rigKey or ''):match('^r(%d+)$'))
  if not rigId then return nil end
  local row = MySQL.single.await('SELECT owner_cid FROM `computer_mining_placed` WHERE id = ? AND kind = ?', { rigId, 'rig' })
  return row and row.owner_cid or nil
end

function miningApp.linkRig(src, computerKey, rigKey)
  computerKey, rigKey = tostring(computerKey or ''), tostring(rigKey or '')
  if not validKey(computerKey) or not validRigKey(rigKey) then return { success = false } end
  local cid = Bridge.GetIdentifier(src)
  if not cid or cid ~= Accounts.getOwnerCitizenId(computerKey) then return { success = false, error = 'not_owner' } end
  if cid ~= rigOwnerCid(rigKey) then return { success = false, error = 'not_your_rig' } end
  Mining.LinkRig(rigKey, computerKey)
  return { success = true }
end

function miningApp.unlinkRig(src, rigKey)
  rigKey = tostring(rigKey or '')
  if not validRigKey(rigKey) then return { success = false } end
  local cid = Bridge.GetIdentifier(src)
  if not cid then return { success = false } end
  -- Either the rig's owner or the computer it's linked to's owner may unlink it - the computer's
  -- owner shouldn't be stuck with someone else's rig contributing to their tower forever with no way
  -- to remove it if the rig's owner has gone inactive.
  local row = MySQL.single.await('SELECT computer_key FROM `computer_mining_rigs` WHERE rig_key = ?', { rigKey })
  local computerOwner = row and row.computer_key and Accounts.getOwnerCitizenId(row.computer_key)
  if cid ~= rigOwnerCid(rigKey) and cid ~= computerOwner then return { success = false, error = 'not_owner' } end
  Mining.LinkRig(rigKey, nil)
  return { success = true }
end

-- These are the mutating actions - throttled below. 'info' and 'listAvailableRigs' are read-only
-- (the dashboard polls 'info' every 8s) and are never throttled.
local MINING_API_MUTATING = { start = true, stop = true, setCoin = true, linkRig = true, unlinkRig = true }

MotCallback.Register('miningApi', function(src, respond, name, data)
  data = type(data) == 'table' and data or {}
  local fn = miningApp[tostring(name or '')]
  if not fn then return respond({ success = false }) end
  if MINING_API_MUTATING[name] and Mining.Throttled(Bridge.GetIdentifier(src)) then
    return respond({ success = false, error = 'throttled' })
  end

  local ok, result
  if name == 'info' or name == 'start' or name == 'stop' or name == 'listAvailableRigs' or name == 'wallets' then
    ok, result = pcall(fn, src, data.computerKey)
    if not ok then
      -- pcall swallows a real Lua error into `result` as a plain string, and the line below this
      -- block turns that into an unhelpful {success=false} with NO clue why - always print it.
      print(('^1[as-computer:mining]^0 miningApi %s(%s) errored: %s'):format(tostring(name), tostring(data.computerKey), tostring(result)))
    end
  elseif name == 'setCoin' then
    ok, result = pcall(fn, src, data.computerKey, data.coin)
  elseif name == 'linkRig' then
    ok, result = pcall(fn, src, data.computerKey, data.rigKey)
  elseif name == 'unlinkRig' then
    ok, result = pcall(fn, src, data.rigKey)
  else
    return respond({ success = false })
  end

  if ok and result and result.success and MINING_API_MUTATING[name] then
    local who = GetPlayerName(src) or 'console'
    if name == 'start' then Mining.Audit('%s started %s', who, tostring(data.computerKey))
    elseif name == 'stop' then Mining.Audit('%s stopped %s', who, tostring(data.computerKey))
    elseif name == 'setCoin' then Mining.Audit('%s set %s to mine %s', who, tostring(data.computerKey), tostring(data.coin))
    elseif name == 'linkRig' then Mining.Audit('%s linked rig %s to %s', who, tostring(data.rigKey), tostring(data.computerKey))
    elseif name == 'unlinkRig' then Mining.Audit('%s unlinked rig %s', who, tostring(data.rigKey))
    end
  end
  respond(ok and result or { success = false })
end)
