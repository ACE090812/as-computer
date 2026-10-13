-- Admin panel (client side): /pcadmin opens ui/admin.js's window. The page only asks; the server checks
-- Bridge.IsAdmin on every call. Teleport / place / move happen here because they need the game world.

local AD = Config.Admin or {}
if AD.enabled == false then return end

local open = false

local function notify(msg, kind) Bridge.Notify(msg, kind or 'inform') end

local function show(refreshMs)
  open = true
  SetNuiFocus(true, true)
  SendNuiMessage(json.encode({ action = 'adminOpen', refreshMs = refreshMs, strings = LocaleTable() }))
end

local function hide()
  if not open then return end
  open = false
  SetNuiFocus(false, false)
  SendNuiMessage(json.encode({ action = 'adminClose' }))
end

RegisterCommand(AD.command or 'pcadmin', function()
  if open then return hide() end
  MotCallback.Trigger('admin:can', function(r)
    if r and r.ok then show(r.refreshMs) else notify(L('notify_not_authorised'), 'error') end
  end)
end, false)
TriggerEvent('chat:addSuggestion', '/' .. (AD.command or 'pcadmin'), L('admin_title'))

RegisterNUICallback('adminClose', function(_, cb) hide() cb('ok') end)

local ALLOWED = {
  snapshot = 'admin:snapshot', lock = 'admin:lock', kick = 'admin:kick', reset = 'admin:reset',
  propAdd = 'admin:propAdd', propRemove = 'admin:propRemove',
  games = 'admin:games', gamesToggle = 'admin:gamesToggle', gamesReset = 'admin:gamesReset', casino = 'admin:casino',
  delete = 'placement:delete', edit = 'placement:edit',
}

RegisterNUICallback('adminApi', function(data, cb)
  data = type(data) == 'table' and data or {}
  local cbName = ALLOWED[data.name]
  if not cbName then return cb({ ok = false, reason = 'invalid' }) end
  MotCallback.Trigger(cbName, function(res)
    if type(res) ~= 'table' then res = { ok = false, reason = 'error' } end
    cb(res)
  end, data.data)
end)

RegisterNUICallback('adminTeleport', function(data, cb)
  data = type(data) == 'table' and data or {}
  local x, y, z = tonumber(data.x), tonumber(data.y), tonumber(data.z)
  if x and y and z then
    local ped = PlayerPedId()
    SetEntityCoords(ped, x + 0.0, y + 0.0, z + 1.0, false, false, false, false)
  end
  cb('ok')
end)

--- Runs a gizmo job (place / move) with the panel hidden, then brings the panel back.
local function withPanelHidden(job)
  hide()
  CreateThread(function()
    Wait(150)
    job()
    Wait(150)
    MotCallback.Trigger('admin:can', function(r) if r and r.ok then show(r.refreshMs) end end)
  end)
end

RegisterNUICallback('adminPlace', function(data, cb)
  data = type(data) == 'table' and data or {}
  cb('ok')
  if not PlacementApi then return end
  local kind, variant = tostring(data.kind or ''), math.floor(tonumber(data.variant) or 0)
  if kind ~= 'computer' and kind ~= 'tv' and kind ~= 'printer' and kind ~= 'prop' then return end
  withPanelHidden(function()
    PlacementApi.place(kind, variant, tostring(data.model or ''), tostring(data.label or ''))
  end)
end)

RegisterNUICallback('adminMove', function(data, cb)
  data = type(data) == 'table' and data or {}
  cb('ok')
  if not PlacementApi then return end
  local id = math.floor(tonumber(data.id) or 0)
  withPanelHidden(function() PlacementApi.move(id) end)
end)

AddEventHandler('onResourceStop', function(res)
  if res == GetCurrentResourceName() and open then SetNuiFocus(false, false) end
end)
