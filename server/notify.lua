-- Computer notifications. Anything can tell a computer (or the computer a character is using) something:
--   exports['as-computer']:notifyComputer(target, { title = 'New mail', text = 'From the council', app = 'mail', icon = 'mail', priority = 'high', action = { app = 'mail' } })
-- `target` is a computer key ('c1', 'p3', 'm7': the person signed in there gets it) or a character id (they get it on whichever
-- computer they are using). It shows as a toast bottom right and is kept in the notification panel until the session ends.
-- Characters with Do not disturb on, or that muted the app, get no toast or sound but still see it in the panel.

Notify = {}

local function str(v, n) return tostring(v or ''):gsub('%c', ' '):sub(1, n) end

local function clean(n)
  n = type(n) == 'table' and n or {}
  local out = { app = str(n.app, 32), title = str(n.title, 60), text = str(n.text, 240), icon = str(n.icon, 24), priority = n.priority == 'high' and 'high' or 'normal' }
  if type(n.action) == 'table' and type(n.action.app) == 'string' and n.action.app:match('^[%w_%-]+$') then out.action = { app = n.action.app:sub(1, 32) } end
  if out.title == '' and out.text == '' then return nil end
  return out
end

---@param target string computer key or character id
---@param n table { title, text, app, icon, priority, action }
---@return boolean sent
function Notify.Send(target, n)
  local c = clean(n)
  if not c or type(target) ~= 'string' then return false end
  local src, key
  if target:match('^[cpm]%d+$') then
    local rec = ComputerSessionsList and ComputerSessionsList()[target]
    if not rec then return false end
    src, key = Bridge.FindSource(rec.cid), target
  else
    src = Bridge.FindSource(target)
  end
  if not src then return false end
  TriggerClientEvent('as-computer:client:pcNotify', src, key, c)
  return true
end

exports('notifyComputer', Notify.Send)
