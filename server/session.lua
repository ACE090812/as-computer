-- Computer sessions: who last used each computer and whether they left it locked, signed in or shut down.
-- If the same character comes back to the same computer and nobody else has used it since (and they didn't
-- shut down, and their account is still granted access), the desktop opens exactly as they left it: same
-- windows, same apps, same Scout tabs.
-- Kept in memory only: a server restart starts every computer fresh (accounts/grants themselves are in the
-- DB via server/accounts.lua - only the live "who's using it right now" state is in-memory).
--
-- Phase 0.5: every machine now needs a valid account to use, not just any character. A machine with zero
-- accounts granted onto it has never been through setup - 'session:open' reports `needsSetup` for that case
-- so the client shows the first-boot wizard instead of a login screen.

local sessions = {}   -- computer key ('c<index>', 'p<placed id>' or 'm<mining-placed id>') -> { cid, accountId, state = 'active'|'locked'|'off', at }
local RESUME = (Config.Session and Config.Session.resumeMinutes) or 60

-- 'm' = a player-placed mining tower (server/mining_place.lua, Phase 4) - its own id sequence, distinct
-- from 'p' (admin /placeprops) so the two never collide.
local function validKey(k) return type(k) == 'string' and #k <= 24 and k:match('^[cpm]%d+$') ~= nil end

--- key -> { needsSetup } | { needsLogin } | { resume, locked, accountName }. Opening a computer also makes
--- you its current user, so whoever used it before you can no longer resume there. Does NOT sign anyone in -
--- that only happens via session:setup or session:login below.
MotCallback.Register('session:open', function(src, respond, key)
  if not validKey(key) then return respond({ needsLogin = true }) end

  if not Accounts.hasAnyGrants(key) then
    return respond({ needsSetup = true })
  end

  local cid = Bridge.GetIdentifier(src)
  local rec = sessions[key]
  local fresh = rec and (RESUME <= 0 or os.time() - rec.at <= RESUME * 60)
  local sameChar = cid ~= nil and rec ~= nil and fresh and rec.cid == cid and rec.state ~= 'off'
  local stillGranted = sameChar and rec.accountId and select(1, Accounts.isGranted(key, rec.accountId))

  if sameChar and stillGranted then
    local account = Accounts.byId(rec.accountId)
    return respond({
      resume      = true,
      locked      = rec.state == 'locked',
      accountName = account and account.username or nil,
    })
  end

  -- No resumable session (or the account that had one lost access since): show the login screen.
  return respond({ needsLogin = true })
end)

--- First-boot setup wizard: only succeeds while the machine has never been granted to anyone.
--- Creates the admin account, grants it, sets it as owner, and signs it in.
---@param key string machine key
---@param username string
---@param password string plaintext, hashed server-side before storage
MotCallback.Register('session:setup', function(src, respond, key, username, password)
  if not validKey(key) then return respond({ success = false }) end
  local cid = Bridge.GetIdentifier(src)
  if not cid then return respond({ success = false, message = 'Not loaded' }) end

  local account, err = Accounts.setup(key, username, password, cid)
  if not account then
    return respond({ success = false, error = err })
  end

  sessions[key] = { cid = cid, accountId = account.id, state = 'active', at = os.time() }
  respond({ success = true, accountName = account.username })
end)

--- Ordinary login on a machine that's already past setup. Requires the account to be granted onto
--- THIS machine (shared login: the same account can be granted on several machines, but not every
--- machine automatically accepts every account - see the plan doc's public-computer exception,
--- not yet wired in here).
MotCallback.Register('session:login', function(src, respond, key, username, password)
  if not validKey(key) then return respond({ success = false }) end
  local cid = Bridge.GetIdentifier(src)
  if not cid then return respond({ success = false, message = 'Not loaded' }) end

  local account = Accounts.verifyLogin(username, password)
  if not account then
    return respond({ success = false, error = 'bad_credentials' })
  end

  local granted = Accounts.isGranted(key, account.id)
  if not granted then
    return respond({ success = false, error = 'not_granted' })
  end

  sessions[key] = { cid = cid, accountId = account.id, state = 'active', at = os.time() }
  respond({ success = true, accountName = account.username })
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

--- The account currently signed in on a machine, or nil (server/apps.lua, server/files.lua etc. can
--- use this once they move from citizenid-keyed to account-keyed storage - not done in Phase 0.5 itself).
---@param key string machine key
---@return integer|nil accountId
function ComputerSessionAccount(key)
  local rec = sessions[key]
  return rec and rec.state ~= 'off' and rec.accountId or nil
end

--- For other scripts: the session on a computer, or nil.
exports('computerSession', function(key)
  local rec = sessions[key]
  return rec and { cid = rec.cid, accountId = rec.accountId, state = rec.state, at = rec.at } or nil
end)

--- Drops any in-memory session for a machine that's about to stop existing (a placed mining monitor
--- being picked up, server/mining_place.lua Phase 5.5) and hands back who was actively on it, if
--- anyone and they hadn't already shut down - so the caller can force-close their screen instead of
--- leaving them staring at a computer that no longer physically exists.
---@param key string
---@return string|nil activeCid the citizenid that was actively using it, or nil
function ClearComputerSession(key)
  local rec = sessions[key]
  sessions[key] = nil
  if rec and rec.state ~= 'off' then return rec.cid end
  return nil
end
