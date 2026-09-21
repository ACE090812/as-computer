-- Mail app (server side). The mailboxes live in sd-phone; this file only decides WHO may open the app. The page's calls
-- go client/mail.lua -> here ('mailGate', job + app check) -> sd-phone's own Mail callbacks, so all of sd-phone's checks
-- (signed in to the account, rate limits, sizes) apply exactly as on the phone.

local function MailResource()
  local m = Config.Mail
  if not m or m.enabled == false then return nil end
  local res = m.resource or 'sd-phone'
  if GetResourceState(res) ~= 'started' then return nil end
  return res
end

Apps.available.mail = function() return MailResource() ~= nil end

MotCallback.Register('mailGate', function(src, respond)
  if not Apps.allowed(src, 'mail') then return respond({ ok = false, reason = 'not_authorised' }) end
  if not MailResource() then return respond({ ok = false, reason = 'unavailable' }) end
  respond({ ok = true })
end)
