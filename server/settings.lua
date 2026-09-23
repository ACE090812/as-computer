-- Settings app, server side: per-character preferences (computer_settings) plus the read-only info the
-- Settings pages show (account, device, network). Only keys listed in SPEC can ever be saved.

Settings = {}

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_settings` (
      `citizenid` VARCHAR(64) NOT NULL,
      `data` LONGTEXT DEFAULT NULL,
      `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (`citizenid`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
end)

local function cfg() return Config.Settings or {} end

local function enum(...)
  local set = {}
  for _, v in ipairs({ ... }) do set[v] = true end
  return function(v) if set[v] then return v end end
end
local function bool(v) if type(v) == 'boolean' then return v end end
local function int(lo, hi)
  return function(v)
    v = tonumber(v)
    if v and v >= lo and v <= hi then return math.floor(v) end
  end
end

--- https image address that is safe to drop into CSS. '' clears it. Returns the value, or nil = refused.
local function url(v)
  if type(v) ~= 'string' then return nil end
  if v == '' then return '' end
  if cfg().allowCustomWallpaper == false then return nil end
  if #v > 300 or not v:match('^https://[%w%-%.]+[/%w%-%._~:%?#%[%]@!%$&%*%+,;=%%]*$') then return nil end
  local host = v:match('^https://([^/:%?#]+)')
  local hosts = cfg().customWallpaperHosts
  if type(hosts) == 'table' and #hosts > 0 then
    local ok = false
    for _, h in ipairs(hosts) do if host == h then ok = true end end
    if not ok then return nil end
  end
  return v
end

local SPEC = {
  wallpaper     = function(v) if type(v) == 'string' and v:match('^[%w_%-]+$') and #v <= 32 then return v end end,
  wallpaperUrl  = url,
  -- Profile picture (Settings > Accounts). Same https/host rules as wallpaperUrl - '' clears it back to the
  -- default person icon. The password itself never goes through SPEC - see passwordSet/passwordRemove below,
  -- which hash it before it ever touches the database.
  avatar        = url,
  fit           = enum('fill', 'fit', 'stretch', 'tile', 'center'),
  mode          = enum('light', 'dark'),
  accent        = function(v) if type(v) == 'string' and v:match('^#%x%x%x%x%x%x$') then return v:lower() end end,
  accentBars    = bool,
  taskbarAlign  = enum('center', 'left'),
  search        = enum('box', 'icon', 'hidden'),
  lockShow      = bool,
  brightness    = int(10, 100),
  night         = bool,
  nightStrength = int(0, 100),
  clock24       = bool,
  dateFormat    = enum('dmy', 'mdy', 'ymd'),
  weekStart     = function(v) v = tonumber(v); if v == 0 or v == 1 or v == 6 then return v end end,
  lang          = function(v) if type(v) == 'string' and Locales[v] then return v end end,
  wifiOn        = bool,
  -- id of an entry in Config.Settings.network.available, or '' to fall back to the default network. Never
  -- set directly with a password - that goes through the 'wifiConnect' action below, which checks it first.
  wifiNetwork   = function(v) if v == '' then return '' end if type(v) == 'string' and v:match('^[%w_%-]+$') and #v <= 32 then return v end end,
  pinnedApps    = function(v)
    if type(v) ~= 'table' then return nil end
    local out, seen, n = {}, {}, 0
    for _, id in ipairs(v) do
      if type(id) == 'string' and id:match('^[%w_%-]+$') and #id <= 32 and not seen[id] then
        seen[id] = true
        n = n + 1
        out[n] = id
      end
      if n >= 24 then break end
    end
    return out
  end,
  -- Scout (the Browser app) settings: its own theme override ('' = follow the computer's mode above) and
  -- text size, set from the browser's own Settings menu (the 3-dot menu > Settings), not the Settings app.
  scoutTheme    = function(v) if v == '' then return '' end return enum('light', 'dark')(v) end,
  scoutTextSize = enum('small', 'normal', 'large'),
  iconPos       = function(v)
    if type(v) ~= 'table' then return nil end
    local out, n = {}, 0
    for k, p in pairs(v) do
      if type(k) == 'string' and k:match('^[%w_%-]+$') and #k <= 32 and type(p) == 'table' then
        local c, r = tonumber(p.c), tonumber(p.r)
        if c and r and c >= 0 and c <= 60 and r >= 0 and r <= 60 then
          out[k] = { c = math.floor(c), r = math.floor(r) }
          n = n + 1
        end
      end
      if n >= 60 then break end
    end
    return out
  end,
}

local function defaults()
  local d = {}
  for k, v in pairs(cfg().defaults or {}) do d[k] = v end
  if d.lockShow == nil then d.lockShow = Config.LockScreen ~= false end
  if d.weekStart == nil then d.weekStart = (Config.Calendar and Config.Calendar.weekStart) or 1 end
  if d.lang == nil or not Locales[d.lang] then d.lang = Config.Locale or 'en' end
  if d.scoutTheme == nil then d.scoutTheme = '' end
  if d.scoutTextSize == nil then d.scoutTextSize = 'normal' end
  return d
end

local function mine(cid)
  local row = MySQL.scalar.await('SELECT data FROM computer_settings WHERE citizenid = ?', { cid })
  if type(row) ~= 'string' or row == '' then return {} end
  local ok, t = pcall(json.decode, row)
  return (ok and type(t) == 'table') and t or {}
end

--- The character's settings: config defaults with their own choices on top.
function Settings.get(src)
  local out = defaults()
  local cid = Bridge.GetIdentifier(src)
  if cid then
    for k, v in pairs(mine(cid)) do
      if SPEC[k] then out[k] = v end
    end
  end
  return out
end

local function languages()
  local out = {}
  for code, strings in pairs(Locales) do
    out[#out + 1] = { code = code, name = strings.lang_name or code }
  end
  table.sort(out, function(a, b) return a.code < b.code end)
  return out
end

local function hash(s)
  local h = 5381
  for i = 1, #s do h = (h * 33 + s:byte(i)) % 4294967296 end
  return ('%08X'):format(h)
end

-- ---------------------------------------------------------------- sign-in password (lock screen)
-- Not a real authentication system - this is a roleplay lock screen, the same spirit as the deviceId hash
-- above. A password is stored as { salt, hash } under its own key (deliberately left OUT of SPEC, so
-- Settings.get() - which only ever copies SPEC keys back out of the saved row - can never hand the hash to
-- a page). The plain password itself is NEVER stored or sent back anywhere, only checked server-side.
local function randomSalt()
  local out = {}
  for i = 1, 16 do out[i] = ('%02x'):format(math.random(0, 255)) end
  return table.concat(out)
end
local function hashPassword(password, salt)
  local h = hash(salt .. ':' .. password)
  for _ = 1, 999 do h = hash(h .. salt .. password) end
  return h
end
local function passwordCfg() return cfg().password or {} end
local function passwordLen() return math.max(1, math.floor(tonumber(passwordCfg().minLength) or 4)) end
local function passwordMax() return math.max(passwordLen(), math.floor(tonumber(passwordCfg().maxLength) or 32)) end

--- The raw { salt, hash } row for a character, or nil if they have never set one. Direct DB read - never
--- routed through Settings.get(), which is what keeps this out of anything sent to a page.
local function passwordRow(cid)
  local row = mine(cid).password
  return (type(row) == 'table' and type(row.salt) == 'string' and type(row.hash) == 'string') and row or nil
end

--- Whether this player's character has a sign-in password set. Safe to expose (no secret in a boolean).
function Settings.hasPassword(src)
  local cid = Bridge.GetIdentifier(src)
  return cid ~= nil and passwordRow(cid) ~= nil
end

--- true if `password` is this character's current sign-in password (or they have none set at all, so the
--- lock screen never locks a player out because of a password nobody chose).
function Settings.checkPassword(src, password)
  local cid = Bridge.GetIdentifier(src)
  if not cid then return false end
  local row = passwordRow(cid)
  if not row then return true end
  return hashPassword(tostring(password or ''), row.salt) == row.hash
end

local function deviceInfo(locIndex)
  local d = cfg().device or {}
  local idx = tonumber(locIndex) or 1
  local loc = Config.Locations and Config.Locations[idx]
  local name = d.name
  if type(name) == 'function' then name = name(loc, idx) end
  name = tostring(name or ('LSOS-PC-%02d'):format(idx))
  local version = GetResourceMetadata(GetCurrentResourceName(), 'version', 0) or '1.0'
  return {
    name = name, manufacturer = d.manufacturer, model = d.model, processor = d.processor, ram = d.ram,
    graphics = d.graphics, systemType = d.systemType, edition = d.edition or 'Los Santos OS',
    deviceId = ('%s-%s'):format(hash(name), hash(name .. 'as')):sub(1, 17),
    version = version, location = loc and loc.label or nil,
  }
end

--- The Wi-Fi entry a saved `wifiNetwork` id points at, or the default network (id 'default') when it is
--- empty/unknown. Never includes the password.
local function findNetwork(net, id)
  if id and id ~= '' and id ~= 'default' then
    for _, e in ipairs(net.available or {}) do
      if e.id == id then return { id = e.id, ssid = e.ssid, band = e.band, security = e.security, signal = e.signal } end
    end
  end
  return { id = 'default', ssid = net.ssid, band = net.band, security = net.security, signal = 100 }
end

--- Every network the page may list (default + available), each flagged `connected` against the saved id,
--- sorted strongest signal first. No passwords ever go in this list.
local function networkList(net, curId)
  curId = (curId == nil or curId == '') and 'default' or curId
  local out = {
    { id = 'default', ssid = net.ssid, band = net.band, security = net.security, signal = 100, connected = curId == 'default' },
  }
  for _, e in ipairs(net.available or {}) do
    out[#out + 1] = { id = e.id, ssid = e.ssid, band = e.band, security = e.security, signal = e.signal, connected = curId == e.id }
  end
  table.sort(out, function(a, b)
    if a.connected ~= b.connected then return a.connected end
    return (a.signal or 0) > (b.signal or 0)
  end)
  return out
end

--- Merges one key into a character's saved settings row (used by both the generic 'set' action and 'wifiConnect').
local function persist(cid, key, value)
  local cur = mine(cid)
  if value == '' or value == nil then cur[key] = nil else cur[key] = value end
  local ok, err = pcall(function()
    MySQL.query.await(
      'INSERT INTO computer_settings (citizenid, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
      { cid, json.encode(cur) })
  end)
  if not ok then print(('^1[as-computer] saving settings failed: %s^0'):format(tostring(err))) end
  return ok
end

--- The { ssid, band, protocol, security, online, wifiOn, list } block every settings response includes.
local function networkInfo(src, cid, prefs)
  local net = cfg().network or {}
  local wifiOn = prefs.wifiOn ~= false
  local cur = findNetwork(net, prefs.wifiNetwork)
  local online = false
  if wifiOn then
    online = true
    local b = Config.Browser
    if b and b.enabled == true then online = GetResourceState(b.resource or 'as-browser') == 'started' end
  end
  return {
    ssid = wifiOn and cur.ssid or nil, band = wifiOn and cur.band or nil, protocol = net.protocol,
    security = wifiOn and cur.security or nil, online = online, wifiOn = wifiOn,
    list = networkList(net, prefs.wifiNetwork),
  }
end

MotCallback.Register('settingsInfo', function(src, respond, locIndex)
  if not Bridge.HasComputerJob(src) then return respond({ ok = false, reason = 'not_authorised' }) end
  local job = Bridge.GetJob(src)
  local prefs = Settings.get(src)
  respond({
    ok = true,
    prefs = prefs,
    account = { name = Bridge.GetName(src), job = job and job.label or '', grade = job and job.gradeLabel or '', isBoss = job and job.isBoss or false, hasPassword = Settings.hasPassword(src) },
    device = deviceInfo(locIndex),
    network = networkInfo(src, Bridge.GetIdentifier(src), prefs),
    wallpapers = cfg().wallpapers or {},
    allowCustom = cfg().allowCustomWallpaper ~= false,
    languages = languages(),
  })
end)

local wifiAttempt = {}   -- src -> GetGameTimer() of the last try, so a page can't brute-force a network's password

--- name = 'wifiConnect', data = { id, password } -> joins a network from Config.Settings.network.available
--- (or 'default'/'' for the configured default network). The password is checked here, server-side, and is
--- never part of what gets saved or sent back - only the network's id is remembered.
local function wifiConnect(src, respond, data)
  local cid = Bridge.GetIdentifier(src)
  if not cid then return respond({ ok = false, reason = 'error' }) end
  data = type(data) == 'table' and data or {}

  local t = GetGameTimer()
  if wifiAttempt[src] and t - wifiAttempt[src] < 600 then return respond({ ok = false, reason = 'busy' }) end
  wifiAttempt[src] = t

  local net = cfg().network or {}
  local id = tostring(data.id or '')
  local entry
  if id == '' or id == 'default' then
    entry = { id = 'default' }
  else
    for _, e in ipairs(net.available or {}) do if e.id == id then entry = e end end
  end
  if not entry then return respond({ ok = false, reason = 'invalid' }) end
  if entry.password and entry.password ~= '' and tostring(data.password or '') ~= entry.password then
    return respond({ ok = false, reason = 'wrong_password' })
  end

  persist(cid, 'wifiNetwork', entry.id == 'default' and '' or entry.id)
  local prefs = Settings.get(src)
  respond({ ok = true, prefs = prefs, network = networkInfo(src, cid, prefs) })
end

--- name = 'set', data = { key = value, ... }: unknown keys are ignored; one bad value refuses the whole change.
local function wifiSet(src, respond, data)
  if type(data) ~= 'table' then return respond({ ok = false, reason = 'invalid' }) end
  local cid = Bridge.GetIdentifier(src)
  if not cid then return respond({ ok = false, reason = 'error' }) end

  local clean, n = {}, 0
  for k, v in pairs(data) do
    local f = SPEC[k]
    if f then
      local val = f(v)
      if val == nil then
        return respond({ ok = false, reason = k == 'wallpaperUrl' and 'bad_url' or 'invalid' })
      end
      clean[k] = val
      n = n + 1
    end
  end
  if n == 0 then return respond({ ok = false, reason = 'invalid' }) end

  for k, v in pairs(clean) do
    if not persist(cid, k, v) then return respond({ ok = false, reason = 'error' }) end
  end
  local prefs = Settings.get(src)
  respond({ ok = true, prefs = prefs, network = networkInfo(src, cid, prefs) })
end

local pwAttempt = {}   -- src -> GetGameTimer() of the last passwordCheck, so the lock screen can't be brute-forced

--- name = 'passwordSet', data = { current, newPassword, confirm }: sets a sign-in password for the first
--- time, or changes an existing one. Changing one requires the correct `current` password first - there is
--- no recovery path, matching the rest of this feature (a roleplay lock screen, not real account security).
local function passwordSet(src, respond, data)
  local cid = Bridge.GetIdentifier(src)
  if not cid then return respond({ ok = false, reason = 'error' }) end
  data = type(data) == 'table' and data or {}

  if passwordRow(cid) and not Settings.checkPassword(src, data.current) then
    return respond({ ok = false, reason = 'wrong_password' })
  end
  local pw = tostring(data.newPassword or '')
  if pw ~= tostring(data.confirm or '') then return respond({ ok = false, reason = 'mismatch' }) end
  if #pw < passwordLen() or #pw > passwordMax() then return respond({ ok = false, reason = 'bad_length' }) end

  local salt = randomSalt()
  if not persist(cid, 'password', { salt = salt, hash = hashPassword(pw, salt) }) then
    return respond({ ok = false, reason = 'error' })
  end
  respond({ ok = true, account = { hasPassword = true } })
end

--- name = 'passwordRemove', data = { current }: turns the sign-in password off again. Requires the correct
--- current password, same reasoning as passwordSet above.
local function passwordRemove(src, respond, data)
  local cid = Bridge.GetIdentifier(src)
  if not cid then return respond({ ok = false, reason = 'error' }) end
  data = type(data) == 'table' and data or {}
  if not passwordRow(cid) then return respond({ ok = true, account = { hasPassword = false } }) end
  if not Settings.checkPassword(src, data.current) then return respond({ ok = false, reason = 'wrong_password' }) end
  if not persist(cid, 'password', nil) then return respond({ ok = false, reason = 'error' }) end
  respond({ ok = true, account = { hasPassword = false } })
end

--- name = 'passwordCheck', data = { password }: the lock screen's unlock attempt. Rate-limited the same way
--- as wifiConnect above, so it can't be brute-forced from the page.
local function passwordCheck(src, respond, data)
  local t = GetGameTimer()
  if pwAttempt[src] and t - pwAttempt[src] < 600 then return respond({ ok = false, reason = 'busy' }) end
  pwAttempt[src] = t
  data = type(data) == 'table' and data or {}
  if Settings.checkPassword(src, data.password) then return respond({ ok = true }) end
  respond({ ok = false, reason = 'wrong_password' })
end

MotCallback.Register('settingsApi', function(src, respond, name, data)
  if not Bridge.HasComputerJob(src) then return respond({ ok = false, reason = 'not_authorised' }) end
  if name == 'wifiConnect' then return wifiConnect(src, respond, data) end
  if name == 'set' then return wifiSet(src, respond, data) end
  if name == 'passwordSet' then return passwordSet(src, respond, data) end
  if name == 'passwordRemove' then return passwordRemove(src, respond, data) end
  if name == 'passwordCheck' then return passwordCheck(src, respond, data) end
  respond({ ok = false, reason = 'invalid' })
end)

AddEventHandler('playerDropped', function() wifiAttempt[source] = nil; pwAttempt[source] = nil end)
