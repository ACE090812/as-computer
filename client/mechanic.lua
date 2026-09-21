-- Mechanic app (client side): the page's server calls, plus the two things that need the player's own screen:
-- notifications from the app and the "accept this card payment?" prompt.

--- Spawn name -> in-game display name (falls back to the raw model string).
local function ModelLabel(model)
  if not model or model == '' then return model end
  local display = GetDisplayNameFromVehicleModel(joaat(model))
  local label = display and display ~= 'CARNOTFOUND' and GetLabelText(display)
  if label and label ~= 'NULL' then return label end
  return model
end

-- { name = 'jobs.list', data = {...} } -> server -> NUI reply. Errors are shown by the page itself.
RegisterNUICallback('mechanicApi', function(data, cb)
  data = data or {}
  MotCallback.Trigger('mechanicApi', function(result)
    if type(result) == 'table' and result.model then result.model = ModelLabel(result.model) end
    if type(result) == 'table' and type(result.info) == 'table' and result.info.model then
      result.info.model = ModelLabel(result.info.model)
      result.model = result.info.model
    end
    cb(result or { ok = false, reason = 'error' })
  end, data.name, data.data)
end)

RegisterNetEvent('as-computer:client:mechanicNotify', function(msg)
  Bridge.Notify(tostring(msg or ''), 'inform')
end)

-- "Pay INV-0001 (£120) to Vinewood Auto Centre? [Y] Pay  [N] Decline" for `seconds`.
local prompting = false

RegisterNetEvent('as-computer:client:mechanicPayPrompt', function(token, info)
  if prompting then
    TriggerServerEvent('as-computer:server:mechanicPayReply', token, false)
    return
  end
  prompting = true
  info = info or {}
  local endsAt = GetGameTimer() + (tonumber(info.seconds) or 30) * 1000
  local line = L('mx_pay_prompt', tostring(info.ref or ''), tostring(info.symbol or '£') .. tostring(info.amount or 0), tostring(info.business or ''))
  Bridge.Notify(line, 'inform')
  CreateThread(function()
    local answered = false
    while GetGameTimer() < endsAt and not answered do
      BeginTextCommandDisplayHelp('STRING')
      AddTextComponentSubstringPlayerName(line .. '  [Y] ' .. L('mx_pay_yes') .. '   [N] ' .. L('mx_pay_no'))
      EndTextCommandDisplayHelp(0, false, false, -1)
      if IsControlJustReleased(0, 246) then        -- Y
        answered = true
        TriggerServerEvent('as-computer:server:mechanicPayReply', token, true)
      elseif IsControlJustReleased(0, 306) then    -- N
        answered = true
        TriggerServerEvent('as-computer:server:mechanicPayReply', token, false)
      end
      Wait(0)
    end
    if not answered then TriggerServerEvent('as-computer:server:mechanicPayReply', token, false) end
    prompting = false
  end)
end)
