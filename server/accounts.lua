-- Phase 0.5: per-machine accounts. A shared, server-side identity system independent of the
-- character (citizenid) using the computer: a username/password an admin creates, that then
-- works on every machine it has been explicitly granted onto (or, later, on a `public`-typed
-- machine, on any machine at all - not handled here yet).
--
-- Three tables:
--   computer_accounts  - one row per account (global, not per-machine): id, username, password
--                         hash+salt.
--   computer_grants    - join table: which accounts may log into which machine key, and whether
--                         they're an admin on that machine (can add/remove other accounts there).
--   computer_owners    - one row per machine key: the account that "owns" it (the admin who
--                         completed that machine's first-boot setup). Used later for e.g. mining
--                         payouts - always credit the owner, never whoever's logged in.
--
-- Machine key format matches server/session.lua: 'c<index>' (built-in Config.Locations computers)
-- or 'p<placed id>' (placed via /placeprops).

Accounts = Accounts or {}
local accounts = Accounts

--- SHA-256 (pure Lua, no natives/deps). Only used for password hashing here, so this file has no
--- dependency on an external crypto resource. Salted (accounts.hash below), not a security
--- bottleneck for this use case.
local function sha256(msg)
  local mreset, mand, mor, mxor, mnot, mshl, mshr = bit and bit.reset, bit and bit.band, bit and bit.bor,
      bit and bit.bxor, bit and bit.bnot, bit and bit.lshift, bit and bit.rshift

  local band, bor, bxor, bnot, lshift, rshift
  if bit then
    band, bor, bxor, bnot, lshift, rshift = bit.band, bit.bor, bit.bxor, bit.bnot, bit.lshift, bit.rshift
  else
    -- Lua 5.3+ / GTA's Lua 5.4 runtime has native bitwise operators and 64-bit integers.
    band  = function(a, b) return a & b end
    bor   = function(a, b) return a | b end
    bxor  = function(a, b) return a ~ b end
    bnot  = function(a) return (~a) & 0xFFFFFFFF end
    lshift = function(a, n) return (a << n) & 0xFFFFFFFF end
    rshift = function(a, n) return (a & 0xFFFFFFFF) >> n end
  end

  local function rrotate(x, n) return bor(rshift(x, n), lshift(x, 32 - n)) end

  local k = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  }
  local h0,h1,h2,h3,h4,h5,h6,h7 =
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19

  local msgLen = #msg
  local bitLen = msgLen * 8
  msg = msg .. '\128'
  while (#msg % 64) ~= 56 do msg = msg .. '\0' end
  for i = 7, 0, -1 do
    msg = msg .. string.char(rshift(bitLen, i * 8) % 256)
  end

  for chunkStart = 1, #msg, 64 do
    local w = {}
    for i = 0, 15 do
      local o = chunkStart + i * 4
      w[i] = (msg:byte(o) * 0x1000000) + (msg:byte(o+1) * 0x10000) + (msg:byte(o+2) * 0x100) + msg:byte(o+3)
    end
    for i = 16, 63 do
      local s0 = bxor(bxor(rrotate(w[i-15], 7), rrotate(w[i-15], 18)), rshift(w[i-15], 3))
      local s1 = bxor(bxor(rrotate(w[i-2], 17), rrotate(w[i-2], 19)), rshift(w[i-2], 10))
      w[i] = (w[i-16] + s0 + w[i-7] + s1) % 4294967296
    end

    local a,b,c,d,e,f,g,h = h0,h1,h2,h3,h4,h5,h6,h7
    for i = 0, 63 do
      local S1 = bxor(bxor(rrotate(e, 6), rrotate(e, 11)), rrotate(e, 25))
      local ch = bxor(band(e, f), band(bnot(e), g))
      local temp1 = (h + S1 + ch + k[i+1] + w[i]) % 4294967296
      local S0 = bxor(bxor(rrotate(a, 2), rrotate(a, 13)), rrotate(a, 22))
      local maj = bxor(bxor(band(a, b), band(a, c)), band(b, c))
      local temp2 = (S0 + maj) % 4294967296
      h = g; g = f; f = e; e = (d + temp1) % 4294967296
      d = c; c = b; b = a; a = (temp1 + temp2) % 4294967296
    end

    h0 = (h0 + a) % 4294967296; h1 = (h1 + b) % 4294967296; h2 = (h2 + c) % 4294967296
    h3 = (h3 + d) % 4294967296; h4 = (h4 + e) % 4294967296; h5 = (h5 + f) % 4294967296
    h6 = (h6 + g) % 4294967296; h7 = (h7 + h) % 4294967296
  end

  local out = {}
  for _, v in ipairs({h0,h1,h2,h3,h4,h5,h6,h7}) do out[#out+1] = string.format('%08x', v) end
  return table.concat(out)
end

--- Random hex salt. `math.random` is seeded once at resource start (server/main.lua / engine.init
--- elsewhere already seed it); good enough for a salt, not for the hash itself.
local function genSalt()
  local chars = {}
  for i = 1, 16 do chars[i] = string.format('%02x', math.random(0, 255)) end
  return table.concat(chars)
end

--- Salted hash for a plaintext password. Exposed so callers can compare re-hashes without
--- reaching into the sha256 internals.
---@param password string plaintext
---@param salt string hex salt (accounts.genSalt())
---@return string hex hash
function accounts.hash(password, salt)
  return sha256(salt .. ':' .. tostring(password))
end

--- Machine key validator, matching server/session.lua's own `validKey`. 'c' = Config.Locations index,
--- 'p' = admin /placeprops computer_placed.id, 'm' = player-placed mining tower (server/mining_place.lua,
--- Phase 4) - its own id sequence, kept distinct from 'p' so the two never collide.
local function validKey(k) return type(k) == 'string' and #k <= 24 and k:match('^[cpm]%d+$') ~= nil end

--- Username validator: 3-20 chars, letters/numbers/underscore, stored+compared lowercase so
--- logins are case-insensitive without a second column.
---@param u string
---@return string|nil normalized lowercase username, nil if invalid
local function normalizeUsername(u)
  if type(u) ~= 'string' then return nil end
  u = u:lower():gsub('^%s+', ''):gsub('%s+$', '')
  if not u:match('^[a-z0-9_]+$') or #u < 3 or #u > 20 then return nil end
  return u
end

function accounts.ensureSchema()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_accounts` (
      `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      `username`      VARCHAR(20)  NOT NULL,
      `password_hash` CHAR(64)     NOT NULL,
      `password_salt` CHAR(32)     NOT NULL,
      `created_at`    BIGINT       NOT NULL,
      PRIMARY KEY (`id`),
      UNIQUE KEY `uniq_username` (`username`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_grants` (
      `computer_key` VARCHAR(24)  NOT NULL,
      `account_id`   INT UNSIGNED NOT NULL,
      `is_admin`     TINYINT(1)   NOT NULL DEFAULT 0,
      `granted_by`   INT UNSIGNED NULL,
      `granted_at`   BIGINT       NOT NULL,
      PRIMARY KEY (`computer_key`, `account_id`),
      KEY `idx_grants_account` (`account_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_owners` (
      `computer_key` VARCHAR(24)  NOT NULL,
      `account_id`   INT UNSIGNED NOT NULL,
      `citizenid`    VARCHAR(64)  NULL,
      `updated_at`   BIGINT       NOT NULL,
      PRIMARY KEY (`computer_key`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  ]])
  -- Migration for a computer_owners table created before the citizenid column existed (idempotent -
  -- MySQL has no portable "ADD COLUMN IF NOT EXISTS" here, so a repeat error on an already-migrated
  -- table is expected and silently swallowed, same pattern as server/mdt.lua's own migrations).
  pcall(function() MySQL.query.await('ALTER TABLE `computer_owners` ADD COLUMN `citizenid` VARCHAR(64) NULL') end)
end

MySQL.ready(function()
  accounts.ensureSchema()
end)

---One account row by (lowercased) username, or nil. Includes the password hash/salt - callers
---outside this file should use accounts.verifyLogin instead of comparing these themselves.
---@param username string
---@return table|nil row { id, username, password_hash, password_salt, created_at }
local function byUsername(username)
  local u = normalizeUsername(username)
  if not u then return nil end
  return MySQL.single.await('SELECT * FROM `computer_accounts` WHERE username = ?', { u })
end

---One account row by id, or nil.
---@param id integer
---@return table|nil row
function accounts.byId(id)
  if not id then return nil end
  return MySQL.single.await('SELECT id, username, created_at FROM `computer_accounts` WHERE id = ?', { id })
end

---True if a machine key has at least one grant - i.e. it has already been through first-boot
---setup. A key with zero grants is what triggers the setup wizard instead of a login screen.
---@param computerKey string
---@return boolean
function accounts.hasAnyGrants(computerKey)
  if not validKey(computerKey) then return false end
  local row = MySQL.single.await('SELECT 1 AS x FROM `computer_grants` WHERE computer_key = ? LIMIT 1', { computerKey })
  return row ~= nil
end

---Creates a brand-new account (fails if the username is taken or invalid).
---@param username string 3-20 chars, [a-z0-9_], case-insensitive
---@param password string plaintext; hashed+salted before storage, never stored/logged raw
---@return integer|nil id, string|nil err one of 'invalid_username' | 'invalid_password' | 'taken'
function accounts.create(username, password)
  local u = normalizeUsername(username)
  if not u then return nil, 'invalid_username' end
  if type(password) ~= 'string' or #password < 4 or #password > 64 then return nil, 'invalid_password' end
  if byUsername(u) then return nil, 'taken' end

  local salt = genSalt()
  local hash = accounts.hash(password, salt)
  local id = MySQL.insert.await(
    'INSERT INTO `computer_accounts` (username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)',
    { u, hash, salt, os.time() })
  return id
end

---Verifies a username+password. Constant-effort-ish (always hashes) but not constant-time; good
---enough for this game context, not a general-purpose auth library.
---@param username string
---@param password string plaintext
---@return table|nil account { id, username } on success, nil on any failure
function accounts.verifyLogin(username, password)
  local row = byUsername(username)
  if not row then return nil end
  if type(password) ~= 'string' then return nil end
  if accounts.hash(password, row.password_salt) ~= row.password_hash then return nil end
  return { id = row.id, username = row.username }
end

---Grants an account access to a machine (upsert - re-granting just updates is_admin).
---@param computerKey string
---@param accountId integer
---@param isAdmin boolean can this account itself grant/revoke others on this machine
---@param grantedBy integer|nil account id of whoever granted it (nil for the setup wizard's own admin grant)
function accounts.grant(computerKey, accountId, isAdmin, grantedBy)
  if not validKey(computerKey) or not accountId then return false end
  MySQL.prepare.await(
    'INSERT INTO `computer_grants` (computer_key, account_id, is_admin, granted_by, granted_at) VALUES (?, ?, ?, ?, ?) ' ..
    'ON DUPLICATE KEY UPDATE is_admin = VALUES(is_admin)',
    { computerKey, accountId, isAdmin and 1 or 0, grantedBy, os.time() })
  return true
end

---Revokes an account's access to one machine. Does not touch other machines it's granted on, and
---does not delete the account itself.
---@param computerKey string
---@param accountId integer
function accounts.revoke(computerKey, accountId)
  if not validKey(computerKey) or not accountId then return end
  MySQL.prepare.await('DELETE FROM `computer_grants` WHERE computer_key = ? AND account_id = ?', { computerKey, accountId })
end

---Is this account allowed to log into this machine, and are they an admin there.
---@param computerKey string
---@param accountId integer
---@return boolean granted, boolean isAdmin
function accounts.isGranted(computerKey, accountId)
  if not validKey(computerKey) or not accountId then return false, false end
  local row = MySQL.single.await(
    'SELECT is_admin FROM `computer_grants` WHERE computer_key = ? AND account_id = ?', { computerKey, accountId })
  if not row then return false, false end
  return true, row.is_admin == 1
end

---Every account granted onto a machine (for an admin's "manage users" screen).
---@param computerKey string
---@return { accountId: integer, username: string, isAdmin: boolean, grantedAt: integer }[]
function accounts.listGrants(computerKey)
  if not validKey(computerKey) then return {} end
  local rows = MySQL.query.await([[
    SELECT g.account_id, a.username, g.is_admin, g.granted_at
    FROM `computer_grants` g JOIN `computer_accounts` a ON a.id = g.account_id
    WHERE g.computer_key = ? ORDER BY g.granted_at ASC
  ]], { computerKey }) or {}
  local out = {}
  for _, r in ipairs(rows) do
    out[#out + 1] = { accountId = r.account_id, username = r.username, isAdmin = r.is_admin == 1, grantedAt = r.granted_at }
  end
  return out
end

---The account id that owns a machine (nil if it hasn't been set up yet).
---@param computerKey string
---@return integer|nil accountId
function accounts.getOwner(computerKey)
  if not validKey(computerKey) then return nil end
  local row = MySQL.single.await('SELECT account_id FROM `computer_owners` WHERE computer_key = ?', { computerKey })
  return row and row.account_id or nil
end

---The CHARACTER (citizenid) that owns a machine - what mining payouts actually credit, since a
---sd-phone wallet is per-citizenid, not per login-account (an account can be a shared login used by
---several characters - see the plan doc's "Mining payout ownership" decision). nil if the machine
---hasn't been set up yet, or (only possible on data from before this column existed) if the owning
---citizenid was never recorded.
---@param computerKey string
---@return string|nil citizenid
function accounts.getOwnerCitizenId(computerKey)
  if not validKey(computerKey) then return nil end
  local row = MySQL.single.await('SELECT citizenid FROM `computer_owners` WHERE computer_key = ?', { computerKey })
  return row and row.citizenid or nil
end

---Sets (or transfers) a machine's owner: both the login-account (who can manage it) and the
---citizenid (who mining payouts actually credit - see accounts.getOwnerCitizenId). Setup calls this
---once for the admin who completed it; a future sale/trade flow calls it again to transfer both.
---@param computerKey string
---@param accountId integer
---@param citizenid string|nil the character completing setup/the transfer; nil only for old call
---  sites that haven't been updated yet - never pass nil for a NEW owner on purpose
function accounts.setOwner(computerKey, accountId, citizenid)
  if not validKey(computerKey) or not accountId then return end
  MySQL.prepare.await(
    'INSERT INTO `computer_owners` (computer_key, account_id, citizenid, updated_at) VALUES (?, ?, ?, ?) ' ..
    'ON DUPLICATE KEY UPDATE account_id = VALUES(account_id), citizenid = VALUES(citizenid), updated_at = VALUES(updated_at)',
    { computerKey, accountId, citizenid, os.time() })
end

---Deletes every grant and the owner record for a machine key - used when the physical machine is
---removed entirely (a placed mining monitor being picked up, server/mining_place.lua Phase 5.5) so a
---stale key can't quietly keep working, and accounts.hasAnyGrants correctly reports "never set up"
---if this exact key string is ever reused (it won't be - ids aren't recycled - but this keeps the
---table honest either way). Does not touch the accounts themselves, only this machine's link to them.
---@param computerKey string
function accounts.wipeMachine(computerKey)
  if not validKey(computerKey) then return end
  MySQL.query.await('DELETE FROM `computer_grants` WHERE computer_key = ?', { computerKey })
  MySQL.query.await('DELETE FROM `computer_owners` WHERE computer_key = ?', { computerKey })
end

---First-boot setup: creates the admin account, grants it admin on this machine, and sets it as
---owner - all three or none (best-effort rollback if the grant/owner steps somehow fail after
---the account is created, since MySQL.prepare.await calls aren't wrapped in one transaction here).
---Fails outright (no account created) if this machine already has any grants - call
---accounts.hasAnyGrants first and route to a login screen instead.
---@param computerKey string
---@param username string
---@param password string plaintext
---@param citizenid string|nil the character running the wizard - recorded as the machine's owner
---  for mining payouts (accounts.getOwnerCitizenId). Always pass this from server/session.lua.
---@return table|nil account { id, username }, string|nil err 'already_setup' | 'invalid_username' | 'invalid_password' | 'taken'
function accounts.setup(computerKey, username, password, citizenid)
  if not validKey(computerKey) then return nil, 'invalid_username' end
  if accounts.hasAnyGrants(computerKey) then return nil, 'already_setup' end

  local id, err = accounts.create(username, password)
  if not id then return nil, err end

  accounts.grant(computerKey, id, true, nil)
  accounts.setOwner(computerKey, id, citizenid)

  return { id = id, username = normalizeUsername(username) }
end
