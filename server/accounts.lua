-- Per-computer accounts. Every account belongs to ONE computer (a username only has to be unique on that
-- computer) and is linked to one character: the character who made it, or, for an account the owner made for
-- someone else, the first character who signs in with it. A character has at most one account per computer.
-- Only the computer's owner (whoever finished its first-boot setup) creates and removes accounts. Each account has a
-- password and an optional PIN. A guest account (no password) can be switched on or off by the owner.
--
-- Tables:
--   computer_pc_accounts - one row per account: computer_key, username, citizenid (the linked character), password and
--                          PIN hashes, is_owner, is_guest.
--   computer_owners      - one row per computer: the owner's account id and character (mining payouts and the Event
--                          Viewer use it). Kept from the earlier version.
--   computer_pc_flags    - per computer switches (guests allowed).
-- The old global tables (computer_accounts, computer_grants) are no longer used.
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
    CREATE TABLE IF NOT EXISTS `computer_pc_accounts` (
      `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      `computer_key`  VARCHAR(24)  NOT NULL,
      `username`      VARCHAR(20)  NOT NULL,
      `citizenid`     VARCHAR(64)  NULL,
      `password_hash` CHAR(64)     NULL,
      `password_salt` CHAR(32)     NULL,
      `pin_hash`      CHAR(64)     NULL,
      `pin_salt`      CHAR(32)     NULL,
      `is_owner`      TINYINT(1)   NOT NULL DEFAULT 0,
      `is_guest`      TINYINT(1)   NOT NULL DEFAULT 0,
      `created_at`    BIGINT       NOT NULL,
      PRIMARY KEY (`id`),
      UNIQUE KEY `uniq_pc_user` (`computer_key`, `username`),
      KEY `idx_pc_cid` (`computer_key`, `citizenid`)
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
  pcall(function() MySQL.query.await('ALTER TABLE `computer_owners` ADD COLUMN `citizenid` VARCHAR(64) NULL') end)
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_pc_flags` (
      `computer_key` VARCHAR(24) NOT NULL PRIMARY KEY,
      `guests`       TINYINT(1)  NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  ]])
end

MySQL.ready(function()
  accounts.ensureSchema()
end)

local function validPin(p) return type(p) == 'string' and p:match('^%d%d%d%d%d?%d?$') ~= nil end
local function validPassword(p) return type(p) == 'string' and #p >= 4 and #p <= 64 end

---One account row by computer key + (lowercased) username, or nil. Includes hashes: outside this file use verifyLogin.
local function byUsername(computerKey, username)
  local u = normalizeUsername(username)
  if not u or not validKey(computerKey) then return nil end
  return MySQL.single.await('SELECT * FROM `computer_pc_accounts` WHERE computer_key = ? AND username = ?', { computerKey, u })
end

---One account by id (no hashes), or nil.
function accounts.byId(id)
  if not id then return nil end
  return MySQL.single.await('SELECT id, computer_key, username, citizenid, is_owner, is_guest, created_at FROM `computer_pc_accounts` WHERE id = ?', { id })
end

---True if a computer already has a real (non-guest) account, i.e. it has been through first-boot setup.
function accounts.hasAnyGrants(computerKey)
  if not validKey(computerKey) then return false end
  return MySQL.single.await('SELECT 1 AS x FROM `computer_pc_accounts` WHERE computer_key = ? AND is_guest = 0 LIMIT 1', { computerKey }) ~= nil
end

---The account a character already has on this computer, or nil.
function accounts.ofCharacter(computerKey, citizenid)
  if not validKey(computerKey) or not citizenid then return nil end
  return MySQL.single.await('SELECT id, username, is_owner FROM `computer_pc_accounts` WHERE computer_key = ? AND citizenid = ? AND is_guest = 0', { computerKey, citizenid })
end

---Creates an account on one computer. `citizenid` links it to a character (nil = the first character to sign in claims it).
---@return integer|nil id, string|nil err 'invalid_username' | 'invalid_password' | 'taken' | 'has_account'
function accounts.create(computerKey, username, password, citizenid, isOwner)
  if not validKey(computerKey) then return nil, 'invalid_username' end
  local u = normalizeUsername(username)
  if not u or u == 'guest' then return nil, 'invalid_username' end
  if not validPassword(password) then return nil, 'invalid_password' end
  if byUsername(computerKey, u) then return nil, 'taken' end
  if citizenid and accounts.ofCharacter(computerKey, citizenid) then return nil, 'has_account' end
  local salt = genSalt()
  -- (no nil inside a parameter list: an unclaimed account is written with a literal NULL instead)
  local id
  if citizenid then
    id = MySQL.insert.await(
      'INSERT INTO `computer_pc_accounts` (computer_key, username, citizenid, password_hash, password_salt, is_owner, is_guest, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
      { computerKey, u, citizenid, accounts.hash(password, salt), salt, isOwner and 1 or 0, os.time() })
  else
    id = MySQL.insert.await(
      'INSERT INTO `computer_pc_accounts` (computer_key, username, citizenid, password_hash, password_salt, is_owner, is_guest, created_at) VALUES (?, ?, NULL, ?, ?, ?, 0, ?)',
      { computerKey, u, accounts.hash(password, salt), salt, isOwner and 1 or 0, os.time() })
  end
  return id
end

---Verifies a sign-in on one computer: the password, or the PIN when one is set. The guest account needs neither.
---@return table|nil account { id, username, isGuest, isOwner, citizenid }, string|nil err 'bad_credentials' | 'not_yours'
function accounts.verifyLogin(computerKey, username, password, citizenid)
  local row = byUsername(computerKey, username)
  if not row then return nil, 'bad_credentials' end
  if row.is_guest == 1 then
    if not accounts.guestsAllowed(computerKey) then return nil, 'bad_credentials' end
    return { id = row.id, username = row.username, isGuest = true, isOwner = false, citizenid = nil }
  end
  if type(password) ~= 'string' or password == '' then return nil, 'bad_credentials' end
  local ok = row.password_hash and accounts.hash(password, row.password_salt) == row.password_hash
  if not ok and row.pin_hash and validPin(password) then ok = accounts.hash(password, row.pin_salt) == row.pin_hash end
  if not ok then return nil, 'bad_credentials' end
  if row.citizenid and citizenid and row.citizenid ~= citizenid then return nil, 'not_yours' end
  if not row.citizenid and citizenid then
    -- the first character to sign in claims an account the owner made for someone else, unless they already have one here
    if accounts.ofCharacter(computerKey, citizenid) then return nil, 'has_account' end
    MySQL.update.await('UPDATE `computer_pc_accounts` SET citizenid = ? WHERE id = ?', { citizenid, row.id })
    row.citizenid = citizenid
  end
  return { id = row.id, username = row.username, isGuest = false, isOwner = row.is_owner == 1, citizenid = row.citizenid }
end

---Are guests allowed on this computer? On by default.
function accounts.guestsAllowed(computerKey)
  local row = MySQL.single.await('SELECT guests FROM `computer_pc_flags` WHERE computer_key = ?', { computerKey })
  return row == nil or row.guests == 1 or row.guests == true
end

---Switch guests on or off (and make sure the guest account exists). Owner only: the caller checks.
function accounts.setGuests(computerKey, on)
  if not validKey(computerKey) then return end
  MySQL.prepare.await('INSERT INTO `computer_pc_flags` (computer_key, guests) VALUES (?, ?) ON DUPLICATE KEY UPDATE guests = VALUES(guests)', { computerKey, on and 1 or 0 })
  if on then accounts.ensureGuest(computerKey) end
end

---The guest account of a computer, created on first use.
function accounts.ensureGuest(computerKey)
  local row = byUsername(computerKey, 'guest')
  if row then return row.id end
  return MySQL.insert.await(
    "INSERT INTO `computer_pc_accounts` (computer_key, username, citizenid, is_owner, is_guest, created_at) VALUES (?, 'guest', NULL, 0, 1, ?)", { computerKey, os.time() })
end

---Is this account a guest?
function accounts.isGuestId(accountId)
  local a = accounts.byId(accountId)
  return a ~= nil and a.is_guest == 1
end

---Sets or clears an account's PIN (4 to 6 digits). Pass nil to remove it.
function accounts.setPin(accountId, pin)
  if pin == nil then
    MySQL.update.await('UPDATE `computer_pc_accounts` SET pin_hash = NULL, pin_salt = NULL WHERE id = ?', { accountId })
    return true
  end
  if not validPin(pin) then return false, 'invalid_pin' end
  local salt = genSalt()
  MySQL.update.await('UPDATE `computer_pc_accounts` SET pin_hash = ?, pin_salt = ? WHERE id = ?', { accounts.hash(pin, salt), salt, accountId })
  return true
end

---Changes an account's password after checking the old one.
function accounts.setPassword(accountId, oldPassword, newPassword)
  if not validPassword(newPassword) then return false, 'invalid_password' end
  local row = MySQL.single.await('SELECT * FROM `computer_pc_accounts` WHERE id = ?', { accountId })
  if not row or row.is_guest == 1 then return false, 'bad_credentials' end
  if not row.password_hash or accounts.hash(tostring(oldPassword or ''), row.password_salt) ~= row.password_hash then return false, 'bad_credentials' end
  local salt = genSalt()
  MySQL.update.await('UPDATE `computer_pc_accounts` SET password_hash = ?, password_salt = ? WHERE id = ?', { accounts.hash(newPassword, salt), salt, accountId })
  return true
end

---Removes one account (never the owner's or the guest's). Owner only: the caller checks.
function accounts.remove(computerKey, accountId)
  local a = accounts.byId(accountId)
  if not a or a.computer_key ~= computerKey or a.is_owner == 1 or a.is_guest == 1 then return false end
  MySQL.update.await('DELETE FROM `computer_pc_accounts` WHERE id = ?', { accountId })
  return true
end

---Is this account part of that computer? (Kept under its old name.) Returns granted, isOwner.
function accounts.isGranted(computerKey, accountId)
  if not validKey(computerKey) or not accountId then return false, false end
  local a = accounts.byId(accountId)
  if not a or a.computer_key ~= computerKey then return false, false end
  return true, a.is_owner == 1
end

---Every account on a computer, for the lock screen and the owner's Accounts page. Guest only when allowed.
---@return { accountId: integer, username: string, isOwner: boolean, isGuest: boolean, claimed: boolean }[]
function accounts.listGrants(computerKey)
  if not validKey(computerKey) then return {} end
  local rows = MySQL.query.await('SELECT id, username, citizenid, is_owner, is_guest, created_at FROM `computer_pc_accounts` WHERE computer_key = ? ORDER BY is_guest ASC, id ASC', { computerKey }) or {}
  local guests = accounts.guestsAllowed(computerKey)
  local out = {}
  for _, r in ipairs(rows) do
    if r.is_guest ~= 1 or guests then
      out[#out + 1] = { accountId = r.id, username = r.username, isOwner = r.is_owner == 1, isGuest = r.is_guest == 1, claimed = r.citizenid ~= nil, grantedAt = r.created_at }
    end
  end
  return out
end

---The owner's account id for a computer (nil if it has not been set up).
function accounts.getOwner(computerKey)
  if not validKey(computerKey) then return nil end
  local row = MySQL.single.await('SELECT account_id FROM `computer_owners` WHERE computer_key = ?', { computerKey })
  return row and row.account_id or nil
end

---The CHARACTER that owns a computer: what mining payouts credit. nil if it has not been set up.
function accounts.getOwnerCitizenId(computerKey)
  if not validKey(computerKey) then return nil end
  local row = MySQL.single.await('SELECT citizenid FROM `computer_owners` WHERE computer_key = ?', { computerKey })
  return row and row.citizenid or nil
end

function accounts.setOwner(computerKey, accountId, citizenid)
  if not validKey(computerKey) or not accountId then return end
  MySQL.prepare.await(
    'INSERT INTO `computer_owners` (computer_key, account_id, citizenid, updated_at) VALUES (?, ?, ?, ?) ' ..
    'ON DUPLICATE KEY UPDATE account_id = VALUES(account_id), citizenid = VALUES(citizenid), updated_at = VALUES(updated_at)',
    { computerKey, accountId, citizenid, os.time() })
end

---Deletes every account, the guest switch and the owner record of a computer that stops existing (a placed monitor picked up,
---an admin reset). Per the rules, accounts and files stay with the machine, so this is only for those two cases.
function accounts.wipeMachine(computerKey)
  if not validKey(computerKey) then return end
  MySQL.query.await('DELETE FROM `computer_pc_accounts` WHERE computer_key = ?', { computerKey })
  MySQL.query.await('DELETE FROM `computer_pc_flags` WHERE computer_key = ?', { computerKey })
  MySQL.query.await('DELETE FROM `computer_owners` WHERE computer_key = ?', { computerKey })
end

---First-boot setup: creates the owner's account and records the owner. Fails if the computer already has accounts.
---@return table|nil account { id, username }, string|nil err
function accounts.setup(computerKey, username, password, citizenid)
  if not validKey(computerKey) then return nil, 'invalid_username' end
  if accounts.hasAnyGrants(computerKey) then return nil, 'already_setup' end
  local id, err = accounts.create(computerKey, username, password, citizenid, true)
  if not id then return nil, err end
  accounts.setOwner(computerKey, id, citizenid)
  accounts.ensureGuest(computerKey)
  return { id = id, username = normalizeUsername(username) }
end
