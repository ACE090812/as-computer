-- Mining Rig placement (Phase 4): players place their own tower cases, monitors and rigs from
-- inventory items (client/mining_place.lua does the item's client export + object_gizmo positioning),
-- no admin gate at all - a deliberate departure from the admin-only /placeprops system in
-- server/placement.lua, per the plan doc's Phase 4 decision (item-based, any player).
--
-- Three kinds share one table:
--   'monitor' - the actual computer (login/session/Los Santos OS). computer_key = 'm' .. id, matching
--               accounts.lua/session.lua/mining.lua's validKey (extended this phase to accept 'm').
--               Starts unpowered (no DUI, no target beyond "Power on") until switched on.
--   'tower'   - a purely decorative case holding the 5 CPU/GPU/RAM/PSU/HDD slots. Has no computer_key
--               of its own - `computer_key` here is the MONITOR it was linked to at placement time
--               (within Config.Mining.TowerLinkRange), and all part install/remove goes through that
--               shared computer_key via server/mining.lua's existing Mining.InstallFromInventory etc.
--   'rig'     - a GPU-only chassis (server/mining.lua already tracks its data by rig_key in
--               computer_mining_rigs; this table only tracks where it physically is and who placed it).
--               rig_key = 'r' .. id, matching server/mining.lua's validRigKey.
--
-- Phase 5.5: picking a placed prop back up (MotCallback 'miningPlace:pickup' below). Owner-gated
-- (owner_cid at placement time, same as everywhere else in Phase 5) - hands back the item, unwinds
-- whatever it was holding (parts/GPUs go to the picker's inventory, linked rigs are auto-unlinked, not
-- deleted), and for a monitor also force-closes any active session and wipes its accounts/owner record
-- (server/session.lua's ClearComputerSession, server/accounts.lua's wipeMachine) since the machine
-- stops existing entirely. The "same owned property" scoping the locked spec mentions for rig linking
-- is still the one documented gap left (miningApp.listAvailableRigs' own comment, server/mining.lua).

local placed = {}   -- id -> row
local ready = false

local function log(fmt, ...) print(('^5[as-computer:mining_place]^0 ' .. fmt):format(...)) end

local function load()
  local rows = MySQL.query.await('SELECT * FROM computer_mining_placed') or {}
  placed = {}
  for _, r in ipairs(rows) do placed[r.id] = r end
  ready = true
  log('%d placed towers / monitors / rigs loaded', #rows)
end

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_mining_placed` (
      `id`           INT AUTO_INCREMENT PRIMARY KEY,
      `kind`         VARCHAR(10)  NOT NULL,
      `model`        VARCHAR(64)  NOT NULL,
      `size`         VARCHAR(10)  NULL,
      `computer_key` VARCHAR(24)  NULL,
      `owner_cid`    VARCHAR(64)  NOT NULL,
      `x` DOUBLE NOT NULL, `y` DOUBLE NOT NULL, `z` DOUBLE NOT NULL,
      `rx` DOUBLE NOT NULL DEFAULT 0, `ry` DOUBLE NOT NULL DEFAULT 0, `rz` DOUBLE NOT NULL DEFAULT 0,
      `powered`      TINYINT      NOT NULL DEFAULT 0,
      `created_at`   INT          NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  load()
end)

local function publicList()
  local out = {}
  for id, r in pairs(placed) do
    out[#out + 1] = {
      id = id, kind = r.kind, model = r.model, size = r.size, computerKey = r.computer_key,
      powered = r.powered == 1, pos = { x = r.x, y = r.y, z = r.z }, rot = { x = r.rx, y = r.ry, z = r.rz },
    }
  end
  table.sort(out, function(a, b) return a.id < b.id end)
  return out
end

local function broadcast() TriggerClientEvent('as-computer:client:miningPlacedChanged', -1, publicList()) end

local function num(v, lo, hi)
  v = tonumber(v)
  if not v or v ~= v or v < lo or v > hi then return nil end
  return v
end

local function cleanPos(p) if type(p) ~= 'table' then return nil end
  local x, y, z = num(p.x, -10000, 10000), num(p.y, -10000, 10000), num(p.z, -1000, 3000)
  if not (x and y and z) then return nil end
  return x, y, z
end

local function cleanRot(r) r = type(r) == 'table' and r or {}
  return num(r.x, -360, 360) or 0.0, num(r.y, -360, 360) or 0.0, num(r.z, -360, 360) or 0.0
end

local function dist(x1, y1, z1, x2, y2, z2)
  return math.sqrt((x1 - x2) ^ 2 + (y1 - y2) ^ 2 + (z1 - z2) ^ 2)
end

MotCallback.Register('miningPlace:list', function(src, respond)
  while not ready do Wait(200) end
  respond(publicList())
end)

--- Monitors within Config.Mining.TowerLinkRange of a position, for the "link to which monitor" picker
--- shown right after positioning a tower case. Only monitors with no tower linked yet are offered -
--- Mining.EnsureTower/the rest of server/mining.lua assume one tower per computer_key.
MotCallback.Register('miningPlace:nearbyMonitors', function(src, respond, pos)
  local x, y, z = cleanPos(pos)
  if not x then return respond({}) end
  local linked = {}
  for _, r in pairs(placed) do
    if r.kind == 'tower' and r.computer_key then linked[r.computer_key] = true end
  end
  local out = {}
  for id, r in pairs(placed) do
    if r.kind == 'monitor' then
      local key = 'm' .. id
      if not linked[key] then
        local d = dist(x, y, z, r.x, r.y, r.z)
        if d <= (Config.Mining.TowerLinkRange or 8.0) then
          out[#out + 1] = { id = id, computerKey = key, dist = math.floor(d * 10 + 0.5) / 10, powered = r.powered == 1 }
        end
      end
    end
  end
  table.sort(out, function(a, b) return a.dist < b.dist end)
  respond(out)
end)

--- data = { itemName, pos, rot, monitorId (tower only), model (rig only) }
MotCallback.Register('miningPlace:place', function(src, respond, data)
  data = type(data) == 'table' and data or {}
  local itemName = tostring(data.itemName or '')
  local x, y, z = cleanPos(data.pos)
  if not x then return respond({ success = false, reason = 'invalid' }) end
  local rx, ry, rz = cleanRot(data.rot)
  local cid = Bridge.GetIdentifier(src)
  if not cid then return respond({ success = false, reason = 'invalid' }) end
  if Mining.Throttled(cid) then return respond({ success = false, reason = 'throttled' }) end

  local kind, model, size, computerKey
  if itemName == (Config.Mining.MonitorItem or 'computer_monitor') then
    kind, model = 'monitor', Config.Mining.MonitorProp.model
  elseif Config.Mining.TowerPropByItem(itemName) then
    local t = Config.Mining.TowerPropByItem(itemName)
    local monitorId = math.floor(tonumber(data.monitorId) or 0)
    local mon = placed[monitorId]
    if not mon or mon.kind ~= 'monitor' then return respond({ success = false, reason = 'no_monitor' }) end
    if dist(x, y, z, mon.x, mon.y, mon.z) > (Config.Mining.TowerLinkRange or 8.0) then
      return respond({ success = false, reason = 'too_far' })
    end
    local monitorKey = 'm' .. monitorId
    for _, r in pairs(placed) do
      if r.kind == 'tower' and r.computer_key == monitorKey then return respond({ success = false, reason = 'already_linked' }) end
    end
    kind, model, computerKey = 'tower', t.model, monitorKey
  elseif Config.Mining.RigSizeOfItem(itemName) then
    size = Config.Mining.RigSizeOfItem(itemName)
    local wantModel = tostring(data.model or '')
    local okModel = false
    for _, r in ipairs(Config.Mining.RigPropsBySize(size)) do
      if r.propName == wantModel then okModel = true break end
    end
    if not okModel then return respond({ success = false, reason = 'invalid' }) end
    kind, model = 'rig', wantModel
  else
    return respond({ success = false, reason = 'invalid' })
  end

  local found = exports.ox_inventory:Search(src, 'slots', itemName)
  if not found or #found == 0 then return respond({ success = false, reason = 'missing_item' }) end
  if not exports.ox_inventory:RemoveItem(src, itemName, 1, nil, found[1].slot) then
    return respond({ success = false, reason = 'inventory_error' })
  end

  local id = MySQL.insert.await(
    'INSERT INTO computer_mining_placed (kind, model, size, computer_key, owner_cid, x, y, z, rx, ry, rz, powered, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
    { kind, model, size, computerKey, cid, x, y, z, rx, ry, rz, os.time() })
  if not id then
    exports.ox_inventory:AddItem(src, itemName, 1)
    return respond({ success = false, reason = 'error' })
  end

  local row = { id = id, kind = kind, model = model, size = size, computer_key = computerKey, owner_cid = cid, x = x, y = y, z = z, rx = rx, ry = ry, rz = rz, powered = 0 }
  if kind == 'monitor' then
    row.computer_key = 'm' .. id
    MySQL.update.await('UPDATE computer_mining_placed SET computer_key = ? WHERE id = ?', { row.computer_key, id })
  elseif kind == 'rig' then
    Mining.EnsureRig('r' .. id, size)
  end
  placed[id] = row
  log('%s placed %s #%d (%s)', GetPlayerName(src) or 'console', kind, id, model)
  broadcast()
  respond({ success = true, id = id, computerKey = row.computer_key, rigKey = kind == 'rig' and ('r' .. id) or nil })
end)

--- Powers on a placed monitor (id = its placed-row id, not its computer_key). Anyone can do this, not
--- just the owner - matches the "no gate" spirit of the rest of Phase 4 and avoids a player locking
--- their own monitor out if they place it then log off before turning it on.
MotCallback.Register('miningPlace:power', function(src, respond, id)
  if Mining.Throttled(Bridge.GetIdentifier(src)) then return respond({ success = false }) end
  id = math.floor(tonumber(id) or 0)
  local r = placed[id]
  if not r or r.kind ~= 'monitor' or r.powered == 1 then return respond({ success = false }) end
  MySQL.update.await('UPDATE computer_mining_placed SET powered = 1 WHERE id = ?', { id })
  r.powered = 1
  log('%s powered on monitor #%d', GetPlayerName(src) or 'console', id)
  broadcast()
  respond({ success = true })
end)

--- Picks up a placed tower, monitor or rig: hands the item back to the picker's (the owner's)
--- inventory, unwinds whatever it was holding, and removes the DB row. Owner-gated - only the
--- citizenid recorded as owner_cid at placement may do this.
---
---   monitor - force-closes any active session on it (server/session.lua's ClearComputerSession),
---             hands back every part its linked tower held and every GPU on every rig linked to it
---             (auto-unlinking those rigs rather than deleting them - they stay placed, just idle
---             until relinked to another monitor), wipes its accounts/owner record and its
---             computer_mining_towers row, and unlinks (does not delete) its tower.
---   tower   - hands back its own 5 parts (if any, via whichever monitor it's linked to) and unlinks
---             from that monitor. The monitor itself is untouched.
---   rig     - unlinks from its computer (if linked) and hands back every installed GPU.
--- The item given back is always the same ox_inventory item the kind/model maps to - checked with
--- ox_inventory's CanCarryItem BEFORE any of the above runs, so a full inventory refuses the whole
--- pickup up front rather than stranding a half-unwound prop.
MotCallback.Register('miningPlace:pickup', function(src, respond, id)
  id = math.floor(tonumber(id) or 0)
  local r = placed[id]
  if not r then return respond({ success = false, reason = 'not_found' }) end
  local cid = Bridge.GetIdentifier(src)
  if not cid then return respond({ success = false, reason = 'invalid' }) end
  if Mining.Throttled(cid) then return respond({ success = false, reason = 'throttled' }) end
  if r.owner_cid ~= cid then return respond({ success = false, reason = 'not_owner' }) end

  local itemName
  if r.kind == 'monitor' then itemName = Config.Mining.MonitorItem or 'computer_monitor'
  elseif r.kind == 'tower' then itemName = Config.Mining.TowerItemName(r.model)
  elseif r.kind == 'rig' then itemName = Config.Mining.RigChassisItems[r.size]
  else return respond({ success = false, reason = 'invalid' }) end
  if not itemName then return respond({ success = false, reason = 'invalid' }) end

  local canCarry = exports.ox_inventory:CanCarryItem(src, itemName, 1)
  if not canCarry then return respond({ success = false, reason = 'inventory_full' }) end

  if r.kind == 'monitor' then
    local monitorKey = 'm' .. id

    local activeCid = ClearComputerSession and ClearComputerSession(monitorKey)
    if activeCid then
      local activeSrc = Bridge.FindSource(activeCid)
      if activeSrc then TriggerClientEvent('as-computer:client:forceCloseComputer', activeSrc, monitorKey) end
    end

    for towerId, tr in pairs(placed) do
      if tr.kind == 'tower' and tr.computer_key == monitorKey then
        for _, slot in ipairs({ 'cpu', 'gpu', 'ram', 'psu', 'hdd' }) do
          Mining.RemoveToInventory(src, monitorKey, slot)
        end
        tr.computer_key = nil
        MySQL.update.await('UPDATE computer_mining_placed SET computer_key = NULL WHERE id = ?', { towerId })
      end
    end

    for _, rigKey in ipairs(Mining.RigsLinkedTo(monitorKey)) do
      local rigId = tonumber(rigKey:match('^r(%d+)$'))
      local rigRow = rigId and placed[rigId]
      local sizeCfg = rigRow and Config.Mining.RigSizes[rigRow.size]
      if sizeCfg then
        for i = 1, sizeCfg.gpuSlots do Mining.RemoveGpuToInventory(src, rigKey, i) end
      end
      Mining.LinkRig(rigKey, nil)
    end

    if Accounts.wipeMachine then Accounts.wipeMachine(monitorKey) end
    MySQL.query.await('DELETE FROM `computer_mining_towers` WHERE computer_key = ?', { monitorKey })

  elseif r.kind == 'tower' then
    if r.computer_key then
      for _, slot in ipairs({ 'cpu', 'gpu', 'ram', 'psu', 'hdd' }) do
        Mining.RemoveToInventory(src, r.computer_key, slot)
      end
    end

  elseif r.kind == 'rig' then
    local rigKey = 'r' .. id
    local sizeCfg = Config.Mining.RigSizes[r.size]
    if sizeCfg then
      for i = 1, sizeCfg.gpuSlots do Mining.RemoveGpuToInventory(src, rigKey, i) end
    end
    Mining.LinkRig(rigKey, nil)
    MySQL.query.await('DELETE FROM `computer_mining_rigs` WHERE rig_key = ?', { rigKey })
  end

  exports.ox_inventory:AddItem(src, itemName, 1)
  MySQL.query.await('DELETE FROM `computer_mining_placed` WHERE id = ?', { id })
  placed[id] = nil
  log('%s picked up %s #%d (%s)', GetPlayerName(src) or 'console', r.kind, id, r.model)
  Mining.Audit('%s picked up %s #%d', GetPlayerName(src) or 'console', r.kind, id)
  broadcast()
  respond({ success = true })
end)

-- ---------------------------------------------------------------------------------------------
-- Shop: chassis purchase (client/mining_shop.lua's ped/target). Parts themselves are bought via
-- server/mining.lua's 'mining:buyPart' (Phase 1) - this is the equivalent for the placeable items
-- Phase 4 added, same shop, same payment method (bank/card via Bridge.RemoveMoney).
local busy = {}
MotCallback.Register('miningPlace:buyChassis', function(src, respond, itemName)
  itemName = tostring(itemName or '')
  local price = Config.Mining.ChassisPrices[itemName]
  if not price then return respond({ success = false, error = 'invalid' }) end
  local cid = Bridge.GetIdentifier(src)
  if not cid or busy[cid] then return respond({ success = false, error = 'busy' }) end
  if Mining.Throttled(cid) then return respond({ success = false, error = 'throttled' }) end
  busy[cid] = true

  if not Bridge.RemoveMoney(src, 'bank', price, 'Mining Rig shop') then
    busy[cid] = nil
    return respond({ success = false, error = 'insufficient_funds' })
  end
  if not exports.ox_inventory:AddItem(src, itemName, 1) then
    Bridge.AddMoney(src, 'bank', price, 'Mining Rig shop refund')
    busy[cid] = nil
    return respond({ success = false, error = 'inventory_full' })
  end
  busy[cid] = nil
  log('%s bought %s', GetPlayerName(src) or 'console', itemName)
  respond({ success = true })
end)
