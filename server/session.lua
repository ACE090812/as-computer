-- Computer sessions: who last used each computer and whether they left it locked, signed in or shut down.
-- If the same character comes back to the same computer and nobody else has used it since (and they didn't
-- shut down, and their account is still granted access), the desktop opens exactly as they left it: same
-- windows, same apps, same Scout tabs.
-- Kept in memory only: a server restart starts every computer fresh (accounts/grants themselves are in the
-- DB via server/accounts.lua - only the live "who's using it right now" state is in-memory).
--
-- Phase 0.5: every machine now needs a valid account to use, not just any character. A machine with zero
-- accounts granted onto it has never been through setup - 'session:open' reports `needsSetup` for that case
-- so the client shows the first-boot wizard instead of a login screen (the wizard itself now also links to
-- the login screen, since session:login below can claim a fresh machine for an existing account too - a
-- player doesn't have to create a brand-new account on every computer they ever sit down at).

local sessions = {}   -- computer key ('c<index>', 'p<placed id>' or 'm<mining-placed id>') -> { cid, accountId, state = 'active'|'locked'|'off', at }
local RESUME = (Config.Session and Config.Session.resumeMinutes) or 60

-- 'm' = a player-placed mining tower (server/mining_place.lua, Phase 4) - its own id sequence, distinct
-- from 'p' (admin /placeprops) so the two never collide.
local function validKey(k) return type(k) == 'string' and #k <= 24 and k:match('^[cpm]%d+$') ~= nil end

--- key -> { needsSetup } | { needsLogin, accounts } | { resume, locked, accountName }. Opening a computer also makes
--- you its current user, so whoever used it before you can no longer resume there. Does NOT sign anyone in -
--- that only happens via session:setup or session:login below. `accounts` is what the lock screen lists.
local function loginList(key, cid)
  local out = {}
  for _, a in ipairs(Accounts.listGrants(key)) do
    out[#out + 1] = { username = a.username, isGuest = a.isGuest, isOwner = a.isOwner }
  end
  local mine = cid and Accounts.ofCharacter(key, cid)
  return out, mine and mine.username or nil
end

MotCallback.Register('session:open', function(src, respond, key)
  if not validKey(key) then return respond({ needsLogin = true }) end

  -- A computer only starts when its tower holds the required parts (server/hardware.lua).
  if Hardware and not Hardware.Bootable(key) then
    return respond({ noBoot = true, missing = Hardware.Status(key).missing })
  end

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
  local list, mine = loginList(key, cid)
  return respond({ needsLogin = true, accounts = list, myAccount = mine })
end)

--- A guest's files do not outlast the guest session.
local function wipeGuest(key)
  local rec = sessions[key]
  if rec and rec.guest and rec.accountId and FilesWipeOwner then FilesWipeOwner('pc:' .. key .. ':' .. rec.accountId) end
end

local function signedIn(key, src, account)
  wipeGuest(key)
  sessions[key] = { cid = Bridge.GetIdentifier(src), accountId = account.id, guest = account.isGuest == true, state = 'active', at = os.time() }
  if ComputerLog then
    ComputerLog(key, 'security', account.isGuest and 'guest_login' or 'login', ('Signed in as "%s"'):format(account.username), src, 'success')
  end
end

--- First-boot setup wizard: only succeeds while the computer has no accounts. Creates the owner's account (linked to this
--- character), makes them the owner, and signs them in.
MotCallback.Register('session:setup', function(src, respond, key, username, password)
  if not validKey(key) then return respond({ success = false }) end
  if Hardware and not Hardware.Bootable(key) then return respond({ success = false, error = 'no_boot' }) end
  local cid = Bridge.GetIdentifier(src)
  if not cid then return respond({ success = false, message = 'Not loaded' }) end

  local account, err = Accounts.setup(key, username, password, cid)
  if not account then
    return respond({ success = false, error = err })
  end

  sessions[key] = { cid = cid, accountId = account.id, state = 'active', at = os.time() }
  if ComputerLog then
    ComputerLog(key, 'system', 'setup', ('First-time setup completed, owner account "%s"'):format(account.username), src)
    ComputerLog(key, 'security', 'login', ('Signed in as "%s"'):format(account.username), src, 'success')
  end
  respond({ success = true, accountName = account.username })
end)

--- Sign in to one account on this computer with its password or PIN (the guest account needs neither).
--- An account the owner made for someone else is claimed by the first character who signs in; after that only that
--- character can use it. A character has one account per computer.
MotCallback.Register('session:login', function(src, respond, key, username, password)
  if not validKey(key) then return respond({ success = false }) end
  if Hardware and not Hardware.Bootable(key) then return respond({ success = false, error = 'no_boot' }) end
  local cid = Bridge.GetIdentifier(src)
  if not cid then return respond({ success = false, message = 'Not loaded' }) end

  local account, err = Accounts.verifyLogin(key, username, password, cid)
  if not account then
    if ComputerLog then ComputerLog(key, 'security', 'login_failed', ('Failed sign-in as "%s"'):format(tostring(username):sub(1, 20)), src, 'failure') end
    return respond({ success = false, error = err or 'bad_credentials' })
  end

  signedIn(key, src, account)
  respond({ success = true, accountName = account.username, guest = account.isGuest == true })
end)

-- ---- Account management. Only the computer's owner may create or remove accounts or switch guests; everyone manages
-- ---- their own PIN and password. All of it needs an active session on that computer.
local function activeAccount(src, key)
  local rec = sessions[key]
  if not rec or rec.state == 'off' or rec.cid ~= Bridge.GetIdentifier(src) then return nil end
  return Accounts.byId(rec.accountId)
end

--- The Accounts page: everyone sees their own, the owner also gets the full list and the guest switch.
MotCallback.Register('session:accounts', function(src, respond, key)
  if not validKey(key) then return respond({ success = false }) end
  local me = activeAccount(src, key)
  if not me then return respond({ success = false }) end
  local isOwner = me.is_owner == 1
  respond({
    success = true, me = { username = me.username, isOwner = isOwner, isGuest = me.is_guest == 1 },
    accounts = isOwner and Accounts.listGrants(key) or nil, guests = isOwner and Accounts.guestsAllowed(key) or nil,
  })
end)

MotCallback.Register('session:createAccount', function(src, respond, key, username, password)
  if not validKey(key) then return respond({ success = false }) end
  local me = activeAccount(src, key)
  if not me or me.is_owner ~= 1 then return respond({ success = false, error = 'not_owner' }) end
  local id, err = Accounts.create(key, username, password, nil, false)
  if ComputerLog and id then ComputerLog(key, 'security', 'account_created', ('Account "%s" created'):format(tostring(username):lower():sub(1, 20)), src, 'success') end
  respond({ success = id ~= nil, error = err })
end)

MotCallback.Register('session:removeAccount', function(src, respond, key, accountId)
  if not validKey(key) then return respond({ success = false }) end
  local me = activeAccount(src, key)
  if not me or me.is_owner ~= 1 then return respond({ success = false, error = 'not_owner' }) end
  local ok = Accounts.remove(key, tonumber(accountId))
  if ComputerLog and ok then ComputerLog(key, 'security', 'account_removed', 'An account was removed', src, 'warning') end
  respond({ success = ok })
end)

MotCallback.Register('session:setGuests', function(src, respond, key, on)
  if not validKey(key) then return respond({ success = false }) end
  local me = activeAccount(src, key)
  if not me or me.is_owner ~= 1 then return respond({ success = false, error = 'not_owner' }) end
  Accounts.setGuests(key, on == true)
  respond({ success = true })
end)

MotCallback.Register('session:setPin', function(src, respond, key, pin)
  if not validKey(key) then return respond({ success = false }) end
  local me = activeAccount(src, key)
  if not me or me.is_guest == 1 then return respond({ success = false }) end
  local ok, err = Accounts.setPin(me.id, (pin ~= nil and pin ~= '') and tostring(pin) or nil)
  respond({ success = ok, error = err })
end)

MotCallback.Register('session:setPassword', function(src, respond, key, oldPassword, newPassword)
  if not validKey(key) then return respond({ success = false }) end
  local me = activeAccount(src, key)
  if not me or me.is_guest == 1 then return respond({ success = false }) end
  local ok, err = Accounts.setPassword(me.id, oldPassword, newPassword)
  respond({ success = ok, error = err })
end)

RegisterNetEvent('as-computer:server:session', function(key, st)
  local src = source
  if not validKey(key) or (st ~= 'active' and st ~= 'locked' and st ~= 'off') then return end
  local rec = sessions[key]
  if rec and rec.cid == Bridge.GetIdentifier(src) then
    if ComputerLog and rec.state ~= st then
      local what = { locked = 'Computer locked', off = 'Computer shut down', active = 'Computer unlocked' }
      ComputerLog(key, 'system', st == 'off' and 'shutdown' or st == 'locked' and 'lock' or 'unlock', what[st], src)
    end
    rec.state, rec.at = st, os.time()
    if st == 'off' then wipeGuest(key) end
    if st == 'off' and MirrorClear then MirrorClear(key) end
  end
end)

--- Is the account signed in on that computer the guest account? (guests cannot install apps or change Settings)
function ComputerSessionIsGuest(key)
  local rec = sessions[key]
  return rec ~= nil and rec.state ~= 'off' and rec.guest == true
end

--- Is this player's current session a guest session?
function PlayerIsGuest(src)
  local key = Apps and Apps.computerOf and Apps.computerOf(src)
  return key ~= nil and ComputerSessionIsGuest(key)
end

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

--- Snapshot of every live session for the admin panel (server/admin.lua): key -> { cid, state, at }.
function ComputerSessionsList()
  local out = {}
  for key, rec in pairs(sessions) do
    if rec.state ~= 'off' then out[key] = { cid = rec.cid, state = rec.state, at = rec.at } end
  end
  return out
end

--- Admin action: mark a machine locked (the user's windows stay) and return who was on it, or nil.
---@param key string
---@return string|nil cid
function ComputerSessionForceLock(key)
  local rec = sessions[key]
  if not rec or rec.state == 'off' then return nil end
  rec.state, rec.at = 'locked', os.time()
  return rec.cid
end
