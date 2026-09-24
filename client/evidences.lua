-- Evidences app: bridges the computer's NUI to the `evidences` resource's own client-side export.
--
-- Unlike most as-computer apps, this one does NOT proxy through the server — evidences.client's
-- `getLaptopFocusData` export only exists in that resource's own client Lua VM, so it has to be
-- called directly from here, in the same way the physical laptop prop would trigger it.

RegisterNUICallback('evidencesApi', function(data, cb)
  data = data or {}

  if GetResourceState('evidences') ~= 'started' then
    cb({ ok = false, error = 'not_installed' })
    return
  end

  if data.name == 'focus' then
    local ok, result = pcall(function()
      return exports.evidences:getLaptopFocusData()
    end)

    if ok and result then
      cb({ ok = true, data = result })
    else
      cb({ ok = false, error = 'unavailable' })
    end
    return
  end

  cb({ ok = false, error = 'unknown_action' })
end)
