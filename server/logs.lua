-- Event Viewer (server side). Lines are written with ComputerLog() from anywhere on the server and read through 'logsApi'.
--   ComputerLog(key, kind, event, message, src, level)
--     key     the computer ('c1', 'p3', 'm2'); nil/invalid is ignored
--     kind    'security' | 'system' | 'boss'
--     event   short name ('login', 'login_failed', 'hack', 'fire', ...)
--     src     the player who caused it (their character name is stored), or nil
--     level   'info' (default) | 'warning' | 'error'
--   logsApi 'list' { kind, level, q, page } -> { rows, total, page, pages, counts, canRead }

local function cfg() return Config.Logs or {} end

local KINDS = { security = true, system = true, boss = true }
local LEVELS = { info = true, warning = true, error = true }

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_logs` (
      `id` INT AUTO_INCREMENT PRIMARY KEY,
      `ckey` VARCHAR(24) NOT NULL,
      `kind` VARCHAR(12) NOT NULL,
      `level` VARCHAR(8) NOT NULL DEFAULT 'info',
      `event` VARCHAR(32) NOT NULL,
      `message` VARCHAR(255) NOT NULL DEFAULT '',
      `actor` VARCHAR(80) NOT NULL DEFAULT '',
      `at` INT NOT NULL,
      KEY `idx_key_kind` (`ckey`, `kind`, `id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
end)

local function validKey(k) return type(k) == 'string' and #k <= 24 and k:match('^[cpm]%d+$') ~= nil end

function ComputerLog(key, kind, event, message, src, level)
  if not validKey(key) or not KINDS[kind] then return end
  level = LEVELS[level] and level or 'info'
  local actor = ''
  if src and src ~= 0 then actor = (Bridge.GetName(src) or GetPlayerName(src) or ''):sub(1, 80) end
  local max = tonumber(cfg().maxMessage) or 240
  MySQL.insert('INSERT INTO computer_logs (ckey, kind, level, event, message, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    { key, kind, level, tostring(event or ''):sub(1, 32), tostring(message or ''):gsub('%c', ' '):sub(1, max), actor, os.time() })
end

CreateThread(function()
  Wait(20000)
  while true do
    local days = tonumber(cfg().retentionDays) or 30
    if days > 0 then MySQL.update('DELETE FROM computer_logs WHERE at < ?', { os.time() - days * 86400 }) end
    Wait(6 * 3600 * 1000)
  end
end)

--- May this player read the log of the computer they are sitting at? Owner (signed in) or admin.
local function mayRead(src, key)
  if not validKey(key) then return false end
  if Bridge.IsAdmin(src) then return true end
  if not (ComputerSessionIs and ComputerSessionIs(key, src)) then return false end
  local acct = ComputerSessionAccount and ComputerSessionAccount(key)
  return acct ~= nil and acct == Accounts.getOwner(key)
end

local function like(s) return '%' .. s:gsub('[\\%%_]', '\\%0') .. '%' end

MotCallback.Register('logsApi', function(src, respond, name, data)
  if not Apps.allowed(src, 'logs') then return respond({ ok = false, reason = 'not_authorised' }) end
  local key = Apps.computerOf(src)
  data = type(data) == 'table' and data or {}
  if name ~= 'list' then return respond({ ok = false, reason = 'invalid' }) end
  if not mayRead(src, key) then return respond({ ok = true, data = { canRead = false } }) end

  local kind = KINDS[data.kind] and data.kind or 'security'
  local where, args = 'ckey = ? AND kind = ?', { key, kind }
  if LEVELS[data.level] then where = where .. ' AND level = ?'; args[#args + 1] = data.level end
  local q = type(data.q) == 'string' and data.q:gsub('%c', ' '):sub(1, 60) or ''
  if q ~= '' then
    where = where .. " AND (message LIKE ? ESCAPE '\\\\' OR event LIKE ? ESCAPE '\\\\' OR actor LIKE ? ESCAPE '\\\\')"
    local pat = like(q)
    args[#args + 1] = pat; args[#args + 1] = pat; args[#args + 1] = pat
  end

  local size = math.max(10, math.min(200, tonumber(cfg().pageSize) or 50))
  local total = tonumber(MySQL.scalar.await('SELECT COUNT(*) FROM computer_logs WHERE ' .. where, args)) or 0
  local pages = math.max(1, math.ceil(total / size))
  local page = math.max(1, math.min(pages, math.floor(tonumber(data.page) or 1)))
  local qargs = { table.unpack(args) }
  qargs[#qargs + 1] = size
  qargs[#qargs + 1] = (page - 1) * size
  local rows = MySQL.query.await('SELECT id, level, event, message, actor, at FROM computer_logs WHERE ' .. where .. ' ORDER BY id DESC LIMIT ? OFFSET ?', qargs) or {}

  local counts = {}
  for _, r in ipairs(MySQL.query.await('SELECT kind, COUNT(*) AS n FROM computer_logs WHERE ckey = ? GROUP BY kind', { key }) or {}) do
    counts[r.kind] = tonumber(r.n) or 0
  end
  respond({ ok = true, data = { canRead = true, rows = rows, total = total, page = page, pages = pages, counts = counts, kind = kind, now = os.time() } })
end)
