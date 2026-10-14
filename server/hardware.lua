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
  return st
end

--- Can this computer start? Keys with no tower yet count as missing everything.
function Hardware.Bootable(key)
  if H.Enforce == false then return true end
  return Hardware.Status(key).bootable
end

-- ---- Wear: a minute of use takes 100 / (WearHours * 60) points off every fitted part of every computer that is on.
CreateThread(function()
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
  respond({ success = true, bootable = st.bootable, perf = st.perf, ramMB = st.ramMB, storageMB = st.storageMB, diskUsedMB = Hardware.DiskUsedMB(key),
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
