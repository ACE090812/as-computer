-- Event Viewer (server side). Lines are written with ComputerLog() from anywhere on the server and read through 'logsApi'.
--   ComputerLog(key, kind, event, message, src, level, opts)
--     key     the computer ('c1', 'p3', 'm2'); nil/invalid is ignored
--     kind    'application' | 'security' | 'system' | 'boss'
--     event   short name ('login', 'fire', 'file_save'...); also picks the event id when opts.eventId is not given
--     src     the player who caused it (their character name is stored), or nil
--     level   'information' (default) | 'warning' | 'error' | 'success' | 'failure'   ('info' still works)
--     opts    { source = 'Security', eventId = 4624, data = { ... } }
--   logsApi 'list' { kind, level, source, q, beforeId } -> { rows, counts, levels, sources, more, canRead, canClear }
--   logsApi 'clear' { kind }                           -> wipes that log (when allowed) and records event 1102

local function cfg() return Config.Logs or {} end

local KINDS = { application = true, security = true, system = true, boss = true }
local LEVELS = { information = true, warning = true, error = true, success = true, failure = true }
local LEVEL_ALIAS = { info = 'information' }

--- Event ids in the style of a real event log (4624 = logon, 4625 = failed logon, ...).
local ID_OF = {
  login = 4624, login_failed = 4625, login_denied = 4625, lock = 4800, unlock = 4801, shutdown = 1074, setup = 1001,
  admin_lock = 1011, admin_kick = 1012, admin_reset = 1013, log_cleared = 1102, app_start = 1000,
  file_save = 2001, file_folder = 2002, file_link = 2003, file_rename = 2004, file_delete = 2005, file_copy = 2006,
  file_move = 2007, file_restore = 2008, hack = 7101, bypass = 7102,
  hire = 6001, fire = 6002, promote = 6003, demote = 6003, external = 9000,
}
local SOURCE_OF = { application = 'Application', security = 'Security', system = 'System', boss = 'BusinessManager' }

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_logs` (
      `id` INT AUTO_INCREMENT PRIMARY KEY,
      `ckey` VARCHAR(24) NOT NULL,
      `kind` VARCHAR(12) NOT NULL,
      `level` VARCHAR(12) NOT NULL DEFAULT 'information',
      `event` VARCHAR(32) NOT NULL,
      `message` VARCHAR(255) NOT NULL DEFAULT '',
      `actor` VARCHAR(80) NOT NULL DEFAULT '',
      `at` INT NOT NULL,
      KEY `idx_key_kind` (`ckey`, `kind`, `id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  -- Upgrading from the first version of this table.
  local function ensure(col, ddl)
    local has = MySQL.scalar.await(
      "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'computer_logs' AND COLUMN_NAME = ?", { col })
    if (tonumber(has) or 0) == 0 then MySQL.query.await('ALTER TABLE `computer_logs` ADD COLUMN ' .. ddl) end
  end
  ensure('source', "`source` VARCHAR(32) NOT NULL DEFAULT ''")
  ensure('event_id', '`event_id` INT NOT NULL DEFAULT 0')
  ensure('data', '`data` TEXT NULL')
  MySQL.query.await("ALTER TABLE `computer_logs` MODIFY `level` VARCHAR(12) NOT NULL DEFAULT 'information'")
  MySQL.query.await("UPDATE `computer_logs` SET `level` = 'information' WHERE `level` = 'info'")
end)

local function validKey(k) return type(k) == 'string' and #k <= 24 and k:match('^[cpm]%d+$') ~= nil end

local function clip(s, n)
  s = tostring(s or ''):gsub('%c', ' ')
  local len = utf8.len(s)
  if not len or len <= n then return s end
  return s:sub(1, (utf8.offset(s, n + 1) or (#s + 1)) - 1)
end

function ComputerLog(key, kind, event, message, src, level, opts)
  if not validKey(key) or not KINDS[kind] then return end
  opts = type(opts) == 'table' and opts or {}
  level = LEVEL_ALIAS[level] or level
  level = LEVELS[level] and level or 'information'
  local actor = ''
  if src and src ~= 0 then actor = clip(Bridge.GetName(src) or GetPlayerName(src) or '', 80) end
  local data
  if type(opts.data) == 'table' then
    local ok, enc = pcall(json.encode, opts.data)
    if ok and #enc <= 2000 then data = enc end
  end
  MySQL.insert(
    'INSERT INTO computer_logs (ckey, kind, level, event, message, actor, at, source, event_id, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    { key, kind, level, clip(event, 32), clip(message, tonumber(cfg().maxMessage) or 240), actor, os.time(),
      clip(opts.source or SOURCE_OF[kind], 32), math.floor(tonumber(opts.eventId) or ID_OF[event] or 0), data })
end

--- For other scripts: write an entry to a computer's log. entry = { kind, level, source, eventId, message, data }.
exports('LogEvent', function(key, entry, src)
  if type(entry) ~= 'table' or type(entry.message) ~= 'string' then return false end
  local kind = (entry.kind == 'security' or entry.kind == 'system') and entry.kind or 'application'
  ComputerLog(key, kind, 'external', entry.message, src, entry.level,
    { source = entry.source or 'External', eventId = entry.eventId or 9000, data = entry.data })
  return validKey(key)
end)

--- The computer a player last opened, so a script can log to "the computer they are at".
exports('ComputerKeyOf', function(src) return Apps.computerOf(src) end)

CreateThread(function()
  Wait(20000)
  while true do
    local days = tonumber(cfg().retentionDays) or 30
    if days > 0 then MySQL.update('DELETE FROM computer_logs WHERE at < ?', { os.time() - days * 86400 }) end
    Wait(6 * 3600 * 1000)
  end
end)

-- ---- what writes entries ------------------------------------------------------------------------------------------

local lastApp = {}   -- src -> GetGameTimer() of the last app-start line, so a runaway page cannot flood the log
AddEventHandler('playerDropped', function() lastApp[source] = nil end)

RegisterNetEvent('as-computer:server:appOpened', function(id)
  local src = source
  if cfg().appLaunch == false or type(id) ~= 'string' or not id:match('^[%w_%-]+$') or #id > 24 then return end
  local key = Apps.computerOf(src)
  if not key or not (ComputerSessionIs and ComputerSessionIs(key, src)) then return end
  local d = Config.Apps and Config.Apps[id]
  if not d then return end
  local t = GetGameTimer()
  if lastApp[src] and t - lastApp[src] < 1500 then return end
  lastApp[src] = t
  local label = d.label
  if not label then
    local l = L('store_' .. id .. '_name')
    label = l ~= ('store_' .. id .. '_name') and l or id
  end
  ComputerLog(key, 'application', 'app_start', 'Application started: ' .. label, src, 'information', { source = label })
end)

--- File Explorer actions (server/files.lua calls this after a change succeeded).
function LogFileAction(src, event, text)
  if cfg().fileActions == false then return end
  local key = Apps.computerOf(src)
  if not key or not (ComputerSessionIs and ComputerSessionIs(key, src)) then return end
  ComputerLog(key, 'application', event, text, src, 'information', { source = 'FileExplorer' })
end

-- ---- reading ------------------------------------------------------------------------------------------------------

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
  if name ~= 'list' and name ~= 'clear' then return respond({ ok = false, reason = 'invalid' }) end
  if not mayRead(src, key) then return respond({ ok = true, data = { canRead = false } }) end
  local kind = KINDS[data.kind] and data.kind or 'security'

  if name == 'clear' then
    if cfg().allowClear == false then return respond({ ok = false, reason = 'not_authorised' }) end
    MySQL.update.await('DELETE FROM computer_logs WHERE ckey = ? AND kind = ?', { key, kind })
    ComputerLog(key, kind, 'log_cleared', ('The %s log was cleared by %s'):format(kind, Bridge.GetName(src) or '?'), src, 'warning',
      { source = 'Eventlog', eventId = 1102 })
    return respond({ ok = true })
  end

  local base, bargs = 'ckey = ? AND kind = ?', { key, kind }
  local where, args = base, { key, kind }
  if LEVELS[data.level] then where = where .. ' AND level = ?'; args[#args + 1] = data.level end
  if type(data.source) == 'string' and data.source ~= '' then where = where .. ' AND source = ?'; args[#args + 1] = clip(data.source, 32) end
  local q = type(data.q) == 'string' and clip(data.q, 60) or ''
  if q ~= '' then
    where = where .. " AND (message LIKE ? ESCAPE '\\\\' OR event LIKE ? ESCAPE '\\\\' OR actor LIKE ? ESCAPE '\\\\' OR source LIKE ? ESCAPE '\\\\')"
    local pat = like(q)
    for _ = 1, 4 do args[#args + 1] = pat end
  end
  local before = math.floor(tonumber(data.beforeId) or 0)
  if before > 0 then where = where .. ' AND id < ?'; args[#args + 1] = before end

  local size = math.max(10, math.min(300, tonumber(cfg().pageSize) or 100))
  local qargs = { table.unpack(args) }
  qargs[#qargs + 1] = size + 1
  local rows = MySQL.query.await('SELECT id, level, event, message, actor, at, source, event_id AS eventId, data FROM computer_logs WHERE ' .. where .. ' ORDER BY id DESC LIMIT ?', qargs) or {}
  local more = #rows > size
  if more then rows[#rows] = nil end
  for _, r in ipairs(rows) do
    if r.data then local ok, t = pcall(json.decode, r.data); r.data = ok and t or nil end
  end

  local counts, levels, sources = {}, {}, {}
  for _, r in ipairs(MySQL.query.await('SELECT kind, COUNT(*) AS n FROM computer_logs WHERE ckey = ? GROUP BY kind', { key }) or {}) do counts[r.kind] = tonumber(r.n) or 0 end
  for _, r in ipairs(MySQL.query.await('SELECT level, COUNT(*) AS n FROM computer_logs WHERE ' .. base .. ' GROUP BY level', bargs) or {}) do levels[r.level] = tonumber(r.n) or 0 end
  for _, r in ipairs(MySQL.query.await('SELECT DISTINCT source FROM computer_logs WHERE ' .. base .. ' ORDER BY source LIMIT 60', bargs) or {}) do sources[#sources + 1] = r.source end

  respond({ ok = true, data = {
    canRead = true, canClear = cfg().allowClear ~= false, rows = rows, more = more, kind = kind,
    counts = counts, levels = levels, sources = sources, now = os.time(), computer = key,
  } })
end)
