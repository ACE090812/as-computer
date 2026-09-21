-- App registry + installs (the Store's server side).
--
-- Each app is an entry in Config.Apps (config/apps/<app>.lua). An app with store = true has to be installed
-- from the Store: a boss installs it once and it is stored against the JOB, so everyone on that job has it.
-- Built-in apps (store = false) are always there. `jobs` limits who may install / use an app.

Apps = {}
Apps.available = {}   -- Apps.available.<id> = function() -> bool, set by main.lua when an app needs a resource to be running

local cache = {}      -- cache[job][app] = { installed, paid, by, at }
local ready = false
local busy = {}

local function storeOn() return not (Config.Store and Config.Store.enabled == false) end
Apps.storeOn = storeOn

local function reload()
  local rows = MySQL.query.await(
    "SELECT job, app, installed, paid, installed_name, DATE_FORMAT(installed_at, '%Y-%m-%d %H:%i') AS at FROM computer_apps") or {}
  local fresh = {}
  for _, r in ipairs(rows) do
    fresh[r.job] = fresh[r.job] or {}
    fresh[r.job][r.app] = { installed = r.installed == 1 or r.installed == true, paid = r.paid == 1 or r.paid == true,
                            by = r.installed_name, at = r.at }
  end
  cache = fresh
  ready = true
end

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_apps` (
      `job` VARCHAR(50) NOT NULL,
      `app` VARCHAR(50) NOT NULL,
      `installed` TINYINT(1) NOT NULL DEFAULT 1,
      `paid` TINYINT(1) NOT NULL DEFAULT 0,
      `installed_by` VARCHAR(64) DEFAULT NULL,
      `installed_name` VARCHAR(64) DEFAULT NULL,
      `installed_at` DATETIME DEFAULT NULL,
      PRIMARY KEY (`job`, `app`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  reload()
end)

--- Is the app switched on in the config? Config.EnabledApps.<id> = false, or Config.Apps.<id>.enabled = false, turns it off.
function Apps.enabled(id)
  local sw = Config.EnabledApps
  if type(sw) == 'table' and sw[id] == false then return false end
  local d = Config.Apps and Config.Apps[id]
  return d ~= nil and d.enabled ~= false
end

--- The app's definition, or nil when it does not exist or is switched off. Everything else (state, Store, every
--- app's server gate) goes through this, so a switched-off app disappears everywhere and its callbacks refuse.
function Apps.def(id)
  if type(id) ~= 'string' then return nil end
  if not Apps.enabled(id) then return nil end
  return Config.Apps and Config.Apps[id] or nil
end

--- May this job install / use the app (the app's `jobs` list)?
function Apps.jobAllowed(id, job)
  local d = Apps.def(id)
  if not d then return false end
  local jobs = d.jobs
  if type(jobs) ~= 'table' or #jobs == 0 then return true end
  for _, j in ipairs(jobs) do
    if j == job then return true end
  end
  return false
end

function Apps.isInstalled(job, id)
  local r = cache[job] and cache[job][id]
  return r ~= nil and r.installed == true
end

--- Does this job have the app right now?
function Apps.has(job, id)
  local d = Apps.def(id)
  if not d or not Apps.jobAllowed(id, job) then return false end
  if Apps.available[id] and not Apps.available[id]() then return false end
  if d.store ~= true or not storeOn() then return true end
  return Apps.isInstalled(job, id)
end

--- Server-side gate used by every app's callbacks: computer job + the app is available to that job.
function Apps.allowed(src, id)
  local j = Bridge.GetJob(src)
  return j ~= nil and Bridge.AllowedJobs()[j.name] == true and Apps.has(j.name, id)
end

--- { [appId] = bool } for the player's job (sent to the desktop when it opens).
function Apps.stateFor(src)
  local out = {}
  local j = Bridge.GetJob(src)
  local usable = j ~= nil and Bridge.AllowedJobs()[j.name] == true
  for id in pairs(Config.Apps or {}) do
    out[id] = usable and Apps.has(j.name, id) or false
  end
  return out
end

--- May this player install / uninstall this app for their job? An app's own `manage` overrides Config.Store.manage:
--- 'boss' | 'any' | a minimum grade number.
function Apps.canManage(job, id)
  local d = id and Apps.def(id)
  local rule = d and d.manage
  if rule == nil then rule = Config.Store and Config.Store.manage end
  if rule == nil then rule = 'boss' end
  if rule == 'any' then return true end
  if type(rule) == 'number' then return (job.grade or 0) >= rule end
  return job.isBoss == true
end

local function account(job)
  local f = Config.Store and Config.Store.accountFor
  if type(f) == 'function' then return f(job) end
  return job
end

Apps.account = account

local function appLabel(id)
  local d = Apps.def(id) or {}
  return d.label or L('store_' .. id .. '_name')
end

local function anyPrice()
  for _, d in pairs(Config.Apps or {}) do
    if d.store and (tonumber(d.price) or 0) > 0 then return true end
  end
  return false
end

-- ---- listing -----------------------------------------------------------------------------------------------

local function entry(id, d, job)
  local rec = cache[job.name] and cache[job.name][id]
  local jobs = nil
  if type(d.jobs) == 'table' and #d.jobs > 0 then
    jobs = {}
    for _, j in ipairs(d.jobs) do jobs[#jobs + 1] = { name = j, label = Bridge.JobLabel(j) } end
  end
  return {
    id = id, price = math.max(0, math.floor(tonumber(d.price) or 0)),
    icon = d.icon, tint = d.tint, category = d.category, publisher = d.publisher, version = d.version,
    label = d.label, desc = d.desc, features = d.features, order = d.order,
    jobs = jobs,
    allowed = Apps.jobAllowed(id, job.name),
    canManage = Apps.canManage(job, id),
    installed = rec ~= nil and rec.installed == true,
    paid = rec ~= nil and rec.paid == true,
    installedBy = rec and rec.installed and rec.by or nil,
    installedAt = rec and rec.installed and rec.at or nil,
  }
end

local function list(job)
  local out = {}
  for id, d in pairs(Config.Apps or {}) do
    if Apps.enabled(id) and d.store == true and (not Apps.available[id] or Apps.available[id]()) then
      out[#out + 1] = entry(id, d, job)
    end
  end
  table.sort(out, function(a, b)
    local oa, ob = tonumber(a.order) or 100, tonumber(b.order) or 100
    if oa ~= ob then return oa < ob end
    return a.id < b.id
  end)
  return out
end

-- ---- install / uninstall -----------------------------------------------------------------------------------

local function doInstall(src, job, id, d)
  local rec = cache[job.name] and cache[job.name][id]
  if rec and rec.installed then return { ok = true } end

  local price = math.max(0, math.floor(tonumber(d.price) or 0))
  local charge = (price > 0 and not (rec and rec.paid)) and price or 0
  local acc

  if charge > 0 then
    acc = account(job.name)
    if not Bank.name() then return { ok = false, reason = 'no_bank' } end
    if not Bank.remove(acc, charge, ('App Store: %s'):format(appLabel(id))) then
      return { ok = false, reason = 'no_funds' }
    end
  end

  local paid = (charge > 0 or (rec and rec.paid)) and 1 or 0
  local ok, err = pcall(function()
    MySQL.query.await(
      [[INSERT INTO computer_apps (job, app, installed, paid, installed_by, installed_name, installed_at)
        VALUES (?, ?, 1, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE installed = 1, paid = GREATEST(paid, VALUES(paid)),
          installed_by = VALUES(installed_by), installed_name = VALUES(installed_name), installed_at = NOW()]],
      { job.name, id, paid, Bridge.GetIdentifier(src), Bridge.GetName(src) })
    reload()
  end)
  if not ok then
    print(('^1[as-computer:store] saving the install of %s failed: %s^0'):format(id, tostring(err)))
    if charge > 0 then Bank.add(acc, charge, ('App Store refund: %s'):format(appLabel(id))) end
    return { ok = false, reason = 'error' }
  end
  if Config.Debug then
    print(('[as-computer:store] %s installed %s for job %s (charged %d)'):format(Bridge.GetName(src), id, job.name, charge))
  end
  return { ok = true, charged = charge }
end

local function doUninstall(src, job, id)
  if not Apps.isInstalled(job.name, id) then return { ok = true } end
  MySQL.query.await('UPDATE computer_apps SET installed = 0 WHERE job = ? AND app = ?', { job.name, id })
  reload()
  if Config.Debug then
    print(('[as-computer:store] %s uninstalled %s for job %s'):format(Bridge.GetName(src), id, job.name))
  end
  return { ok = true }
end

--- Tell everyone currently on the job that the app list changed (an open computer refreshes its desktop).
local function broadcast(jobName)
  for _, id in ipairs(GetPlayers()) do
    local pid = tonumber(id)
    local j = Bridge.GetJob(pid)
    if j and j.name == jobName then TriggerClientEvent('as-computer:client:appsChanged', pid) end
  end
end

MotCallback.Register('appsInfo', function(src, respond)
  respond({ apps = Apps.stateFor(src), store = storeOn(), prefs = Settings and Bridge.HasComputerJob(src) and Settings.get(src) or nil })
end)

-- name: 'list' | 'install' | 'uninstall'
MotCallback.Register('storeApi', function(src, respond, name, data)
  if not storeOn() then return respond({ ok = false, reason = 'invalid' }) end
  local job = Bridge.GetJob(src)
  if not job or not Bridge.AllowedJobs()[job.name] then return respond({ ok = false, reason = 'not_authorised' }) end
  if not ready then return respond({ ok = false, reason = 'error' }) end

  if name == 'list' then
    local canManage, paid = false, false
    for id, d in pairs(Config.Apps or {}) do
      if Apps.enabled(id) and d.store == true and Apps.jobAllowed(id, job.name) and Apps.canManage(job, id) then
        canManage = true
        if (tonumber(d.price) or 0) > 0 then paid = true end
      end
    end
    local funds = nil
    if paid and Bank.name() then funds = Bank.balance(account(job.name)) end
    return respond({
      ok = true,
      job = { name = job.name, label = job.label },
      canManage = canManage,
      currency = Config.Store and Config.Store.currency or '£',
      funds = funds,
      apps = list(job),
    })
  end

  local id = type(data) == 'table' and data.id or nil
  local d = Apps.def(id)
  if not d or d.store ~= true then return respond({ ok = false, reason = 'not_found' }) end
  if not Apps.jobAllowed(id, job.name) then return respond({ ok = false, reason = 'not_for_job' }) end
  if not Apps.canManage(job, id) then return respond({ ok = false, reason = 'not_boss' }) end

  if name ~= 'install' and name ~= 'uninstall' then return respond({ ok = false, reason = 'invalid' }) end

  local key = job.name .. ':' .. id
  if busy[key] then return respond({ ok = false, reason = 'error' }) end
  busy[key] = true
  local ok, res = pcall(function()
    if name == 'install' then return doInstall(src, job, id, d) end
    return doUninstall(src, job, id)
  end)
  busy[key] = nil

  if not ok then
    print(('^1[as-computer:store] %s %s failed: %s^0'):format(name, tostring(id), tostring(res)))
    return respond({ ok = false, reason = 'error' })
  end
  if res and res.ok then broadcast(job.name) end
  respond(res)
end)
