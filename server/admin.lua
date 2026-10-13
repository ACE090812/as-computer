-- Admin panel (server side). Everything here is gated by Bridge.IsAdmin; the page never decides who is an admin.
--   admin:can / admin:snapshot       -> panel data (placed items, live sessions, props, log)
--   admin:lock / admin:kick          -> lock or shut down whoever is on a machine
--   admin:reset                      -> wipe a machine's accounts so it runs first-boot setup again
--   admin:propAdd / admin:propRemove -> custom decorative props that can be placed like a printer
-- Placing, moving, renaming and deleting go through server/placement.lua's own placement:* callbacks.

local AD = Config.Admin or {}
if AD.enabled == false then return end

AdminProps = AdminProps or {}   -- id -> { model, label }  (read by server/placement.lua)

local logRows = {}

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_admin_props` (
      `id` INT AUTO_INCREMENT PRIMARY KEY,
      `model` VARCHAR(80) NOT NULL,
      `label` VARCHAR(48) NOT NULL,
      UNIQUE KEY `uniq_model` (`model`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_admin_log` (
      `id` INT AUTO_INCREMENT PRIMARY KEY,
      `at` INT NOT NULL,
      `admin` VARCHAR(80) NOT NULL,
      `action` VARCHAR(24) NOT NULL,
      `detail` VARCHAR(200) NOT NULL DEFAULT ''
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  for _, r in ipairs(MySQL.query.await('SELECT id, model, label FROM computer_admin_props') or {}) do
    AdminProps[r.id] = { model = r.model, label = r.label }
  end
end)

local function adminName(src)
  if src == 0 then return 'console' end
  return (Bridge.GetName(src) or GetPlayerName(src) or tostring(src)):sub(1, 80)
end

--- Records an admin action (shown in the panel's Log tab). Also used by server/placement.lua.
function AdminLog(src, action, detail)
  local row = { at = os.time(), admin = adminName(src), action = tostring(action):sub(1, 24), detail = tostring(detail or ''):sub(1, 200) }
  MySQL.insert('INSERT INTO computer_admin_log (at, admin, action, detail) VALUES (?, ?, ?, ?)', { row.at, row.admin, row.action, row.detail })
  local max = math.max(50, tonumber(AD.maxLog) or 500)
  MySQL.update('DELETE FROM computer_admin_log WHERE id <= (SELECT id FROM (SELECT id FROM computer_admin_log ORDER BY id DESC LIMIT 1 OFFSET ?) t)', { max })
end

local function validKey(k) return type(k) == 'string' and #k <= 24 and k:match('^[cpm]%d+$') ~= nil end

local function guard(src, respond)
  if not Bridge.IsAdmin(src) then respond({ ok = false, reason = 'not_authorised' }) return false end
  return true
end

local function variantLabels(list)
  local out = {}
  for i, v in ipairs(list or {}) do out[i] = v.label or ('#' .. i) end
  return out
end

local function snapshot()
  local PC = Config.Placement or {}
  local sessions = ComputerSessionsList and ComputerSessionsList() or {}

  local grants, owners = {}, {}
  for _, r in ipairs(MySQL.query.await('SELECT computer_key, COUNT(*) AS n FROM computer_grants GROUP BY computer_key') or {}) do
    grants[r.computer_key] = tonumber(r.n) or 0
  end
  for _, r in ipairs(MySQL.query.await(
    'SELECT o.computer_key, a.username FROM computer_owners o JOIN computer_accounts a ON a.id = o.account_id') or {}) do
    owners[r.computer_key] = r.username
  end

  local function sessionOf(key)
    local s = sessions[key]
    if not s then return nil end
    local src = Bridge.FindSource(s.cid)
    return { state = s.state, name = src and Bridge.GetName(src) or nil, src = src, at = s.at }
  end

  local entries, stats = {}, { computers = 0, tvs = 0, printers = 0, props = 0, active = 0, locked = 0, setup = 0 }

  for i, loc in ipairs(Config.Locations or {}) do
    local key = 'c' .. i
    entries[#entries + 1] = {
      key = key, kind = 'computer', builtin = true, label = loc.label or key,
      x = loc.coords and loc.coords.x or 0.0, y = loc.coords and loc.coords.y or 0.0, z = loc.coords and loc.coords.z or 0.0,
      accounts = grants[key] or 0, owner = owners[key], session = sessionOf(key),
    }
  end

  for _, r in ipairs(PlacedSnapshot and PlacedSnapshot() or {}) do
    local key = r.kind == 'computer' and ('p' .. r.id) or nil
    local list = r.kind == 'tv' and PC.tvs or r.kind == 'printer' and PC.printers or r.kind == 'computer' and PC.computers or nil
    local variantLabel = r.kind == 'prop' and (AdminProps[r.variant] and AdminProps[r.variant].label) or (list and list[r.variant] and list[r.variant].label) or '?'
    entries[#entries + 1] = {
      id = r.id, key = key, kind = r.kind, label = r.label, variant = r.variant, variantLabel = variantLabel,
      job = r.job, jobs = r.jobs, x = r.x, y = r.y, z = r.z, by = r.created_by, at = r.created_at,
      accounts = key and grants[key] or nil, owner = key and owners[key] or nil, session = key and sessionOf(key) or nil,
    }
  end

  for _, e in ipairs(entries) do
    if e.kind == 'computer' then stats.computers = stats.computers + 1
    elseif e.kind == 'tv' then stats.tvs = stats.tvs + 1
    elseif e.kind == 'printer' then stats.printers = stats.printers + 1
    elseif e.kind == 'prop' then stats.props = stats.props + 1 end
    if e.session then
      if e.session.state == 'active' then stats.active = stats.active + 1 else stats.locked = stats.locked + 1 end
    end
    if e.kind == 'computer' and (e.accounts or 0) == 0 then stats.setup = stats.setup + 1 end
  end

  local props = {}
  for id, p in pairs(AdminProps) do props[#props + 1] = { id = id, model = p.model, label = p.label } end
  table.sort(props, function(a, b) return a.id < b.id end)

  local log = MySQL.query.await('SELECT at, admin, action, detail FROM computer_admin_log ORDER BY id DESC LIMIT ?',
    { math.max(10, tonumber(AD.showLog) or 100) }) or {}

  return {
    stats = stats, entries = entries, props = props, log = log,
    variants = { computer = variantLabels(PC.computers), tv = variantLabels(PC.tvs), printer = variantLabels(PC.printers) },
    now = os.time(),
  }
end

MotCallback.Register('admin:can', function(src, respond)
  respond({ ok = Bridge.IsAdmin(src), refreshMs = tonumber(AD.refreshMs) or 5000 })
end)

MotCallback.Register('admin:snapshot', function(src, respond)
  if not guard(src, respond) then return end
  respond({ ok = true, data = snapshot() })
end)

local function lastWord(s) return tostring(s or ''):gsub('%c', ' '):sub(1, 60) end

--- Sends the machine's current user (if online) a client event.
local function tellUser(cid, event, key)
  local target = cid and Bridge.FindSource(cid)
  if target then TriggerClientEvent(event, target, key) end
end

MotCallback.Register('admin:lock', function(src, respond, key)
  if not guard(src, respond) then return end
  if not validKey(key) then return respond({ ok = false, reason = 'invalid' }) end
  local cid = ComputerSessionForceLock and ComputerSessionForceLock(key)
  if not cid then return respond({ ok = false, reason = 'invalid' }) end
  tellUser(cid, 'as-computer:client:forceLock', key)
  if ComputerLog then ComputerLog(key, 'system', 'admin_lock', 'Locked by an administrator', src, 'warning') end
  AdminLog(src, 'lock', key)
  respond({ ok = true })
end)

MotCallback.Register('admin:kick', function(src, respond, key)
  if not guard(src, respond) then return end
  if not validKey(key) then return respond({ ok = false, reason = 'invalid' }) end
  local cid = ClearComputerSession and ClearComputerSession(key)
  if not cid then return respond({ ok = false, reason = 'invalid' }) end
  if MirrorClear then MirrorClear(key) end
  tellUser(cid, 'as-computer:client:forceCloseComputer', key)
  if ComputerLog then ComputerLog(key, 'system', 'admin_kick', 'Shut down by an administrator', src, 'warning') end
  AdminLog(src, 'kick', key)
  respond({ ok = true })
end)

MotCallback.Register('admin:reset', function(src, respond, key)
  if not guard(src, respond) then return end
  if not validKey(key) then return respond({ ok = false, reason = 'invalid' }) end
  local cid = ClearComputerSession and ClearComputerSession(key)
  Accounts.wipeMachine(key)
  if MirrorClear then MirrorClear(key) end
  tellUser(cid, 'as-computer:client:forceCloseComputer', key)
  if ComputerLog then ComputerLog(key, 'system', 'admin_reset', 'Accounts reset by an administrator', src, 'warning') end
  AdminLog(src, 'reset', key)
  respond({ ok = true })
end)

MotCallback.Register('admin:propAdd', function(src, respond, data)
  if not guard(src, respond) then return end
  data = type(data) == 'table' and data or {}
  local model = tostring(data.model or ''):lower():gsub('%s', '')
  local label = lastWord(data.label)
  if not model:match('^[%w_]+$') or #model > 80 or label == '' then return respond({ ok = false, reason = 'invalid' }) end
  local count = 0
  for _ in pairs(AdminProps) do count = count + 1 end
  if count >= (tonumber(AD.maxProps) or 64) then return respond({ ok = false, reason = 'too_many' }) end
  for _, p in pairs(AdminProps) do
    if p.model == model then return respond({ ok = false, reason = 'exists' }) end
  end
  local id = MySQL.insert.await('INSERT INTO computer_admin_props (model, label) VALUES (?, ?)', { model, label })
  if not id then return respond({ ok = false, reason = 'error' }) end
  AdminProps[id] = { model = model, label = label }
  AdminLog(src, 'prop_add', ('%s (%s)'):format(label, model))
  respond({ ok = true, id = id })
end)

MotCallback.Register('admin:propRemove', function(src, respond, id)
  if not guard(src, respond) then return end
  id = math.floor(tonumber(id) or 0)
  local p = AdminProps[id]
  if not p then return respond({ ok = false, reason = 'invalid' }) end
  MySQL.update.await('DELETE FROM computer_admin_props WHERE id = ?', { id })
  AdminProps[id] = nil
  if PlacedRemoveProp then PlacedRemoveProp(id) end
  AdminLog(src, 'prop_remove', ('%s (%s)'):format(p.label, p.model))
  respond({ ok = true })
end)

--- Model list for the client (to validate a model name before placing).
MotCallback.Register('admin:props', function(src, respond)
  if not guard(src, respond) then return end
  local props = {}
  for id, p in pairs(AdminProps) do props[#props + 1] = { id = id, model = p.model, label = p.label } end
  table.sort(props, function(a, b) return a.id < b.id end)
  respond({ ok = true, props = props })
end)
