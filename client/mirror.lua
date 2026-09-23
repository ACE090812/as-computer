-- Live monitor view (onlookers). While someone uses a computer, their screen is sent here about once a second
-- (ui/app.js snapshots it, server/mirror.lua passes it on) and drawn straight onto that one monitor's screen,
-- so every computer shows its own user and monitors of the same model elsewhere are not affected.
-- After the user walks away the last picture stays; Shut down clears it (the monitor's normal screen returns).

local M = Config.Mirror or {}
if M.enabled == false then return end

local RANGE, MAX_VIEWS = M.range or 15.0, M.maxViews or 4
local TXD_NAME = 'as_computer_mirror'
local txd = nil
local frames = {}      -- key -> latest data URL
local views = {}       -- key -> { dui, txn, ready, shown, loc }
local lastWant = {}    -- key -> GetGameTimer() of the last catch-up request

local function openView(loc)
  if not txd then txd = CreateRuntimeTxd(TXD_NAME) end
  local w = M.width or 960
  local h = math.floor(w * loc.screen.size.y / loc.screen.size.x + 0.5)
  local dui = CreateDui(('nui://%s/ui/mirror.html'):format(GetCurrentResourceName()), w, h)
  local txn = ('m_%s_%d'):format(loc.key, GetGameTimer())
  CreateRuntimeTextureFromDuiHandle(txd, txn, GetDuiHandle(dui))
  local v = { dui = dui, txn = txn, ready = false, shown = false, loc = loc }
  views[loc.key] = v
  CreateThread(function()
    local t = GetGameTimer() + 8000
    while not IsDuiAvailable(dui) and GetGameTimer() < t do Wait(50) end
    Wait(200)
    if views[loc.key] ~= v then return end
    v.ready = true
    if frames[loc.key] then SendDuiMessage(dui, json.encode({ img = frames[loc.key] })); v.shown = true end
  end)
end

local function closeView(key)
  local v = views[key]
  if v then DestroyDui(v.dui) end
  views[key] = nil
end

RegisterNetEvent('as-computer:client:mirrorFrame', function(key, data)
  if type(data) ~= 'string' then return end
  frames[key] = data
  local v = views[key]
  if v and v.ready then SendDuiMessage(v.dui, json.encode({ img = data })); v.shown = true end
end)

RegisterNetEvent('as-computer:client:mirrorClear', function(key)
  frames[key] = nil
  closeView(key)
end)

-- Which computers are close enough to show, and fetch what they show when we arrive.
CreateThread(function()
  while true do
    local p = GetEntityCoords(PlayerPedId())
    local near = {}
    for _, loc in ipairs(Config.Locations) do
      local obj = loc.spawnedObject
      if loc.key and loc.screen and loc.mirror ~= false and obj and DoesEntityExist(obj) then
        local d = #(p - GetEntityCoords(obj))
        if d <= RANGE then near[#near + 1] = { loc = loc, d = d } end
      end
    end
    table.sort(near, function(a, b) return a.d < b.d end)
    local keep, now = {}, GetGameTimer()
    for i = 1, math.min(#near, MAX_VIEWS) do
      local loc = near[i].loc
      keep[loc.key] = true
      if not frames[loc.key] and now - (lastWant[loc.key] or 0) > 5000 then
        lastWant[loc.key] = now
        TriggerServerEvent('as-computer:server:mirrorWant', loc.key)
      end
      if frames[loc.key] and not views[loc.key] then openView(loc) end
    end
    for key in pairs(views) do
      if not keep[key] then closeView(key); frames[key] = nil; lastWant[key] = nil end
    end
    Wait(500)
  end
end)

-- Draw each shown screen as two textured triangles over the monitor's screen surface (both windings, so it
-- shows whichever way the model's screen faces; the monitor body hides the back).
local function drawScreen(obj, scr, txn)
  local off, b = scr.offset, 1.0 + 2.0 * (scr.bleed or 0.0)
  local hw, hh = scr.size.x / 2 * b, scr.size.y / 2 * b
  local front = scr.front or -1
  local y = off.y + front * 0.004
  local sx = front == 1 and -1 or 1         -- seen from +Y the local X axis points left
  local tl = GetOffsetFromEntityInWorldCoords(obj, off.x - hw * sx, y, off.z + hh)
  local tr = GetOffsetFromEntityInWorldCoords(obj, off.x + hw * sx, y, off.z + hh)
  local br = GetOffsetFromEntityInWorldCoords(obj, off.x + hw * sx, y, off.z - hh)
  local bl = GetOffsetFromEntityInWorldCoords(obj, off.x - hw * sx, y, off.z - hh)
  DrawSpritePoly(tl.x, tl.y, tl.z, tr.x, tr.y, tr.z, br.x, br.y, br.z, 255, 255, 255, 255, TXD_NAME, txn, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0)
  DrawSpritePoly(tl.x, tl.y, tl.z, br.x, br.y, br.z, bl.x, bl.y, bl.z, 255, 255, 255, 255, TXD_NAME, txn, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0)
  DrawSpritePoly(tl.x, tl.y, tl.z, br.x, br.y, br.z, tr.x, tr.y, tr.z, 255, 255, 255, 255, TXD_NAME, txn, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0)
  DrawSpritePoly(tl.x, tl.y, tl.z, bl.x, bl.y, bl.z, br.x, br.y, br.z, 255, 255, 255, 255, TXD_NAME, txn, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0)
end

CreateThread(function()
  while true do
    local any = false
    for key, v in pairs(views) do
      if v.shown and not IsUsingComputer(key) then
        local obj = v.loc.spawnedObject
        if obj and DoesEntityExist(obj) then any = true; drawScreen(obj, v.loc.screen, v.txn) end
      end
    end
    Wait(any and 0 or 300)
  end
end)

AddEventHandler('onResourceStop', function(res)
  if res ~= GetCurrentResourceName() then return end
  for key in pairs(views) do closeView(key) end
end)
