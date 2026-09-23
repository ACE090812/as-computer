-- Computer sessions: who last used each computer and whether they left it locked, signed in or shut down.
-- If the same character comes back to the same computer and nobody else has used it since (and they didn't
-- Shut down), the desktop opens exactly as they left it: same windows, same apps, same Scout tabs.
-- Kept in memory only: a server restart starts every computer fresh.

local sessions = {}   -- computer key ('c<index>' or 'p<placed id>') -> { cid, state = 'active'|'locked'|'off', at }
local RESUME = (Config.Session and Config.Session.resumeMinutes) or 60

local function validKey(k) return type(k) == 'string' and #k <= 24 and k:match('^[cp]%d+$') ~= nil end

--- key -> { resume, locked }. Opening a computer also makes you its current user, so whoever used it
--- before you can no longer resume there.
MotCallback.Register('session:open', function(src, respond, key)
  if not validKey(key) then return respond({ resume = false }) end
  local cid = Bridge.GetIdentifier(src)
  local rec = sessions[key]
  local fresh = rec and (RESUME <= 0 or os.time() - rec.at <= RESUME * 60)
  local resume = cid ~= nil and rec ~= nil and fresh and rec.cid == cid and rec.state ~= 'off'
  sessions[key] = { cid = cid, state = resume and rec.state or 'active', at = os.time() }
  respond({ resume = resume and true or false, locked = resume and rec.state == 'locked' or false })
end)

RegisterNetEvent('as-computer:server:session', function(key, st)
  local src = source
  if not validKey(key) or (st ~= 'active' and st ~= 'locked' and st ~= 'off') then return end
  local rec = sessions[key]
  if rec and rec.cid == Bridge.GetIdentifier(src) then
    rec.state, rec.at = st, os.time()
    if st == 'off' and MirrorClear then MirrorClear(key) end
  end
end)

--- Is this player the one signed in on that computer right now? (server/mirror.lua)
function ComputerSessionIs(key, src)
  local rec = sessions[key]
  return rec ~= nil and rec.state ~= 'off' and rec.cid ~= nil and rec.cid == Bridge.GetIdentifier(src)
end

--- For other scripts: the session on a computer, or nil.
exports('computerSession', function(key)
  local rec = sessions[key]
  return rec and { cid = rec.cid, state = rec.state, at = rec.at } or nil
end)
