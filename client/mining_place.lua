-- Mining Rig placement (Phase 4): using a computer_tower_*/computer_monitor/mining_rig_* item drops
-- the player into the same object_gizmo flow /placeprops uses (client/placement.lua), but item-driven
-- and open to every player - no admin ace check anywhere in this file. See server/mining_place.lua for
-- the full kind/linking design (monitor = the real computer, tower = decorative parts holder linked to
-- one, rig = GPU-only chassis).

local PC = Config.Placement or {}
local placed = {}   -- id -> { entry, obj, loc (monitor only), powerZone }

local function notify(msg, kind) Bridge.Notify(msg, kind or 'inform') end
local function vec(p) return vector3((p.x or 0) + 0.0, (p.y or 0) + 0.0, (p.z or 0) + 0.0) end

-- Phase 6: server-pushed notifications for events with no app open to show them in (a part failure
-- during the tick loop, server/mining.lua). Same event-per-feature pattern as the Mechanic app's
-- 'as-computer:client:mechanicNotify'.
RegisterNetEvent('as-computer:client:notify', function(msg, kind) notify(msg, kind) end)

local function loadModel(model)
  if not IsModelInCdimage(model) then return false end
  local timeout = GetGameTimer() + 10000
  repeat RequestModel(model) Wait(50) until HasModelLoaded(model) or GetGameTimer() > timeout
  return HasModelLoaded(model)
end

local function spawnFrozenProp(model, pos, rot)
  if not loadModel(model) then
    print(('^1[as-computer] mining prop: model %s could not be loaded (IsModelInCdimage=%s)^0'):format(tostring(model), tostring(IsModelInCdimage(model))))
    return nil
  end
  local obj = CreateObject(model, pos.x, pos.y, pos.z, false, false, false)
  -- CreateObject can return entity 0 on failure, and 0 is TRUTHY in Lua - every caller below does
  -- `if obj then ...`, which would silently proceed with a garbage handle (target zones built around
  -- coordinates near the map origin, never near the player) if this weren't checked explicitly here.
  if obj == 0 or not DoesEntityExist(obj) then
    print(('^1[as-computer] mining prop: CreateObject failed for model %s^0'):format(tostring(model)))
    return nil
  end
  SetEntityCoordsNoOffset(obj, pos.x, pos.y, pos.z, false, false, false)
  SetEntityRotation(obj, rot.x, rot.y, rot.z, 2, false)

  -- Force real collision. Two separate reasons props end up walk-through-able, both fixed here:
  --  1) the object's collision for this exact spot genuinely hasn't streamed in yet at the instant we
  --     freeze it (a very common CreateObject-at-arbitrary-coords gotcha) - RequestCollisionAtCoord +
  --     a short wait fixes that.
  --  2) SetEntityCollision can be left disabled on some object archetypes by default - explicitly force
  --     it on regardless.
  RequestCollisionAtCoord(pos.x, pos.y, pos.z)
  local colTimeout = GetGameTimer() + 2000
  while not HasCollisionLoadedAroundEntity(obj) and GetGameTimer() < colTimeout do Wait(0) end
  SetEntityCollision(obj, true, true)
  -- Deliberately NOT calling PlaceObjectOnGroundProperly here - these are gizmo-positioned (desks,
  -- shelves, wall mounts), and snapping to the ground would silently move anything not floor-level.

  FreezeEntityPosition(obj, true)
  SetModelAsNoLongerNeeded(model)
  return obj
end

-- Confirmed in-game: the placed lgmods_sinner_monitor screen has NO collision at all - a player's
-- whole body passes straight through it (this model was only ever used before as a texture swap
-- glued onto another prop's screen, never as a freestanding object, so it was never given its own
-- collision mesh). SetEntityCollision above can't create collision a model doesn't have - the only
-- real fix is to give it collision from a SECOND, invisible object that actually has some, sized to
-- roughly the same footprint. prop_monitor_02 is a normal vanilla desk-monitor prop with real
-- collision in the base game, so it's used purely as the invisible physical blocker here - the
-- VISIBLE monitor (and its texture-swapped screen) stays exactly what it was.
local BLOCKER_MODEL = 'prop_monitor_02'
local function spawnCollisionBlocker(pos, rot)
  if not loadModel(BLOCKER_MODEL) then return nil end
  local obj = CreateObject(BLOCKER_MODEL, pos.x, pos.y, pos.z, false, false, false)
  if obj == 0 or not DoesEntityExist(obj) then return nil end
  SetEntityCoordsNoOffset(obj, pos.x, pos.y, pos.z, false, false, false)
  SetEntityRotation(obj, rot.x, rot.y, rot.z, 2, false)
  SetEntityCollision(obj, true, true)
  SetEntityVisible(obj, false, false)
  SetEntityAlpha(obj, 0, false)
  FreezeEntityPosition(obj, true)
  SetModelAsNoLongerNeeded(BLOCKER_MODEL)
  return obj
end

-- ---------------------------------------------------------------------------------------------
-- Pickup (Phase 5.5: returning a placed tower/monitor/rig back to an item - server/mining_place.lua's
-- 'miningPlace:pickup'). One shared option, added onto whichever ox_target zone each kind already has -
-- a successful pickup deletes the server-side row and broadcasts, so the existing applyList/removeAny
-- diffing below despawns the prop and its zones for us; nothing here needs to delete anything itself.
-- ---------------------------------------------------------------------------------------------

local function pickupOption(id)
  return {
    name = ('as_mining_pickup_%d'):format(id),
    label = L('mp_pick_up'),
    icon = 'fa-solid fa-hand',
    distance = 2.0,
    onSelect = function()
      MotCallback.Trigger('miningPlace:pickup', function(r)
        if r and r.success then notify(L('mp_picked_up'), 'success')
        elseif r and r.reason == 'not_owner' then notify(L('mp_not_owner'), 'error')
        elseif r and r.reason == 'inventory_full' then notify(L('mp_pickup_full'), 'error')
        else notify(L('mp_pickup_failed'), 'error') end
      end, id)
    end,
  }
end

-- ---------------------------------------------------------------------------------------------
-- Monitors (the real computer)
-- ---------------------------------------------------------------------------------------------

local function powerOnZone(id, obj)
  if GetResourceState('ox_target') ~= 'started' then return nil end
  return exports.ox_target:addBoxZone({
    coords = GetEntityCoords(obj), size = vector3(1.2, 1.2, 1.2), rotation = GetEntityHeading(obj),
    debug = Config.DebugZone and true or false,
    options = {
      {
        name = ('as_mining_power_%d'):format(id),
        label = L('mp_power_on'),
        icon = 'fa-solid fa-power-off',
        distance = 2.0,
        onSelect = function()
          if lib.progressBar then
            if not lib.progressBar({ duration = 4000, label = L('mp_booting'), useWhileDead = false, canCancel = true }) then return end
          else
            Wait(4000)
          end
          MotCallback.Trigger('miningPlace:power', function(r)
            if not (r and r.success) then notify(L('mp_power_failed'), 'error') end
          end, id)
        end,
      },
      pickupOption(id),
    },
  })
end

--- A small standalone target used only once a monitor is powered on (SpawnComputer/client/dui.lua adds
--- its OWN zone for actually logging in - deliberately left untouched, see this file's header comment).
--- Coexists fine with that zone: same coords, different `name`, ox_target just shows both options.
local function poweredPickupZone(id, obj)
  if GetResourceState('ox_target') ~= 'started' then return nil end
  return exports.ox_target:addBoxZone({
    coords = GetEntityCoords(obj), size = vector3(1.2, 1.2, 1.2), rotation = GetEntityHeading(obj),
    debug = Config.DebugZone and true or false,
    options = { pickupOption(id) },
  })
end

local function monitorLoc(e)
  local m = Config.Mining.MonitorProp
  return {
    label = L('mp_monitor_label'), coords = vec(e.pos), rot = vec(e.rot), heading = e.rot.z + 0.0,
    prop = m.model, txd = m.txd, txn = m.txn, screen = m.screen, target = m.target,
  }
end

local function addMonitor(e)
  local rec = { entry = e }
  placed[e.id] = rec
  if e.powered then
    local loc = monitorLoc(e)
    rec.loc = loc
    CreateThread(function()
      SpawnComputer(loc, 'm' .. e.id)
      if placed[e.id] ~= rec then return end
      if loc.spawnedObject then
        rec.pickupZone = poweredPickupZone(e.id, loc.spawnedObject)
        rec.collider = spawnCollisionBlocker(e.pos, e.rot)
      end
    end)
  else
    CreateThread(function()
      local m = Config.Mining.MonitorProp
      local obj = spawnFrozenProp(m.model, e.pos, e.rot)
      if placed[e.id] ~= rec then if obj then DeleteEntity(obj) end return end
      rec.obj = obj
      if obj then
        rec.powerZone = powerOnZone(e.id, obj)
        rec.collider = spawnCollisionBlocker(e.pos, e.rot)
        if Config.Debug then
          print(('[as-computer] mining monitor #%d: obj=%s coords=%s zone=%s collider=%s'):format(
            e.id, tostring(obj), tostring(GetEntityCoords(obj)), tostring(rec.powerZone ~= nil), tostring(rec.collider ~= nil)))
        end
      elseif Config.Debug then
        print(('[as-computer] mining monitor #%d: spawnFrozenProp returned nil, no zone created'):format(e.id))
      end
    end)
  end
end

local function removeMonitor(id)
  local rec = placed[id]
  if not rec then return end
  if rec.powerZone then pcall(function() exports.ox_target:removeZone(rec.powerZone) end) end
  if rec.pickupZone then pcall(function() exports.ox_target:removeZone(rec.pickupZone) end) end
  if rec.loc then DespawnComputer(rec.loc) end
  if rec.obj and DoesEntityExist(rec.obj) then DeleteEntity(rec.obj) end
  if rec.collider and DoesEntityExist(rec.collider) then DeleteEntity(rec.collider) end
  placed[id] = nil
end

-- ---------------------------------------------------------------------------------------------
-- Tower cases (decorative, 5 part slots feeding their linked monitor's computer_key)
-- ---------------------------------------------------------------------------------------------

local TIER_OPTIONS = { { key = 'std', label = 'Standard' }, { key = 'adv', label = 'Advanced' }, { key = 'elite', label = 'Elite' } }

local function partsMenu(e)
  MotCallback.Trigger('miningApi', function(r)
    if not (r and r.success) then return notify(L('mp_no_data'), 'error') end
    local parts = r.data.parts or {}
    local options = {}
    for _, slot in ipairs({ 'cpu', 'gpu', 'ram', 'psu', 'hdd' }) do
      local p = parts[slot]
      options[#options + 1] = {
        title = slot:upper(), description = p and (('%s · %d%% worn'):format(p.tier, math.floor(p.wear or 0))) or L('mp_empty_slot'),
        icon = 'microchip', arrow = true,
        onSelect = function()
          if p then
            lib.registerContext({ id = 'asc_mp_slot', title = slot:upper(), menu = 'asc_mp_parts', options = {
              { title = L('mp_remove_part'), icon = 'arrow-up-from-bracket', onSelect = function()
                MotCallback.Trigger('mining:removePart', function(rr)
                  if rr and rr.success then notify(L('mp_removed'), 'success') else notify(L('mp_failed'), 'error') end
                end, e.computerKey, slot)
              end },
            } })
            lib.showContext('asc_mp_slot')
          else
            local tierOpts = {}
            for _, t in ipairs(TIER_OPTIONS) do
              tierOpts[#tierOpts + 1] = { title = t.label, icon = 'plus', onSelect = function()
                MotCallback.Trigger('mining:installPart', function(rr)
                  if rr and rr.success then notify(L('mp_installed'), 'success')
                  elseif rr and rr.error == 'missing_item' then notify(L('mp_missing_item'), 'error')
                  else notify(L('mp_failed'), 'error') end
                end, e.computerKey, slot, t.key)
              end }
            end
            lib.registerContext({ id = 'asc_mp_slot', title = slot:upper(), menu = 'asc_mp_parts', options = tierOpts })
            lib.showContext('asc_mp_slot')
          end
        end,
      }
    end
    lib.registerContext({ id = 'asc_mp_parts', title = L('mp_tower_title'), options = options })
    lib.showContext('asc_mp_parts')
  end, 'info', { computerKey = e.computerKey })
end

local function addTower(e)
  local rec = { entry = e }
  placed[e.id] = rec
  CreateThread(function()
    local obj = spawnFrozenProp(e.model, e.pos, e.rot)
    if placed[e.id] ~= rec then if obj then DeleteEntity(obj) end return end
    rec.obj = obj
    if obj and GetResourceState('ox_target') == 'started' then
      rec.zone = exports.ox_target:addBoxZone({
        coords = GetEntityCoords(obj), size = vector3(0.8, 0.8, 1.0), rotation = GetEntityHeading(obj),
        debug = Config.DebugZone and true or false,
        options = {
          { name = ('as_mining_tower_%d'):format(e.id), label = L('mp_tower_title'), icon = 'fa-solid fa-computer', distance = 2.0, onSelect = function() partsMenu(e) end },
          pickupOption(e.id),
        },
      })
    end
  end)
end

local function removeTower(id)
  local rec = placed[id]
  if not rec then return end
  if rec.zone then pcall(function() exports.ox_target:removeZone(rec.zone) end) end
  if rec.obj and DoesEntityExist(rec.obj) then DeleteEntity(rec.obj) end
  placed[id] = nil
end

-- ---------------------------------------------------------------------------------------------
-- Rigs (GPU-only chassis; link/unlink itself happens in the Mining Rig app, not here)
-- ---------------------------------------------------------------------------------------------

local function gpuMenu(e)
  local rigKey = 'r' .. e.id
  MotCallback.Trigger('mining:rigInfo', function(r)
    if not (r and r.success) then return notify(L('mp_no_data'), 'error') end
    local options = {}
    for i = 1, (r.gpuSlots or 0) do
      local g = r.gpus and r.gpus[tostring(i)]
      options[#options + 1] = {
        title = L('mp_gpu_slot', i), description = g and (('%s · %d%% worn'):format(g.tier, math.floor(g.wear or 0))) or L('mp_empty_slot'),
        icon = 'microchip', arrow = true,
        onSelect = function()
          if g then
            lib.registerContext({ id = 'asc_mp_gpu_slot', title = L('mp_gpu_slot', i), menu = 'asc_mp_gpus', options = {
              { title = L('mp_remove_part'), icon = 'arrow-up-from-bracket', onSelect = function()
                MotCallback.Trigger('mining:removeGpu', function(rr)
                  if rr and rr.success then notify(L('mp_removed'), 'success') else notify(L('mp_failed'), 'error') end
                end, rigKey, i)
              end },
            } })
            lib.showContext('asc_mp_gpu_slot')
          else
            local tierOpts = {}
            for _, t in ipairs(TIER_OPTIONS) do
              tierOpts[#tierOpts + 1] = { title = t.label, icon = 'plus', onSelect = function()
                MotCallback.Trigger('mining:installGpu', function(rr)
                  if rr and rr.success then notify(L('mp_installed'), 'success')
                  elseif rr and rr.error == 'missing_item' then notify(L('mp_missing_item'), 'error')
                  else notify(L('mp_failed'), 'error') end
                end, rigKey, i, t.key)
              end }
            end
            lib.registerContext({ id = 'asc_mp_gpu_slot', title = L('mp_gpu_slot', i), menu = 'asc_mp_gpus', options = tierOpts })
            lib.showContext('asc_mp_gpu_slot')
          end
        end,
      }
    end
    lib.registerContext({ id = 'asc_mp_gpus', title = L('mp_rig_title'), options = options })
    lib.showContext('asc_mp_gpus')
  end, rigKey)
end

local function addRig(e)
  local rec = { entry = e }
  placed[e.id] = rec
  CreateThread(function()
    local obj = spawnFrozenProp(e.model, e.pos, e.rot)
    if placed[e.id] ~= rec then if obj then DeleteEntity(obj) end return end
    rec.obj = obj
    if obj and GetResourceState('ox_target') == 'started' then
      rec.zone = exports.ox_target:addBoxZone({
        coords = GetEntityCoords(obj), size = vector3(1.0, 1.0, 1.2), rotation = GetEntityHeading(obj),
        debug = Config.DebugZone and true or false,
        options = {
          { name = ('as_mining_rig_%d'):format(e.id), label = L('mp_rig_title'), icon = 'fa-solid fa-server', distance = 2.0, onSelect = function() gpuMenu(e) end },
          pickupOption(e.id),
        },
      })
    end
  end)
end

local function removeRig(id) removeTower(id) end -- identical cleanup (obj + ox_target zone)

-- ---------------------------------------------------------------------------------------------
-- List sync
-- ---------------------------------------------------------------------------------------------

local function same(a, b)
  if not a or not b then return false end
  return a.kind == b.kind and a.model == b.model and a.powered == b.powered and a.computerKey == b.computerKey
    and a.pos.x == b.pos.x and a.pos.y == b.pos.y and a.pos.z == b.pos.z
end

local function removeAny(id)
  local rec = placed[id]
  if not rec then return end
  local kind = rec.entry.kind
  if kind == 'monitor' then removeMonitor(id) elseif kind == 'tower' then removeTower(id) elseif kind == 'rig' then removeRig(id) end
end

local function applyList(list)
  local seen = {}
  for _, e in ipairs(type(list) == 'table' and list or {}) do
    seen[e.id] = true
    local cur = placed[e.id] and placed[e.id].entry
    if not same(cur, e) then
      removeAny(e.id)
      if e.kind == 'monitor' then addMonitor(e) elseif e.kind == 'tower' then addTower(e) elseif e.kind == 'rig' then addRig(e) end
    end
  end
  for id in pairs(placed) do if not seen[id] then removeAny(id) end end
end

RegisterNetEvent('as-computer:client:miningPlacedChanged', applyList)

CreateThread(function()
  while not NetworkIsPlayerActive(PlayerId()) do Wait(500) end
  MotCallback.Trigger('miningPlace:list', applyList)
end)

AddEventHandler('onResourceStop', function(res)
  if res ~= GetCurrentResourceName() then return end
  for id in pairs(placed) do removeAny(id) end
end)

-- ---------------------------------------------------------------------------------------------
-- Placing (any player, via the item's client export - see ox_inventory's data/items.lua)
-- ---------------------------------------------------------------------------------------------

local function gizmo(obj)
  local res = PC.gizmo or 'object_gizmo'
  if GetResourceState(res) ~= 'started' then notify(L('place_no_gizmo', res), 'error') return nil end
  local ok = pcall(function() return exports[res]:useGizmo(obj) end)
  if not ok then print(('^1[as-computer] object_gizmo failed (mining placement)^0')) return nil end
  if not DoesEntityExist(obj) then return nil end
  local pos, rot = GetEntityCoords(obj), GetEntityRotation(obj, 2)
  return { x = pos.x, y = pos.y, z = pos.z }, { x = rot.x, y = rot.y, z = rot.z }
end

--- Shared positioning step: spawns a temporary preview prop in front of the player, hands it to the
--- gizmo, and returns the final pos/rot (or nil if the player cancelled).
local function positionModel(model)
  if not loadModel(model) then notify(L('place_bad_model', 'That model could not be loaded.'), 'error') return nil end
  local ped = PlayerPedId()
  local c = GetOffsetFromEntityInWorldCoords(ped, 0.0, 1.6, 0.0)
  local obj = CreateObject(model, c.x, c.y, c.z, false, false, false)
  SetEntityHeading(obj, GetEntityHeading(ped) + 180.0)
  FreezeEntityPosition(obj, true)
  SetModelAsNoLongerNeeded(model)
  local pos, rot = gizmo(obj)
  if DoesEntityExist(obj) then DeleteEntity(obj) end
  return pos, rot
end

exports('mining_placeMonitor', function(data, item)
  local pos, rot = positionModel(Config.Mining.MonitorProp.model)
  if not pos then return end
  MotCallback.Trigger('miningPlace:place', function(r)
    if r and r.success then notify(L('mp_placed'), 'success')
    else notify(L('mp_place_failed'), 'error') end
  end, { itemName = item.name, pos = pos, rot = rot })
end)

exports('mining_placeTower', function(data, item)
  local t = Config.Mining.TowerPropByItem(item.name)
  if not t then return end
  local pos, rot = positionModel(t.model)
  if not pos then return end
  MotCallback.Trigger('miningPlace:nearbyMonitors', function(list)
    list = type(list) == 'table' and list or {}
    if #list == 0 then return notify(L('mp_no_monitor_nearby'), 'error') end
    local options = {}
    for _, m in ipairs(list) do
      options[#options + 1] = {
        title = L('mp_monitor_label') .. (' #%d'):format(m.id),
        description = ('%.0f m'):format(m.dist),
        icon = 'display', onSelect = function()
          MotCallback.Trigger('miningPlace:place', function(r)
            if r and r.success then notify(L('mp_placed'), 'success')
            else notify(L('mp_place_failed'), 'error') end
          end, { itemName = item.name, pos = pos, rot = rot, monitorId = m.id })
        end,
      }
    end
    lib.registerContext({ id = 'asc_mp_link', title = L('mp_pick_monitor'), options = options })
    lib.showContext('asc_mp_link')
  end, pos)
end)

exports('mining_placeRig', function(data, item)
  local size = Config.Mining.RigSizeOfItem(item.name)
  if not size then return end
  local propsForSize = Config.Mining.RigPropsBySize(size)
  if #propsForSize == 0 then return end
  local function placeWithModel(model)
    local pos, rot = positionModel(model)
    if not pos then return end
    MotCallback.Trigger('miningPlace:place', function(r)
      if r and r.success then notify(L('mp_placed'), 'success')
      else notify(L('mp_place_failed'), 'error') end
    end, { itemName = item.name, pos = pos, rot = rot, model = model })
  end
  if #propsForSize == 1 then return placeWithModel(propsForSize[1].propName) end
  local options = {}
  for _, p in ipairs(propsForSize) do
    options[#options + 1] = { title = p.label, icon = 'server', onSelect = function() placeWithModel(p.propName) end }
  end
  lib.registerContext({ id = 'asc_mp_rig_look', title = L('mp_pick_look'), options = options })
  lib.showContext('asc_mp_rig_look')
end)
