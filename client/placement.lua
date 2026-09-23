-- Placed computers and TVs (server/placement.lua). Admins use /placeprops (Config.Placement.command):
-- pick a model, move it into place with object_gizmo, press Enter, and it is saved and spawned for everyone.
-- Placed TVs show a Presento presentation when someone casts one from Scout; the presenter changes slides with
-- the clicker keys (Config.Placement.clicker) while standing near the TV.

local PC = Config.Placement or {}
if PC.enabled == false then return end

local placedLocs = {}   -- id -> location table (computers, also inserted into Config.Locations)
local tvs = {}          -- id -> { entry, v = model config, obj }
local tvStates = {}     -- id -> { deck, title, slide, step, by, count, version } while something is showing
local screen = {}       -- the one TV this client is drawing: { tv, dui, v, txn, version, ready }
local tvTxd = nil

local function notify(msg, kind) Bridge.Notify(msg, kind or 'inform') end
local function vec(p) return vector3((p.x or 0) + 0.0, (p.y or 0) + 0.0, (p.z or 0) + 0.0) end

local function same(a, b)
  if not a or not b then return false end
  return a.kind == b.kind and a.variant == b.variant and a.label == b.label and json.encode(a.jobs or {}) == json.encode(b.jobs or {})
    and a.pos.x == b.pos.x and a.pos.y == b.pos.y and a.pos.z == b.pos.z and a.rot.x == b.rot.x and a.rot.y == b.rot.y and a.rot.z == b.rot.z
end

local function loadModel(model)
  if not IsModelInCdimage(model) then return false end
  local timeout = GetGameTimer() + 10000
  repeat RequestModel(model) Wait(50) until HasModelLoaded(model) or GetGameTimer() > timeout
  return HasModelLoaded(model)
end

local function spawnProp(model, pos, rot)
  if not loadModel(model) then
    print(('^1[as-computer] placed prop: model %s could not be loaded^0'):format(tostring(model)))
    return nil
  end
  local obj = CreateObject(model, pos.x, pos.y, pos.z, false, false, false)
  SetEntityCoordsNoOffset(obj, pos.x, pos.y, pos.z, false, false, false)
  SetEntityRotation(obj, rot.x, rot.y, rot.z, 2, false)
  FreezeEntityPosition(obj, true)
  SetModelAsNoLongerNeeded(model)
  return obj
end

-- ---------------------------------------------------------------------------------------------
-- Computers
-- ---------------------------------------------------------------------------------------------

local function addComputer(e)
  local v = PC.computers and PC.computers[e.variant]
  if not v then return end
  local loc = {
    label = e.label, coords = vec(e.pos), heading = e.rot.z + 0.0, rot = vec(e.rot),
    prop = v.prop, txd = v.txd, txn = v.txn, screen = v.screen, target = v.target, jobs = v.jobs,
    placedId = e.id, entry = e,
  }
  placedLocs[e.id] = loc
  Config.Locations[#Config.Locations + 1] = loc
  CreateThread(function() SpawnComputer(loc, 'p' .. e.id) end)
end

local function removeComputer(id)
  local loc = placedLocs[id]
  if not loc then return end
  DespawnComputer(loc)
  for i, l in ipairs(Config.Locations) do
    if l == loc then table.remove(Config.Locations, i) break end
  end
  placedLocs[id] = nil
end

-- ---------------------------------------------------------------------------------------------
-- TVs
-- ---------------------------------------------------------------------------------------------

local function screenOff()
  if screen.dui then
    RemoveReplaceTexture(screen.v.txd, screen.v.txn)
    DestroyDui(screen.dui)
  end
  screen = {}
end

local function addTv(e)
  local v = PC.tvs and PC.tvs[e.variant]
  if not v then return end
  local t = { entry = e, v = v }
  tvs[e.id] = t
  CreateThread(function()
    local obj = spawnProp(v.prop, e.pos, e.rot)
    if tvs[e.id] == t then t.obj = obj elseif obj then DeleteEntity(obj) end
  end)
end

local function removeTv(id)
  local t = tvs[id]
  if not t then return end
  if screen.tv == id then screenOff() end
  if t.obj and DoesEntityExist(t.obj) then DeleteEntity(t.obj) end
  tvs[id] = nil
end

local function applyList(list)
  local seen = {}
  for _, e in ipairs(type(list) == 'table' and list or {}) do
    seen[e.id] = true
    local cur = (tvs[e.id] and tvs[e.id].entry) or (placedLocs[e.id] and placedLocs[e.id].entry)
    if not same(cur, e) then
      removeTv(e.id)
      removeComputer(e.id)
      if e.kind == 'tv' then addTv(e) else addComputer(e) end
    end
  end
  for id in pairs(tvs) do if not seen[id] then removeTv(id) end end
  for id in pairs(placedLocs) do if not seen[id] then removeComputer(id) end end
end

RegisterNetEvent('as-computer:client:placedChanged', applyList)

CreateThread(function()
  while not NetworkIsPlayerActive(PlayerId()) do Wait(500) end
  MotCallback.Trigger('placement:list', applyList)
  MotCallback.Trigger('tv:states', function(states)
    for k, st in pairs(type(states) == 'table' and states or {}) do tvStates[tonumber(k)] = st end
  end)
end)

-- What a TV shows ---------------------------------------------------------------------------

local function sendDui(msg)
  if screen.dui and screen.ready then SendDuiMessage(screen.dui, json.encode(msg)) end
end

local function screenOn(id)
  local t = tvs[id]
  if not t or not t.v then return end
  if not tvTxd then tvTxd = CreateRuntimeTxd('as_computer_tv') end
  local dui = CreateDui(PC.tvPage or 'https://cfx-nui-as-browser/sites/presento/tv.html', 1920, 1080)
  local txn = ('tv_%d_%d'):format(id, GetGameTimer())
  CreateRuntimeTextureFromDuiHandle(tvTxd, txn, GetDuiHandle(dui))
  AddReplaceTexture(t.v.txd, t.v.txn, 'as_computer_tv', txn)
  local s = { tv = id, dui = dui, v = t.v, txn = txn, version = nil, ready = false }
  screen = s
  CreateThread(function()
    local timeout = GetGameTimer() + 10000
    while not IsDuiAvailable(dui) and GetGameTimer() < timeout do Wait(50) end
    Wait(400)
    if screen ~= s then return end
    s.ready = true
    local st = tvStates[id]
    if st then
      s.asked = st.version
      TriggerServerEvent('as-computer:server:tvSlides', id)
    end
  end)
end

RegisterNetEvent('as-computer:client:tvSlides', function(id, deck, version, slides)
  if screen.tv ~= id or not screen.ready then return end
  local st = tvStates[id]
  screen.version = version
  sendDui({ type = 'deck', slides = slides, slide = st and st.slide or 1, step = st and st.step or 0 })
end)

RegisterNetEvent('as-computer:client:tvState', function(id, st)
  tvStates[id] = st
  if screen.tv ~= id or not screen.ready then return end
  if not st then return sendDui({ type = 'idle' }) end
  if st.version ~= screen.version then
    if screen.asked ~= st.version then
      screen.asked = st.version
      TriggerServerEvent('as-computer:server:tvSlides', id)
    end
    return
  end
  sendDui({ type = 'go', slide = st.slide, step = st.step })
end)

-- Draw the nearest TV that is showing something (one at a time: the texture swap is per model).
CreateThread(function()
  while true do
    local p = GetEntityCoords(PlayerPedId())
    local best, bestD = nil, (PC.tvDrawDistance or 30.0)
    for id, st in pairs(tvStates) do
      local t = tvs[id]
      if st and t and t.obj and DoesEntityExist(t.obj) then
        local d = #(p - GetEntityCoords(t.obj))
        if d < bestD then best, bestD = id, d end
      end
    end
    if best ~= screen.tv then
      screenOff()
      if best then screenOn(best) end
    end
    Wait(750)
  end
end)

-- Clicker -----------------------------------------------------------------------------------

local function myTv()
  local me, p = GetPlayerServerId(PlayerId()), GetEntityCoords(PlayerPedId())
  local best, bestD = nil, (PC.tvRange or 20.0)
  for id, st in pairs(tvStates) do
    local t = tvs[id]
    if st and st.by == me and t and t.obj and DoesEntityExist(t.obj) then
      local d = #(p - GetEntityCoords(t.obj))
      if d <= bestD then best, bestD = id, d end
    end
  end
  return best
end

local clicker = PC.clicker or {}
if lib and lib.addKeybind then
  lib.addKeybind({
    name = 'as_computer_tv_next', description = L('tv_key_next'), defaultKey = clicker.next or 'PAGEDOWN',
    onPressed = function() local id = myTv(); if id then TriggerServerEvent('as-computer:server:tvStep', id, 1) end end,
  })
  lib.addKeybind({
    name = 'as_computer_tv_prev', description = L('tv_key_prev'), defaultKey = clicker.prev or 'PAGEUP',
    onPressed = function() local id = myTv(); if id then TriggerServerEvent('as-computer:server:tvStep', id, -1) end end,
  })
else
  RegisterCommand('+as_tv_next', function() local id = myTv(); if id then TriggerServerEvent('as-computer:server:tvStep', id, 1) end end, false)
  RegisterCommand('-as_tv_next', function() end, false)
  RegisterCommand('+as_tv_prev', function() local id = myTv(); if id then TriggerServerEvent('as-computer:server:tvStep', id, -1) end end, false)
  RegisterCommand('-as_tv_prev', function() end, false)
  RegisterKeyMapping('+as_tv_next', L('tv_key_next'), 'keyboard', clicker.next or 'PAGEDOWN')
  RegisterKeyMapping('+as_tv_prev', L('tv_key_prev'), 'keyboard', clicker.prev or 'PAGEUP')
end

-- /tvstop: stop what you are showing on the nearest TV.
RegisterCommand('tvstop', function()
  local id = myTv()
  if not id then return notify(L('tv_none_near'), 'error') end
  TriggerServerEvent('as-computer:server:tvStopMine', id)
  notify(L('tv_stopped'), 'success')
end, false)

-- ---------------------------------------------------------------------------------------------
-- The admin menu
-- ---------------------------------------------------------------------------------------------

local function gizmo(obj)
  local res = PC.gizmo or 'object_gizmo'
  if GetResourceState(res) ~= 'started' then notify(L('place_no_gizmo', res), 'error') return nil end
  local ok, err = pcall(function() return exports[res]:useGizmo(obj) end)
  if not ok then print(('^1[as-computer] object_gizmo failed: %s^0'):format(tostring(err))) return nil end
  if not DoesEntityExist(obj) then return nil end
  local pos, rot = GetEntityCoords(obj), GetEntityRotation(obj, 2)
  return { x = pos.x, y = pos.y, z = pos.z }, { x = rot.x, y = rot.y, z = rot.z }
end

local function splitJobs(s)
  local out = {}
  for j in tostring(s or ''):gmatch('[^,%s]+') do out[#out + 1] = j:lower() end
  return #out > 0 and out or nil
end

local function result(r, okKey)
  if r and r.ok then notify(L(okKey), 'success') else notify(L('notify_not_authorised'), 'error') end
end

local function tvSetup(title, label, jobs)
  local input = lib.inputDialog(title, {
    { type = 'input', label = L('place_name'), default = label or '' },
    { type = 'input', label = L('place_jobs'), description = L('place_jobs_hint'), default = jobs and table.concat(jobs, ', ') or '' },
  })
  if not input then return nil end
  return input[1], splitJobs(input[2])
end

local function place(kind, variant)
  local v = (kind == 'tv' and PC.tvs or PC.computers)[variant]
  if not v or not loadModel(v.prop) then return notify(L('place_bad_model'), 'error') end
  local ped = PlayerPedId()
  local c = GetOffsetFromEntityInWorldCoords(ped, 0.0, 1.6, 0.0)
  local obj = CreateObject(v.prop, c.x, c.y, c.z, false, false, false)
  SetEntityHeading(obj, GetEntityHeading(ped) + 180.0)
  FreezeEntityPosition(obj, true)
  SetModelAsNoLongerNeeded(v.prop)
  local pos, rot = gizmo(obj)
  if DoesEntityExist(obj) then DeleteEntity(obj) end
  if not pos then return end
  local label, jobs
  if kind == 'tv' then
    label, jobs = tvSetup(L('place_tv_setup'), v.label, nil)
    if label == nil then return end
  end
  MotCallback.Trigger('placement:add', function(r) result(r, 'place_saved') end,
    { kind = kind, variant = variant, pos = pos, rot = rot, label = label, jobs = jobs })
end

local function entryObject(e)
  if e.kind == 'tv' then return tvs[e.id] and tvs[e.id].obj end
  return placedLocs[e.id] and placedLocs[e.id].spawnedObject
end

local function allEntries()
  local out = {}
  for _, t in pairs(tvs) do out[#out + 1] = t.entry end
  for _, l in pairs(placedLocs) do out[#out + 1] = l.entry end
  return out
end

local openMenu

local function entryMenu(e, back)
  local obj = entryObject(e)
  local options = {
    { title = L('place_move'), icon = 'up-down-left-right', disabled = not obj, onSelect = function()
      local pos, rot = gizmo(obj)
      if pos then MotCallback.Trigger('placement:move', function(r) result(r, 'place_saved') end, { id = e.id, pos = pos, rot = rot }) end
    end },
    { title = e.kind == 'tv' and L('place_edit_tv') or L('place_rename'), icon = 'pen', onSelect = function()
      if e.kind == 'tv' then
        local label, jobs = tvSetup(L('place_edit_tv'), e.label, e.jobs)
        if label == nil then return end
        MotCallback.Trigger('placement:edit', function(r) result(r, 'place_saved') end, { id = e.id, label = label, jobs = jobs })
      else
        local input = lib.inputDialog(L('place_rename'), { { type = 'input', label = L('place_name'), default = e.label } })
        if input then MotCallback.Trigger('placement:edit', function(r) result(r, 'place_saved') end, { id = e.id, label = input[1] }) end
      end
    end },
    { title = L('place_goto'), icon = 'location-arrow', onSelect = function()
      SetEntityCoords(PlayerPedId(), e.pos.x, e.pos.y, e.pos.z + 1.0, false, false, false, false)
    end },
  }
  if e.kind == 'tv' and tvStates[e.id] then
    options[#options + 1] = { title = L('place_tv_clear'), description = tvStates[e.id].title, icon = 'power-off', onSelect = function()
      TriggerServerEvent('as-computer:server:tvStopMine', e.id)
    end }
  end
  options[#options + 1] = { title = L('place_delete'), icon = 'trash', iconColor = '#e03131', onSelect = function()
    local ok = lib.alertDialog({ header = L('place_delete'), content = L('place_delete_confirm', e.label), centered = true, cancel = true })
    if ok == 'confirm' then MotCallback.Trigger('placement:delete', function(r) result(r, 'place_deleted') end, e.id) end
  end }
  lib.registerContext({ id = 'asc_place_entry', title = ('%s #%d'):format(e.label, e.id), menu = back, options = options })
  lib.showContext('asc_place_entry')
end

local function listMenu(nearbyOnly)
  local p = GetEntityCoords(PlayerPedId())
  local rows = {}
  for _, e in ipairs(allEntries()) do
    local d = #(p - vec(e.pos))
    if not nearbyOnly or d <= 30.0 then rows[#rows + 1] = { e = e, d = d } end
  end
  table.sort(rows, function(a, b) return a.d < b.d end)
  local options = {}
  for _, r in ipairs(rows) do
    local e = r.e
    options[#options + 1] = {
      title = ('%s #%d'):format(e.label, e.id),
      description = ('%s · %.0f m%s'):format(e.kind == 'tv' and L('place_kind_tv') or L('place_kind_pc'), r.d,
        e.jobs and (' · ' .. table.concat(e.jobs, ', ')) or ''),
      icon = e.kind == 'tv' and 'tv' or 'computer',
      arrow = true,
      onSelect = function() entryMenu(e, nearbyOnly and 'asc_place_near' or 'asc_place_all') end,
    }
  end
  if #options == 0 then options[1] = { title = L('place_none'), disabled = true } end
  local id = nearbyOnly and 'asc_place_near' or 'asc_place_all'
  lib.registerContext({ id = id, title = nearbyOnly and L('place_nearby') or L('place_all'), menu = 'asc_place', options = options })
  lib.showContext(id)
end

openMenu = function()
  local function models(kind)
    local opts = {}
    for i, v in ipairs((kind == 'tv' and PC.tvs or PC.computers) or {}) do
      opts[#opts + 1] = { title = v.label, icon = kind == 'tv' and 'tv' or 'computer', onSelect = function() place(kind, i) end }
    end
    return opts
  end
  lib.registerContext({ id = 'asc_place_pc', title = L('place_computer'), menu = 'asc_place', options = models('computer') })
  lib.registerContext({ id = 'asc_place_tv', title = L('place_tv'), menu = 'asc_place', options = models('tv') })
  lib.registerContext({
    id = 'asc_place', title = L('place_title'),
    options = {
      { title = L('place_computer'), description = L('place_computer_desc'), icon = 'computer', menu = 'asc_place_pc' },
      { title = L('place_tv'), description = L('place_tv_desc'), icon = 'tv', menu = 'asc_place_tv' },
      { title = L('place_nearby'), icon = 'location-crosshairs', onSelect = function() listMenu(true) end },
      { title = L('place_all'), icon = 'list', onSelect = function() listMenu(false) end },
    },
  })
  lib.showContext('asc_place')
end

RegisterCommand(PC.command or 'placeprops', function()
  if not lib or not lib.registerContext then return print('^1[as-computer] /placeprops needs ox_lib^0') end
  MotCallback.Trigger('placement:can', function(r)
    if r and r.ok then openMenu() else notify(L('notify_not_authorised'), 'error') end
  end)
end, false)
TriggerEvent('chat:addSuggestion', '/' .. (PC.command or 'placeprops'), L('place_title'))

AddEventHandler('onResourceStop', function(res)
  if res ~= GetCurrentResourceName() then return end
  screenOff()
  for _, t in pairs(tvs) do if t.obj and DoesEntityExist(t.obj) then DeleteEntity(t.obj) end end
end)
