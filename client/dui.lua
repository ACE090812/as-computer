--[[
  How this fits together
  -----------------------
  A DUI (CreateDui) renders an HTML page to an off-screen buffer that you can
  then push onto a 3D prop's texture. That gives you the "screen showing the
  website" look in the world — but a world-space texture cannot receive mouse
  clicks from the player, only a focused 2D NUI overlay can.

  So this resource runs the SAME ui/index.html twice, for two different jobs:
    1. One DUI per terminal prop, always running, replacing that prop's
       screen texture — this is what other players see when they walk past
       (shows the "lookup" screen idling, or whatever it was last on).
    2. A normal focused NUI overlay (SendNuiMessage / SetNuiFocus), opened
       only for the player who targets the terminal — this is what they
       actually click and type into.

  When the interacting player changes screens/state, we mirror that state to
  the ambient DUI too (via postToClient -> server -> back down, or simplest:
  just keep the DUI and the focused NUI in sync locally since both read the
  same index.html and both live client-side for this player).
--]]

local activeDuis = {}   -- [location index] = { dui, duiHandle, txd, runtimeTxt }
local currentTerminal = nil -- location table of the terminal currently focused, or nil
local nuiSessionKey = nil   -- which computer the windows in the (hidden) NUI belong to, so they can be resumed there

--- Is this client sitting at that computer right now? (client/mirror.lua doesn't draw over your own screen)
function IsUsingComputer(key)
  return currentTerminal ~= nil and currentTerminal.key == key
end

-- Sent to both the focused NUI and every ambient DUI.
local function LocalePayload(lang)
  return json.encode({ action = 'setLocale', strings = LocaleTable(lang) })
end

local function ChecklistPayload()
  return json.encode({ action = 'setChecklist', sections = Config.Checklist })
end

-- loc.txd may be one name or a list (see config). The list form lets the swap
-- hit the texture whether it resolves via the model's own dictionary or via
-- the archetype's shared texture dictionary.
local function TxdList(loc)
  if type(loc.txd) == 'table' then return loc.txd end
  return { loc.txd }
end

local duiByTexture = {}  -- 'txd|txn' -> key: the swap is per model texture, so one DUI per monitor model is enough

local function CreateTerminalDui(loc, index)
  local texKey = TxdList(loc)[1] .. '|' .. tostring(loc.txn)
  if duiByTexture[texKey] then return end
  duiByTexture[texKey] = index

  -- ?dui=1 tells the page it's the world texture: always visible, no overlay/scaling.
  local url = ('nui://%s/ui/index.html?dui=1'):format(GetCurrentResourceName())
  local dui = CreateDui(url, Config.DuiWidth, Config.DuiHeight)
  local duiHandle = GetDuiHandle(dui)

  local txdName = ('as_computer_txd_%s'):format(tostring(index))
  local txnName = ('as_computer_tex_%s'):format(tostring(index))
  local runtimeTxd = CreateRuntimeTxd(txdName)
  local runtimeTxt = CreateRuntimeTextureFromDuiHandle(runtimeTxd, txnName, duiHandle)

  -- Swap the prop's original screen texture for our live one.
  for _, txd in ipairs(TxdList(loc)) do
    AddReplaceTexture(txd, loc.txn, txdName, txnName)
  end

  activeDuis[index] = { dui = dui, duiHandle = duiHandle, runtimeTxt = runtimeTxt, txds = TxdList(loc), txn = loc.txn }

  -- Wait for the page to load, then give the DUI its strings + checklist.
  CreateThread(function()
    local timeout = GetGameTimer() + 10000
    while not IsDuiAvailable(dui) and GetGameTimer() < timeout do Wait(50) end
    Wait(300)
    SendDuiMessage(dui, LocalePayload())
    SendDuiMessage(dui, ChecklistPayload())
  end)
end

local AddTarget -- defined further down

--- Spawns one terminal: its DUI (once per monitor model), the prop and its target zone.
--- `key` is the Config.Locations index, or 'p<id>' for a computer placed with /placeprops (client/placement.lua).
--- loc.rot (vector3) is used when present (placed props), otherwise loc.heading.
function SpawnComputer(loc, key)
    loc.key = type(key) == 'number' and ('c' .. key) or tostring(key)
    -- The texture swap must exist BEFORE the model loads: replacements are
    -- resolved when the drawable's textures are set up, not on every draw.
    CreateTerminalDui(loc, key)

    local timeout = GetGameTimer() + 10000
    repeat
      RequestModel(loc.prop) -- re-requested each pass in case the first request was dropped
      Wait(100)
    until HasModelLoaded(loc.prop) or GetGameTimer() > timeout

    if not HasModelLoaded(loc.prop) then
      print(('^1[as-computer] "%s": model failed to load (IsModelInCdimage=%s). Streaming is stuck on a dependency: the archetype texture dictionary (lgmods_sinnertextures.ytd) must exist in stream/. Restart the resource AND reconnect.^0'):format(loc.label, tostring(IsModelInCdimage(loc.prop))))
      -- Which texture dictionaries actually stream to this client?
      -- "not found" for lgmods_sinnertextures = the file never reached the client (run `refresh`, restart, reconnect).
      for _, name in ipairs({ 'lgmods_sinnertextures', 'lgmods_sinner_monitor' }) do
        RequestStreamedTextureDict(name, false)
        local t = GetGameTimer() + 4000
        while not HasStreamedTextureDictLoaded(name) and GetGameTimer() < t do Wait(50) end
        print(('[as-computer] txd %s: %s'):format(name, HasStreamedTextureDictLoaded(name) and 'LOADED' or 'NOT FOUND'))
      end
    else
      -- If you're placing the prop yourself (mapped/ymap) you don't need to
      -- CreateObject here — just call CreateTerminalDui once the mapped prop
      -- exists. This example spawns it for a self-contained resource.
      local obj = CreateObject(loc.prop, loc.coords.x, loc.coords.y, loc.coords.z, false, false, false)
      if obj == 0 or not DoesEntityExist(obj) then
        print(('^1[as-computer] "%s": CreateObject failed^0'):format(loc.label))
      else
        if loc.rot then
          SetEntityCoordsNoOffset(obj, loc.coords.x, loc.coords.y, loc.coords.z, false, false, false)
          SetEntityRotation(obj, loc.rot.x, loc.rot.y, loc.rot.z, 2, false)
        else
          SetEntityHeading(obj, loc.heading)
        end
        FreezeEntityPosition(obj, true)
        loc.spawnedObject = obj
        SetModelAsNoLongerNeeded(loc.prop)
        if Config.Debug then
          print(('[as-computer] "%s": spawned at %s'):format(loc.label, tostring(loc.coords)))
        end
        if AddTarget and Config.Interaction ~= 'key' then AddTarget(loc, key) end
      end
    end
end

--- Removes a spawned terminal (placed computers being moved or deleted). Its model's DUI stays.
function DespawnComputer(loc)
  if loc.targetZone then
    if loc.targetZone.ox then pcall(function() exports.ox_target:removeZone(loc.targetZone.ox) end) end
    if loc.targetZone.qb then pcall(function() exports['qb-target']:RemoveZone(loc.targetZone.qb) end) end
    loc.targetZone = nil
  end
  if loc.spawnedObject and DoesEntityExist(loc.spawnedObject) then DeleteEntity(loc.spawnedObject) end
  loc.spawnedObject = nil
end

CreateThread(function()
  for i, loc in ipairs(Config.Locations) do
    SpawnComputer(loc, i)
  end
end)

local OpenTerminal, CloseTerminal -- defined below; declared here so commands / threads above can call them

-- ---- Debug helpers (Config.Debug) ------------------------------------------
-- /computer_coords : prints your position + heading, ready to paste into Config.Locations
-- /computer_goto   : teleports you next to the first configured terminal
if Config.Debug then
  RegisterCommand('computer_coords', function()
    local ped = PlayerPedId()
    local c, h = GetEntityCoords(ped), GetEntityHeading(ped)
    local line = ('coords = vector3(%.2f, %.2f, %.2f), heading = %.1f,'):format(c.x, c.y, c.z, h)
    print('[as-computer] ' .. line)
    Bridge.Notify(line, 'inform')
  end, false)

  -- /computer_open : opens the terminal at the nearest location (within 5m), bypassing
  -- the target system - use it to tell "target problem" from "terminal problem".
  RegisterCommand('computer_open', function()
    local p = GetEntityCoords(PlayerPedId())
    local best, bestDist
    for _, loc in ipairs(Config.Locations) do
      local d = #(p - loc.coords)
      if not bestDist or d < bestDist then best, bestDist = loc, d end
    end
    if best and bestDist < 5.0 then
      OpenTerminal(best)
    else
      print('[as-computer] /computer_open: no terminal within 5m')
    end
  end, false)

  RegisterCommand('computer_goto', function()
    local loc = Config.Locations[1]
    if not loc then return end
    SetEntityCoords(PlayerPedId(), loc.coords.x, loc.coords.y, loc.coords.z + 1.0, false, false, false, false)
  end, false)
end

-- ---- Target interaction --------------------------------------------------
-- Registers BOTH ox_target and qb-target so either can be installed;
-- whichever resource is actually running will pick up the option it understands.

-- ---- On-monitor presentation --------------------------------------------------
-- The terminal page is a focused NUI (so mouse AND keyboard work), but instead
-- of covering the whole screen it is scaled and positioned exactly over the
-- monitor's screen while a scripted camera frames the monitor head-on.
-- loc.screen (see config): offset/size of the screen surface in the prop's local space.

local terminalCam = nil

local function ScreenCfg(loc)
  if Config.UseCamera == false then return nil end
  if not loc.screen or not loc.spawnedObject or not DoesEntityExist(loc.spawnedObject) then return nil end
  return loc.screen
end

local function StartScreenCam(loc)
  local scr = loc.screen
  local obj = loc.spawnedObject
  local off = scr.offset
  local front = scr.front or -1 -- which local-Y direction the screen faces (-1 or 1)
  local cam = scr.cam or {}
  local dist = cam.dist or 0.85

  local pos = GetOffsetFromEntityInWorldCoords(obj, off.x, off.y + front * dist, off.z)
  local tgt = GetOffsetFromEntityInWorldCoords(obj, off.x, off.y, off.z)
  local c = CreateCamWithParams('DEFAULT_SCRIPTED_CAMERA', pos.x, pos.y, pos.z, 0.0, 0.0, 0.0, cam.fov or 35.0, false, 2)
  PointCamAtCoord(c, tgt.x, tgt.y, tgt.z)
  SetCamActive(c, true)
  RenderScriptCams(true, true, 600, true, false)
  return c
end

local function StopScreenCam()
  if terminalCam then
    RenderScriptCams(false, true, 500, true, false)
    DestroyCam(terminalCam, false)
    terminalCam = nil
  end
  FreezeEntityPosition(PlayerPedId(), false)
end

-- Projects the screen's four corners to 0-1 screen space -> { x, y, w, h } or nil.
local function ProjectScreenRect(loc)
  local scr, obj = loc.screen, loc.spawnedObject
  local off = scr.offset
  local hw, hh = scr.size.x / 2, scr.size.y / 2
  local minx, miny, maxx, maxy = 2.0, 2.0, -1.0, -1.0
  for _, c in ipairs({ { -hw, hh }, { hw, hh }, { hw, -hh }, { -hw, -hh } }) do
    local w = GetOffsetFromEntityInWorldCoords(obj, off.x + c[1], off.y, off.z + c[2])
    local ok, sx, sy = GetScreenCoordFromWorldCoord(w.x, w.y, w.z)
    if not ok then return nil end
    minx, miny = math.min(minx, sx), math.min(miny, sy)
    maxx, maxy = math.max(maxx, sx), math.max(maxy, sy)
  end
  local w, h = maxx - minx, maxy - miny
  local b = scr.bleed or 0.0
  return { x = minx - w * b, y = miny - h * b, w = w * (1.0 + 2.0 * b), h = h * (1.0 + 2.0 * b) }
end

-- Scout is offered only while the as-browser resource is running.
function BrowserAvailable()
  local b = Config.Browser
  return b ~= nil and b.enabled == true and GetResourceState(b.resource or 'as-browser') == 'started'
end

local function OpenMessage(loc, rect, user, info, session)
  return json.encode({
    action = 'open',
    resume = session and session.resume or false,  -- same player, same computer, nobody else since: keep the open apps
    mirror = (Config.Mirror and Config.Mirror.enabled ~= false and loc.screen and loc.mirror ~= false) and {
      interval = Config.Mirror.interval or 1000, width = Config.Mirror.width or 960, quality = Config.Mirror.quality or 0.6,
    } or false,                                     -- live view: the page sends a picture of itself about once a second
    locked = session and session.locked or false,
    rect   = rect,
    debug  = Config.DebugScreen and true or false,
    user   = user,                                  -- name shown on the lock screen / start menu
    lock   = Config.LockScreen ~= false,            -- show the lock screen before the desktop
    lockPassword = info and info.hasPassword or false, -- character has a sign-in password set (Settings > Accounts)
    print  = Config.PrintEvent ~= nil,              -- enables the Print button on certificates
    manageOthers = Config.ManageOthers == true,     -- may rename/delete other testers' certificates
    calendar = Config.Calendar and Config.Calendar.enabled ~= false and { weekStart = Config.Calendar.weekStart or 1 } or false,
    browser = BrowserAvailable(),                   -- Scout app (needs the as-browser resource)
    apps   = info and info.apps or nil,             -- { [appId] = bool }: which apps this job has (Store installs)
    store  = not (Config.Store and Config.Store.enabled == false), -- show the Store app
    prefs  = info and info.prefs or nil,            -- this character's Settings (wallpaper, theme, clock ...)
    internet = BrowserAvailable(),
  })
end

function OpenTerminal(loc)
  if Config.Debug and Bridge.DebugInfo then
    local fw, job = Bridge.DebugInfo()
    print(('[as-computer] OpenTerminal: framework=%s job=%s (need one of: %s)'):format(fw, job, table.concat(Bridge.JobsFor(loc), ', ')))
  end
  if currentTerminal then return end
  if not Bridge.HasComputerJob(loc) then
    Bridge.Notify(L('notify_no_job'), 'error')
    return
  end

  currentTerminal = loc
  CreateThread(function()
    local userName = nil
    MotCallback.Trigger('whoami', function(r) userName = (r and r.name) or false end)
    local appsInfo = nil
    MotCallback.Trigger('appsInfo', function(r) appsInfo = r or false end)
    local session = nil
    MotCallback.Trigger('session:open', function(r) session = r or false end, loc.key)

    local rect = nil
    if ScreenCfg(loc) then
      FreezeEntityPosition(PlayerPedId(), true)
      terminalCam = StartScreenCam(loc)
      Wait(700) -- let the camera finish moving before measuring the screen
      if currentTerminal ~= loc then return end -- closed while the camera was moving
      rect = ProjectScreenRect(loc)
      if Config.Debug then
        print(('[as-computer] screen rect: %s'):format(rect and json.encode(rect) or 'nil (screen not visible - falling back to fullscreen)'))
      end
    end

    -- the name normally arrives long before the camera finishes; cap the wait anyway
    local nameTimeout = GetGameTimer() + 1500
    while (userName == nil or appsInfo == nil or session == nil) and GetGameTimer() < nameTimeout do Wait(50) end
    if currentTerminal ~= loc then return end
    -- Resume only if the apps still in this client's page are from this very computer.
    if session and not (session.resume and nuiSessionKey == loc.key) then session = { resume = false } end
    nuiSessionKey = loc.key

    SetNuiFocus(true, true)
    SendNuiMessage(LocalePayload(appsInfo and appsInfo.prefs and appsInfo.prefs.lang or nil))
    SendNuiMessage(ChecklistPayload())
    SendNuiMessage(OpenMessage(loc, rect, userName or '', appsInfo or nil, session or nil))

    -- Keep the player out of the shot and close if they die.
    while currentTerminal == loc do
      SetEntityLocallyInvisible(PlayerPedId())
      if IsEntityDead(PlayerPedId()) then CloseTerminal() break end
      Wait(0)
    end
  end)
end

--- off = true when the player chose Shut down: the session ends and the next open starts fresh.
--- Otherwise (Esc, walking away, dying) the apps stay open for when they come back to this computer.
function CloseTerminal(off)
  if not currentTerminal then return end
  local loc = currentTerminal
  SetNuiFocus(false, false)
  SendNuiMessage(json.encode({ action = 'close', keep = not off })) -- hides the overlay
  StopScreenCam()
  currentTerminal = nil
  if off then
    nuiSessionKey = nil
    if loc.key then TriggerServerEvent('as-computer:server:session', loc.key, 'off') end
  end
end

-- Live framing (Config.Debug): /computer_screen [dx] [dz] [width] [height] [dist] [fov] [front]
-- Adjusts the first location's screen rect / camera and reopens the terminal so you can see it.
-- Prints the matching config line. Set Config.DebugScreen = true to outline the projected rect.
if Config.Debug then
  RegisterCommand('computer_screen', function(_, args)
    local loc = Config.Locations[1]
    if not loc or not loc.screen then return end
    local sc = loc.screen
    local cam = sc.cam or {}
    local n = function(i, d) return tonumber(args[i]) or d end
    sc.offset = vector3(n(1, sc.offset.x), sc.offset.y, n(2, sc.offset.z))
    sc.size   = vector2(n(3, sc.size.x), n(4, sc.size.y))
    sc.cam    = { dist = n(5, cam.dist or 0.85), fov = n(6, cam.fov or 35.0) }
    sc.front  = n(7, sc.front or -1)
    print(('screen = { offset = vector3(%.3f, %.3f, %.3f), size = vector2(%.3f, %.3f), bleed = %.3f, front = %d, cam = { dist = %.2f, fov = %.1f } },'):format(
      sc.offset.x, sc.offset.y, sc.offset.z, sc.size.x, sc.size.y, sc.bleed or 0.0, sc.front, sc.cam.dist, sc.cam.fov))
    if currentTerminal then CloseTerminal() Wait(800) end
    OpenTerminal(loc)
  end, false)
end

-- Server reason code -> locale key (see server/main.lua)
local reasonKeys = {
  not_authorised = 'notify_not_authorised',
  empty          = 'notify_empty_plate',
  no_vehicle     = 'notify_no_vehicle',
  incomplete     = 'notify_incomplete',
  notes_required = 'notify_notes_required',
  not_yours      = 'notify_not_yours',
  invalid        = 'notify_cal_invalid',
  not_found      = 'notify_cal_missing',
  not_boss       = 'notify_store_boss',
  not_for_job    = 'notify_store_job',
  no_funds       = 'notify_store_funds',
  no_bank        = 'notify_store_bank',
  bad_url        = 'notify_settings_url',
}

local function NotifyFailure(result)
  local key = result and reasonKeys[result.reason] or 'notify_error'
  Bridge.Notify(L(key), 'error')
end

RegisterNUICallback('close', function(data, cb)
  CloseTerminal(type(data) == 'table' and data.off == true)
  cb('ok')
end)

-- Live view: a picture of the screen from ui/app.js, passed to the server for players nearby (server/mirror.lua).
RegisterNUICallback('mirrorFrame', function(data, cb)
  cb('ok')
  local m = Config.Mirror or {}
  local frame = type(data) == 'table' and data.data
  if m.enabled == false or not currentTerminal or not currentTerminal.key or type(frame) ~= 'string' then return end
  if #frame > (m.maxBytes or 250000) then return end
  TriggerLatentServerEvent('as-computer:server:mirrorFrame', m.bps or 200000, currentTerminal.key, frame)
end)

-- Lock screen shown / signed in: remembered on the server so a resumed session opens locked or not.
RegisterNUICallback('sessionState', function(data, cb)
  cb('ok')
  local st = type(data) == 'table' and data.state
  if currentTerminal and currentTerminal.key and (st == 'locked' or st == 'active') then
    TriggerServerEvent('as-computer:server:session', currentTerminal.key, st)
  end
end)

-- Spawn name (or a bare numeric model hash - see server/bridge.lua's Bridge.VehicleModelLabel on
-- esx) -> in-game display name (falls back to the raw model string)
local function ModelLabel(model)
  if not model or model == '' then return model end
  local hash = tostring(model):match('^%d+$') and tonumber(model) or joaat(model)
  local display = GetDisplayNameFromVehicleModel(hash)
  local label = display and display ~= 'CARNOTFOUND' and GetLabelText(display)
  if label and label ~= 'NULL' then return label end
  return model
end

RegisterNUICallback('lookupVehicle', function(data, cb)
  MotCallback.Trigger('lookupVehicle', function(result)
    if result and result.found then
      result.model = ModelLabel(result.model)
    else
      NotifyFailure(result)
    end
    cb(result)
    SendNuiMessage(json.encode({ action = 'lookupResult', result = result }))
  end, data.plate)
end)

RegisterNUICallback('submitInspection', function(data, cb)
  -- data = { plate = "LX19KTP", results = {...}, mileage = <manual entry or nil> }
  -- Server prefers jg-vehiclemileage's live reading over this if it's installed.
  local locationLabel = currentTerminal and currentTerminal.label or nil

  MotCallback.Trigger('submitInspection', function(result)
    if result and result.ok then
      Bridge.Notify(L(result.passed and 'notify_saved_pass' or 'notify_saved_fail', result.testNumber), result.passed and 'success' or 'error')
    else
      NotifyFailure(result)
    end
    cb(result)
    SendNuiMessage(json.encode({ action = 'submitResult', result = result }))
  end, data.plate, data.results, data.mileage, locationLabel, data.notes)
end)

-- File Explorer: every stored certificate. Answers the NUI callback AND pushes a
-- 'certificates' message (the page listens for the message).
RegisterNUICallback('listCertificates', function(_, cb)
  MotCallback.Trigger('listCertificates', function(result)
    if result and result.ok then
      for _, item in ipairs(result.items or {}) do item.model = ModelLabel(item.model) end
    end
    cb('ok')
    SendNuiMessage(json.encode({ action = 'certificates', result = result or { ok = false } }))
  end)
end)

-- File Explorer actions (delete to bin / restore / empty bin / rename). The server checks the
-- job and ownership; the page re-syncs itself from the 'certActionResult' message.
local function CertActionCallback(name, ...)
  local extra = { ... }
  RegisterNUICallback(name, function(data, cb)
    cb('ok')
    local args = {}
    for i, key in ipairs(extra) do args[i] = data[key] end
    MotCallback.Trigger(name, function(result)
      if not (result and result.ok) then NotifyFailure(result) end
      SendNuiMessage(json.encode({ action = 'certActionResult', result = result or { ok = false } }))
    end, table.unpack(args, 1, #extra))
  end)
end
CertActionCallback('certDelete',  'list')
CertActionCallback('certRestore', 'list')
CertActionCallback('certPurge',   'list')
CertActionCallback('certRename',  'testNumber', 'name')

-- Scout: forwards a request from the page to the server, which passes it to as-browser.
-- data = { name, a, b, c }; the result goes straight back to the page as the NUI reply.
RegisterNUICallback('browserApi', function(data, cb)
  data = data or {}
  MotCallback.Trigger('browserApi', function(result) cb(result) end, data.name, data.a, data.b, data.c)
end)

-- Calendar app: { name = 'list' | 'save' | 'delete', data = {...} } -> server -> NUI reply.
RegisterNUICallback('calendarApi', function(data, cb)
  data = data or {}
  MotCallback.Trigger('calendarApi', function(result)
    if result and not result.ok then NotifyFailure(result) end
    cb(result)
  end, data.name, data.data)
end)

-- A boss installed / removed an app for this job: refresh the open desktop.
RegisterNetEvent('as-computer:client:appsChanged', function()
  if not currentTerminal then return end
  MotCallback.Trigger('appsInfo', function(r)
    if r and currentTerminal then SendNuiMessage(json.encode({ action = 'apps', apps = r.apps })) end
  end)
end)

-- Settings app: read-only info for the pages, and saving personal settings.
RegisterNUICallback('settingsInfo', function(_, cb)
  local idx = 1
  for i, l in ipairs(Config.Locations) do if l == currentTerminal then idx = i end end
  MotCallback.Trigger('settingsInfo', function(result) cb(result or { ok = false }) end, idx)
end)

RegisterNUICallback('settingsApi', function(data, cb)
  data = data or {}
  MotCallback.Trigger('settingsApi', function(result)
    if result and not result.ok then NotifyFailure(result) end
    if result and result.ok and result.prefs and data.data and data.data.lang then
      SendNuiMessage(LocalePayload(result.prefs.lang))   -- language changed: send the new strings
    end
    cb(result or { ok = false })
  end, data.name, data.data)
end)

-- Store app: { name = 'list' | 'install' | 'uninstall', id = appId } -> server -> NUI reply.
RegisterNUICallback('storeApi', function(data, cb)
  data = data or {}
  MotCallback.Trigger('storeApi', function(result)
    if result and not result.ok then NotifyFailure(result) end
    cb(result)
  end, data.name, { id = data.id })
end)

-- Print button on a certificate. Stage 3 (the printer script) hooks in here:
-- set Config.PrintEvent to a client event name and it receives the certificate table.
RegisterNUICallback('printCertificate', function(data, cb)
  cb('ok')
  if not Config.PrintEvent then return end
  TriggerEvent(Config.PrintEvent, data)
  Bridge.Notify(L('notify_print_sent'), 'success')
end)

-- Box zone centred on the SCREEN (offset from the spawned prop), deep enough
-- that it still catches the crosshair if the ray passes through the prop and
-- lands on the wall behind it. Size/offset are per-location in the config.
-- Config.Debug draws the zone (ox_target) so you can see it.
AddTarget = function(loc, i)
    local obj = loc.spawnedObject

    if obj and DoesEntityExist(obj) then
      local size   = loc.target and loc.target.size   or vector3(1.3, 1.3, 1.0)
      local offset = loc.target and loc.target.offset or vector3(0.0, -0.02, 0.33)
      local center = GetOffsetFromEntityInWorldCoords(obj, offset.x, offset.y, offset.z)
      local heading = GetEntityHeading(obj)

      if GetResourceState('ox_target') == 'started' then
        loc.targetZone = { ox = exports.ox_target:addBoxZone({
          coords = center,
          size = size,
          rotation = heading,
          debug = Config.DebugZone and true or false,
          options = {
            {
              name = ('as_computer_%s'):format(tostring(i)),
              label = L('terminal_target'),
              icon = 'fa-solid fa-computer',
              distance = 2.0,
              onSelect = function()
                if Config.Debug then print('[as-computer] target: onSelect fired') end
                OpenTerminal(loc)
              end,
            },
          },
        }) }
      elseif GetResourceState('qb-target') == 'started' then
        loc.targetZone = { qb = ('as_computer_%s'):format(tostring(i)) }
        exports['qb-target']:AddBoxZone(('as_computer_%s'):format(tostring(i)), center, size.x, size.y, {
          name = ('as_computer_%s'):format(tostring(i)),
          heading = heading,
          minZ = center.z - size.z / 2,
          maxZ = center.z + size.z / 2,
        }, {
          options = {
            {
              icon = 'fa-solid fa-computer',
              label = L('terminal_target'),
              action = function() OpenTerminal(loc) end,
            },
          },
          distance = 2.0,
        })
      else
        print('^1[as-computer] neither ox_target nor qb-target is started - terminal cannot be targeted^0')
      end
    end
end

-- ---- Key interaction ---------------------------------------------------------
-- Walk up to the screen, press Config.InteractKey. Independent of any target
-- resource. Cheap when idle (checks twice a second), per-frame only when close.
CreateThread(function()
  if Config.Interaction == 'target' then return end
  local key = Config.InteractKey or 38
  local maxDist = Config.InteractDistance or 1.8

  while true do
    local wait = 500
    if not currentTerminal then
      local ped = PlayerPedId()
      local p = GetEntityCoords(ped)
      for _, loc in ipairs(Config.Locations) do
        local obj = loc.spawnedObject
        if obj and DoesEntityExist(obj) then
          local off = loc.target and loc.target.offset or vector3(0.0, -0.02, 0.33)
          local screen = GetOffsetFromEntityInWorldCoords(obj, off.x, off.y, off.z)
          if #(p - screen) < maxDist and not IsPedInAnyVehicle(ped, false) then
            wait = 0
            BeginTextCommandDisplayHelp('STRING')
            AddTextComponentSubstringPlayerName(L('terminal_prompt'))
            EndTextCommandDisplayHelp(0, false, true, -1)
            if IsControlJustReleased(0, key) then OpenTerminal(loc) end
            break
          end
        end
      end
    end
    Wait(wait)
  end
end)

-- ESC is handled inside the page while NUI has focus (key mappings don't fire
-- then) — it posts 'close' above. This just makes sure a restart can't leave
-- the player stuck with focus or leave orphaned props/DUIs behind.
AddEventHandler('onResourceStop', function(resource)
  if resource ~= GetCurrentResourceName() then return end
  SetNuiFocus(false, false)
  StopScreenCam()
  for _, d in pairs(activeDuis) do
    for _, txd in ipairs(d.txds or {}) do RemoveReplaceTexture(txd, d.txn) end
    DestroyDui(d.dui)
  end
  for _, loc in ipairs(Config.Locations) do
    if loc.spawnedObject then DeleteEntity(loc.spawnedObject) end
  end
end)
