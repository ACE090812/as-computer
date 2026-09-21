-- Mail app (client side). The page's calls are passed to sd-phone's Mail callbacks as this player, after the server has
-- checked the player may use the app ('mailGate'). Needs ox_lib (sd-phone needs it too).

-- Only these sd-phone callbacks can be reached from the page.
local ALLOWED = {
  list = true, signIn = true, signOut = true, send = true, saveDraft = true, discardDraft = true,
  markRead = true, toggleFlag = true, moveToBin = true, move = true,
}

--- sd-phone answers { success, data | message, messageKey }; the page gets { ok, data | message }.
local function Normalise(res)
  if type(res) ~= 'table' then return { ok = false, reason = 'error' } end
  if res.success == true then return { ok = true, data = res.data } end
  return { ok = false, reason = 'error', message = res.message }
end

RegisterNUICallback('mailApi', function(data, cb)
  data = data or {}
  local name = data.name
  if type(name) ~= 'string' or not ALLOWED[name] then return cb({ ok = false, reason = 'invalid' }) end
  local payload = type(data.data) == 'table' and data.data or {}
  MotCallback.Trigger('mailGate', function(gate)
    if not (gate and gate.ok) then return cb({ ok = false, reason = (gate and gate.reason) or 'not_authorised' }) end
    CreateThread(function()
      local ok, res = pcall(function()
        if name == 'list' then return lib.callback.await('sd-phone:server:mail:list', false) end
        return lib.callback.await('sd-phone:server:mail:' .. name, false, payload)
      end)
      if not ok then return cb({ ok = false, reason = 'unavailable' }) end
      cb(Normalise(res))
    end)
  end)
end)

-- New mail for this character: sd-phone shows the banner on the phone, this refreshes the open computer.
RegisterNetEvent('sd-phone:client:mail:received', function(message)
  if type(message) ~= 'table' then return end
  SendNuiMessage(json.encode({ action = 'mailReceived', message = message }))
end)
