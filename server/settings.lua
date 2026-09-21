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
}

local function defaults()
  local d = {}
  for k, v in pairs(cfg().defaults or {}) do d[k] = v end
  if d.lockShow == nil then d.lockShow = Config.LockScreen ~= false end
  if d.weekStart == nil then d.weekStart = (Config.Calendar and Config.Calendar.weekStart) or 1 end
  if d.lang == nil or not Locales[d.lang] then d.lang = Config.Locale or 'en' end
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

MotCallback.Register('settingsInfo', function(src, respond, locIndex)
  if not Bridge.HasComputerJob(src) then return respond({ ok = false, reason = 'not_authorised' }) end
  local job = Bridge.GetJob(src)
  local net = cfg().network or {}
  local online = true
  local b = Config.Browser
  if b and b.enabled == true then online = GetResourceState(b.resource or 'as-browser') == 'started' end
  respond({
    ok = true,
    prefs = Settings.get(src),
    account = { name = Bridge.GetName(src), job = job and job.label or '', grade = job and job.gradeLabel or '', isBoss = job and job.isBoss or false },
    device = deviceInfo(locIndex),
    network = { ssid = net.ssid, band = net.band, protocol = net.protocol, security = net.security, online = online },
    wallpapers = cfg().wallpapers or {},
    allowCustom = cfg().allowCustomWallpaper ~= false,
    languages = languages(),
  })
end)

-- name = 'set', data = { key = value, ... }: unknown keys are ignored; one bad value refuses the whole change.
MotCallback.Register('settingsApi', function(src, respond, name, data)
  if not Bridge.HasComputerJob(src) then return respond({ ok = false, reason = 'not_authorised' }) end
  if name ~= 'set' or type(data) ~= 'table' then return respond({ ok = false, reason = 'invalid' }) end
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

  local cur = mine(cid)
  for k, v in pairs(clean) do
    if v == '' then cur[k] = nil else cur[k] = v end
  end
  local ok, err = pcall(function()
    MySQL.query.await(
      'INSERT INTO computer_settings (citizenid, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
      { cid, json.encode(cur) })
  end)
  if not ok then
    print(('^1[as-computer] saving settings failed: %s^0'):format(tostring(err)))
    return respond({ ok = false, reason = 'error' })
  end
  respond({ ok = true, prefs = Settings.get(src) })
end)
