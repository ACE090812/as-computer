-- Computer hardware (server side). A computer's tower holds its parts (stored by server/mining.lua in computer_mining_towers,
-- slots from config/hardware.lua). This file turns that into what the rest of the system needs:
--   Hardware.Status(key)    what is fitted, what is missing, whether it can boot, its performance, memory, storage, network
--   Hardware.Bootable(key)  true when every required part is fitted (or the rule is switched off)
--   wear                    every fitted part loses condition while the computer is on (Config.Hardware.WearHours)
--   /pcbuild <key> <tier>   staff: fit a free build into a computer that has no placed tower (config and /placeprops computers)
--   first start wipe        one time: every computer starts clean when the rule first runs (Config.Hardware.WipeOnFirstStart)
-- A worn part keeps working but slows down (Config.Hardware.WornPerfFloor), it never switches the computer off by itself.

Hardware = {}
local H = Config.Hardware or {}

local function wearFactor(wear)
  wear = math.max(0, math.min(100, tonumber(wear) or 0))
  local floor = H.WornPerfFloor or 0.4
  return floor + (1 - floor) * (wear / 100)
end

local function partOf(itemName)
  -- 'mining_cpu_std' -> 'cpu'
  return tostring(itemName or ''):match('^mining_(%a+)_%a+$')
end

--- The full hardware picture for a computer key.
---@param key string
---@return table status
function Hardware.Status(key)
  local row = Mining.GetTower(key)
  local st = { slots = {}, missing = {}, bootable = false, perf = 0, ramMB = 0, storageMB = 0, hasGpu = false, gpuPerf = 0, network = nil, networkSpeed = 0, worstWear = 100 }
  for _, def in ipairs(H.Slots or {}) do
    local item = row and row[def.slot .. '_item']
    if item then
      local tier, wear = row[def.slot .. '_tier'], tonumber(row[def.slot .. '_wear']) or 0
      st.slots[def.slot] = { item = item, tier = tier, wear = wear, part = partOf(item) }
      if wear < st.worstWear then st.worstWear = wear end
    elseif def.required then
      st.missing[#st.missing + 1] = def.slot
    end
  end
  st.bootable = (H.Enforce == false) or #st.missing == 0
  local cpu = st.slots.cpu
  if cpu then st.perf = (H.Perf[cpu.tier] or 1) * wearFactor(cpu.wear) end
  for _, s in ipairs({ 'ram', 'ram2' }) do
    local r = st.slots[s]; if r then st.ramMB = st.ramMB + math.floor((H.RamMB[r.tier] or 0) * wearFactor(r.wear)) end
  end
  for _, s in ipairs({ 'hdd', 'hdd2' }) do
    local d = st.slots[s]; if d then st.storageMB = st.storageMB + (H.StorageMB[d.tier] or 0) end
  end
  if st.slots.gpu then st.hasGpu = true; st.gpuPerf = (H.Perf[st.slots.gpu.tier] or 1) * wearFactor(st.slots.gpu.wear) end
  local nic = st.slots.nic
  if nic then
    st.network = nic.part
    st.networkSpeed = ((H.Network[nic.part] or {}).speed or 1) * (H.Perf[nic.tier] or 1) * wearFactor(nic.wear)
  end
  local cool = st.slots.cool
  st.cooling = cool and ((H.Temp[cool.part] or 0) * (H.Perf[cool.tier] or 1) * wearFactor(cool.wear)) or 0
  return st
end

-- ---- Load and temperature. The page reports how busy the computer is every half minute (ui/hwmon.js); the temperature follows
-- ---- from that, from how worn the parts are and from the cooling.
local loadOf = {}   -- key -> { cpu, gpu, at }
function Hardware.Telemetry(key, cpu, gpu)
  cpu, gpu = tonumber(cpu), tonumber(gpu)
  if not cpu or cpu ~= cpu then return end
  loadOf[key] = { cpu = math.max(0, math.min(100, cpu)), gpu = math.max(0, math.min(100, gpu or 0)), at = os.time() }
end
--- Degrees C for a computer right now. `st` may be passed to save a lookup.
function Hardware.Temp(key, st)
  st = st or Hardware.Status(key)
  local l = loadOf[key]
  local cpu, gpu = (l and l.cpu) or 12, (l and l.gpu) or 0
  local T = H.Temp
  local t = T.base + cpu * T.perCpuPct + gpu * T.perGpuPct + (100 - (st.worstWear or 100)) * T.perWornPct - (st.cooling or 0)
  return math.floor(math.max(T.base - 6, t) * 10 + 0.5) / 10
end

--- Recent fault codes for a computer (newest first).
local faults = {}   -- key -> { { at, code, hex, part } ... }
local function addFault(key, part, code, hex)
  local list = faults[key] or {}
  table.insert(list, 1, { at = os.time(), code = code, hex = hex, part = part })
  while #list > 12 do table.remove(list) end
  faults[key] = list
end
function Hardware.Faults(key) return faults[key] or {} end

--- Can this computer start? Keys with no tower yet count as missing everything.
function Hardware.Bootable(key)
  if H.Enforce == false then return true end
  return Hardware.Status(key).bootable
end

-- ---- Wear: a minute of use takes 100 / (WearHours * 60) points off every fitted part of every computer that is on.
-- ---- Then each computer that is on rolls its chance of a blue screen (worn parts and overheating make it likelier).

--- A blue screen: the computer shuts down, the part that failed takes extra wear, the player sees the blue screen and the Event Viewer
--- gets the stop code. `part` is the slot that failed ('cpu', 'ram', ... or 'cool' for overheating).
function Hardware.Crash(key, part, reason)
  local info = H.StopCodes[(part or ''):gsub('%d+$', '')] or H.StopCodes.cpu
  addFault(key, part, info.code, info.hex)
  local row = Mining.GetTower(key)
  if row and part and row[part .. '_item'] then
    local w = math.max(0, (tonumber(row[part .. '_wear']) or 0) - (H.Crash.wearHit or 10))
    MySQL.update(('UPDATE `computer_mining_towers` SET %s_wear = ? WHERE computer_key = ?'):format(part), { w, key })
  end
  local cid = ComputerSessionCrash and ComputerSessionCrash(key)
  if ComputerLog then ComputerLog(key, 'system', 'bluescreen', ('Blue screen: %s (%s)%s'):format(info.code, info.hex, reason and (' - ' .. reason) or ''), nil, 'error') end
  local src = cid and Bridge.FindSource(cid)
  if src then TriggerClientEvent('as-computer:client:bluescreen', src, key, { code = info.code, hex = info.hex, part = part, seconds = H.Crash.restartSeconds or 10 }) end
end

local function crashRoll(key, st)
  local C = H.Crash
  local p = C.base or 0
  local worn = 0
  for _, part in pairs(st.slots) do
    local w = 1 - (part.wear / 100)
    if w > 0.5 then worn = worn + 1; p = p + (C.perWornPart or 0) * (w * w) end
  end
  local temp = Hardware.Temp(key, st)
  if temp > (H.Temp.hot or 85) then p = p + (C.overheat or 0) * math.min(2, (temp - H.Temp.hot) / 10 + 0.5) end
  if math.random() >= p then return end
  -- blame the most worn part, or the cooling when it is overheating
  local blame, lowest = nil, 101
  for slot, part in pairs(st.slots) do if part.wear < lowest and slot ~= 'cool' then blame, lowest = slot, part.wear end end
  if temp > (H.Temp.hot or 85) then blame = 'cool' end
  Hardware.Crash(key, blame or 'cpu', temp > (H.Temp.hot or 85) and ('overheating at ' .. temp .. ' C') or nil)
end

CreateThread(function()
  math.randomseed(os.time() + GetGameTimer())
  while true do
    Wait(60000)
    local perMinute = 100 / ((H.WearHours or 100) * 60)
    local ok, list = pcall(ComputerSessionsList)
    if ok and type(list) == 'table' then
      for key in pairs(list) do
        local row = Mining.GetTower(key)
        if row then
          local sets, args = {}, {}
          for _, def in ipairs(H.Slots or {}) do
            local w = row[def.slot .. '_item'] and tonumber(row[def.slot .. '_wear'])
            if w then
              sets[#sets + 1] = def.slot .. '_wear = ?'
              args[#args + 1] = math.max(0, w - perMinute)
            end
          end
          if #sets > 0 then
            args[#args + 1] = key
            MySQL.update(('UPDATE `computer_mining_towers` SET %s WHERE computer_key = ?'):format(table.concat(sets, ', ')), args)
          end
          local ok2, err = pcall(function() crashRoll(key, Hardware.Status(key)) end)
          if not ok2 then print('^1[as-computer:hardware]^0 crash roll failed for ' .. key .. ': ' .. tostring(err)) end
        end
      end
    end
  end
end)

-- ---- Staff build: fits a complete build of one tier (no inventory involved) into a computer that has no placed tower,
-- ---- which is every computer from Config.Locations and /placeprops. Player-placed monitors are built with items.
local function say(src, msg)
  if src == 0 then print('[as-computer:hardware] ' .. msg) else TriggerClientEvent('chat:addMessage', src, { args = { '^3[hardware]', msg } }) end
end

function Hardware.BuildFree(key, tierKey, includeOptional)
  if not Config.Mining.MultOf(tierKey) then return false, 'tier' end
  Mining.EnsureTower(key)
  for _, def in ipairs(H.Slots or {}) do
    if def.required or includeOptional then
      local part = H.DefaultPart(def.slot)
      Mining.InstallPart(key, def.slot, Config.Mining.ItemName(part, tierKey), tierKey, Config.Mining.StartingWear)
    end
  end
  return true
end

RegisterCommand('pcbuild', function(src, args)
  if src ~= 0 and not Bridge.IsAdmin(src) then return end
  local key, tier = args[1], args[2] or 'std'
  if not key or not key:match('^[cpm]%d+$') then return say(src, 'Usage: /pcbuild <computerKey like c1 or p3> [std|adv|elite] [all]') end
  local ok, err = Hardware.BuildFree(key, tier, args[3] == 'all')
  say(src, ok and ('Fitted a ' .. tier .. ' build into ' .. key .. (args[3] == 'all' and ' (with GPU and network card)' or '') .. '.') or ('Failed: ' .. tostring(err)))
  if ok and AdminLog then AdminLog(src, 'pcbuild', key .. ' ' .. tier) end
end, false)

--- Rough size of what is stored on a computer, in MB, from its files: a text file is tiny, pictures, sound and video are not.
local KIND_MB = { text = 0.02, folder = 0, image = 3, audio = 5, video = 40, file = 1 }
function Hardware.DiskUsedMB(key)
  local rows = MySQL.query.await(
    "SELECT kind, COUNT(*) AS n FROM computer_files WHERE deleted_at = 0 AND ((scope = 'personal' AND owner LIKE ?) OR (scope = 'pcshared' AND owner = ?)) GROUP BY kind",
    { 'pc:' .. key .. ':%', key }) or {}
  local mb = 0
  for _, r in ipairs(rows) do mb = mb + (KIND_MB[r.kind] or 1) * (tonumber(r.n) or 0) end
  return mb
end

--- What the Task Manager and the Hardware settings page read. Only the computer being used, never an arbitrary key.
MotCallback.Register('hardware:info', function(src, respond, key)
  if type(key) ~= 'string' or not key:match('^[cpm]%d+$') then return respond({ success = false }) end
  local st = Hardware.Status(key)
  local slots = {}
  for slot, p in pairs(st.slots) do slots[slot] = { tier = p.tier, wear = p.wear, part = p.part } end
  respond({ success = true, temp = Hardware.Temp(key, st), hot = H.Temp.hot, faults = Hardware.Faults(key), bootable = st.bootable, perf = st.perf, ramMB = st.ramMB, storageMB = st.storageMB, diskUsedMB = Hardware.DiskUsedMB(key),
    hasGpu = st.hasGpu, gpuPerf = st.gpuPerf, network = st.network, networkSpeed = st.networkSpeed, slots = slots })
end)

--- For other scripts and the UI: hardware of a computer.
exports('computerHardware', function(key) return Hardware.Status(tostring(key or '')) end)

-- ---- First start: wipe every computer's accounts and files once, so all machines start clean with the new rule.
MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_hardware_meta` (
      `k` VARCHAR(32) NOT NULL PRIMARY KEY,
      `v` VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  if H.WipeOnFirstStart == false then return end
  -- The other files create their tables in their own MySQL.ready, so wait a moment before touching them.
  CreateThread(function()
    Wait(8000)
    if MySQL.scalar.await("SELECT 1 FROM computer_hardware_meta WHERE k = 'wiped_v1'") then return end
    local wiped = {}
    for _, t in ipairs({ 'computer_pc_accounts', 'computer_pc_flags', 'computer_owners', 'computer_files' }) do
      local ok, n = pcall(function() return MySQL.update.await(('DELETE FROM `%s`'):format(t)) end)
      if ok then wiped[#wiped + 1] = ('%s:%s'):format(t, tostring(n)) end
    end
    if #wiped == 4 then
      MySQL.update.await("INSERT INTO computer_hardware_meta (k, v) VALUES ('wiped_v1', ?)", { tostring(os.time()) })
      print('^3[as-computer:hardware]^0 first start with the hardware rule: wiped ' .. table.concat(wiped, ', '))
    else
      print('^1[as-computer:hardware]^0 first start wipe skipped (a table was missing); it will try again next start')
    end
  end)
end)


-- ---- Telemetry from the page, and IT service (repair a part, read fault codes). Telemetry only ever concerns the computer being used.
MotCallback.Register('hardware:telemetry', function(src, respond, key, cpu, gpu)
  if type(key) == 'string' and key:match('^[cpm]%d+$') and ComputerSessionIs and ComputerSessionIs(key, src) then Hardware.Telemetry(key, cpu, gpu) end
  respond({ success = true })
end)

local function isIT(src)
  local j = Bridge.GetJob(src)
  return j ~= nil and j.name == (H.ITJob or 'it')
end

--- IT service on a computer: action 'faults' (read codes and part health) or 'repair' (restore one part to full, uses a repair item).
MotCallback.Register('hardware:service', function(src, respond, key, action, slot)
  if not isIT(src) then return respond({ success = false, error = 'not_it' }) end
  if type(key) ~= 'string' or not key:match('^[cpm]%d+$') then return respond({ success = false }) end
  local st = Hardware.Status(key)
  if action == 'faults' then
    local parts = {}
    for sl, p in pairs(st.slots) do parts[#parts + 1] = { slot = sl, part = p.part, tier = p.tier, wear = math.floor(p.wear * 10) / 10 } end
    table.sort(parts, function(a, b) return a.wear < b.wear end)
    return respond({ success = true, temp = Hardware.Temp(key, st), parts = parts, faults = Hardware.Faults(key), missing = st.missing })
  end
  if action == 'repair' then
    slot = tostring(slot or '')
    local p = st.slots[slot]
    if not p then return respond({ success = false, error = 'empty' }) end
    if p.wear >= 99.5 then return respond({ success = false, error = 'fine' }) end
    local item = H.RepairItem or 'thermal_paste'
    local found = exports.ox_inventory:Search(src, 'count', item)
    if not found or found < 1 then return respond({ success = false, error = 'no_item', item = item }) end
    if not exports.ox_inventory:RemoveItem(src, item, 1) then return respond({ success = false, error = 'inventory_error' }) end
    MySQL.update.await(('UPDATE `computer_mining_towers` SET %s_wear = ? WHERE computer_key = ?'):format(slot), { Config.Mining.StartingWear or 100, key })
    if ComputerLog then ComputerLog(key, 'system', 'repair', ('IT repaired the %s'):format(slot:upper()), src, 'success') end
    return respond({ success = true })
  end
  respond({ success = false })
end)

--- Staff: crash a computer now (events, testing).
RegisterCommand('pccrash', function(src, args)
  if src ~= 0 and not Bridge.IsAdmin(src) then return end
  local key, part = args[1], args[2] or 'cpu'
  if not key or not key:match('^[cpm]%d+$') then return say(src, 'Usage: /pccrash <computerKey> [cpu|ram|psu|hdd|gpu|nic|cool]') end
  Hardware.Crash(key, part, 'staff')
  say(src, 'Crashed ' .. key .. ' (' .. part .. ').')
  if AdminLog then AdminLog(src, 'pccrash', key .. ' ' .. part) end
end, false)
