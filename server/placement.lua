-- Placed props: computers and TVs that admins put down in-game with /placeprops (object_gizmo), saved in
-- the database and spawned for every player. Placed computers work exactly like Config.Locations ones.
-- Placed TVs can show a Presento presentation (as-browser) cast from a computer, with a keybind clicker.
--
-- Exports used by as-browser (Presento):
--   tvNearby(src)                                   -> { { id, label, dist, busy, mine } }
--   tvCast(src, tvId, deck, slides, slide, step)    -> true | nil, message
--   tvGo(src, tvId, slide, step)                    -> true | nil, message
--   tvStop(src, tvId)                               -> true | nil, message

local PC = Config.Placement or {}
local placed = {}          -- id -> row (kind, variant, x, y, z, rx, ry, rz, label, jobs = { ... })
local casts = {}           -- tvId -> { deck, title, slides, steps = { per slide }, slide, step, by (source), byCid, at }
local ready = false

local function log(fmt, ...) print(('^5[as-computer:placement]^0 ' .. fmt):format(...)) end

local function canPlace(src)
  if src == 0 then return true end
  return IsPlayerAceAllowed(src, 'command.' .. (PC.command or 'placeprops'))
end

local function variants(kind)
  if kind == 'tv' then return PC.tvs or {} end
  if kind == 'printer' then return PC.printers or {} end
  return PC.computers or {}
end

-- ---------------------------------------------------------------------------------------------
-- Database
-- ---------------------------------------------------------------------------------------------

local function decodeJobs(s)
  if type(s) ~= 'string' or s == '' then return nil end
  local ok, t = pcall(json.decode, s)
  if ok and type(t) == 'table' and #t > 0 then return t end
  return nil
end

local function load()
  local rows = MySQL.query.await('SELECT * FROM computer_placed') or {}
  placed = {}
  for _, r in ipairs(rows) do
    r.jobs = decodeJobs(r.jobs)
    placed[r.id] = r
  end
  ready = true
  log('%d placed computers / TVs loaded', #rows)
end

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS computer_placed (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      kind       VARCHAR(12) NOT NULL,
      variant    INT NOT NULL DEFAULT 1,
      label      VARCHAR(60) NOT NULL DEFAULT '',
      jobs       VARCHAR(400) NULL,
      x DOUBLE NOT NULL, y DOUBLE NOT NULL, z DOUBLE NOT NULL,
      rx DOUBLE NOT NULL DEFAULT 0, ry DOUBLE NOT NULL DEFAULT 0, rz DOUBLE NOT NULL DEFAULT 0,
      created_by VARCHAR(80) NOT NULL DEFAULT '',
      created_at INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  load()
end)

--- The list every client spawns from (no creator names, nothing secret).
local function publicList()
  local out = {}
  for id, r in pairs(placed) do
    out[#out + 1] = { id = id, kind = r.kind, variant = r.variant, label = r.label, jobs = r.jobs,
      pos = { x = r.x, y = r.y, z = r.z }, rot = { x = r.rx, y = r.ry, z = r.rz } }
  end
  table.sort(out, function(a, b) return a.id < b.id end)
  return out
end

local function broadcast() TriggerClientEvent('as-computer:client:placedChanged', -1, publicList()) end

--- World position of a placed computer / TV (server/mirror.lua).
function PlacedCoords(id)
  local r = placed[tonumber(id) or 0]
  return r and vector3(r.x, r.y, r.z) or nil
end

-- ---------------------------------------------------------------------------------------------
-- Placing (admins)
-- ---------------------------------------------------------------------------------------------

local function num(v, lo, hi)
  v = tonumber(v)
  if not v or v ~= v or v < lo or v > hi then return nil end
  return v
end

local function cleanPos(p) if type(p) ~= 'table' then return nil end
  local x, y, z = num(p.x, -10000, 10000), num(p.y, -10000, 10000), num(p.z, -1000, 3000)
  if not (x and y and z) then return nil end
  return x, y, z
end

local function cleanRot(r) r = type(r) == 'table' and r or {}
  return num(r.x, -360, 360) or 0.0, num(r.y, -360, 360) or 0.0, num(r.z, -360, 360) or 0.0
end

local function cleanJobs(list)
  if type(list) ~= 'table' then return nil end
  local out = {}
  for _, j in ipairs(list) do
    j = tostring(j):gsub('%s', ''):lower()
    if j:match('^[%w_%-]+$') and #j <= 40 and #out < 12 then out[#out + 1] = j end
  end
  return #out > 0 and out or nil
end

local function cleanLabel(s) return (tostring(s or ''):gsub('%c', ' ')):sub(1, 60) end

MotCallback.Register('placement:can', function(src, respond)
  respond({ ok = canPlace(src) })
end)

MotCallback.Register('placement:list', function(src, respond)
  while not ready do Wait(200) end
  respond(publicList())
end)

--- data = { kind = 'computer'|'tv', variant, pos, rot, label, jobs }
MotCallback.Register('placement:add', function(src, respond, data)
  if not canPlace(src) then return respond({ ok = false, reason = 'not_authorised' }) end
  data = type(data) == 'table' and data or {}
  local kind = (data.kind == 'tv' and 'tv') or (data.kind == 'printer' and 'printer') or (data.kind == 'computer' and 'computer') or nil
  local variant = math.floor(tonumber(data.variant) or 0)
  if not kind or not variants(kind)[variant] then return respond({ ok = false, reason = 'invalid' }) end
  local x, y, z = cleanPos(data.pos)
  if not x then return respond({ ok = false, reason = 'invalid' }) end
  local rx, ry, rz = cleanRot(data.rot)
  local jobs = kind == 'tv' and cleanJobs(data.jobs) or nil
  local label = cleanLabel(data.label)
  if label == '' then label = variants(kind)[variant].label or kind end
  local id = MySQL.insert.await(
    'INSERT INTO computer_placed (kind, variant, label, jobs, x, y, z, rx, ry, rz, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    { kind, variant, label, jobs and json.encode(jobs) or nil, x, y, z, rx, ry, rz, (Bridge.GetName(src) or GetPlayerName(src) or ''):sub(1, 80), os.time() })
  if not id then return respond({ ok = false, reason = 'error' }) end
  placed[id] = { id = id, kind = kind, variant = variant, label = label, jobs = jobs, x = x, y = y, z = z, rx = rx, ry = ry, rz = rz }
  log('%s placed %s #%d (%s) at %.1f %.1f %.1f', GetPlayerName(src) or 'console', kind, id, label, x, y, z)
  broadcast()
  respond({ ok = true, id = id })
end)

--- data = { id, pos, rot }
MotCallback.Register('placement:move', function(src, respond, data)
  if not canPlace(src) then return respond({ ok = false, reason = 'not_authorised' }) end
  data = type(data) == 'table' and data or {}
  local r = placed[tonumber(data.id) or 0]
  local x, y, z = cleanPos(data.pos)
  if not r or not x then return respond({ ok = false, reason = 'invalid' }) end
  local rx, ry, rz = cleanRot(data.rot)
  MySQL.update.await('UPDATE computer_placed SET x = ?, y = ?, z = ?, rx = ?, ry = ?, rz = ? WHERE id = ?', { x, y, z, rx, ry, rz, r.id })
  r.x, r.y, r.z, r.rx, r.ry, r.rz = x, y, z, rx, ry, rz
  broadcast()
  respond({ ok = true })
end)

--- data = { id, label, jobs } - TVs only have jobs.
MotCallback.Register('placement:edit', function(src, respond, data)
  if not canPlace(src) then return respond({ ok = false, reason = 'not_authorised' }) end
  data = type(data) == 'table' and data or {}
  local r = placed[tonumber(data.id) or 0]
  if not r then return respond({ ok = false, reason = 'invalid' }) end
  local label = cleanLabel(data.label)
  if label ~= '' then r.label = label end
  if r.kind == 'tv' then r.jobs = cleanJobs(data.jobs) end
  MySQL.update.await('UPDATE computer_placed SET label = ?, jobs = ? WHERE id = ?', { r.label, r.jobs and json.encode(r.jobs) or nil, r.id })
  broadcast()
  respond({ ok = true })
end)

MotCallback.Register('placement:delete', function(src, respond, id)
  if not canPlace(src) then return respond({ ok = false, reason = 'not_authorised' }) end
  local r = placed[tonumber(id) or 0]
  if not r then return respond({ ok = false, reason = 'invalid' }) end
  MySQL.update.await('DELETE FROM computer_placed WHERE id = ?', { r.id })
  placed[r.id] = nil
  if MirrorClear then MirrorClear('p' .. r.id) end
  if casts[r.id] then casts[r.id] = nil; TriggerClientEvent('as-computer:client:tvState', -1, r.id, nil) end
  log('%s deleted %s #%d', GetPlayerName(src) or 'console', r.kind, r.id)
  broadcast()
  respond({ ok = true })
end)

-- ---------------------------------------------------------------------------------------------
-- TVs: casting Presento decks
-- ---------------------------------------------------------------------------------------------

local RANGE = PC.tvRange or 20.0

local function distTo(src, r)
  local ped = GetPlayerPed(src)
  if not ped or ped == 0 then return math.huge end
  return #(GetEntityCoords(ped) - vector3(r.x, r.y, r.z))
end

local function tvAllowed(src, r)
  if not r.jobs then return true end
  local j = Bridge.GetJob(src)
  if not j then return false end
  for _, name in ipairs(r.jobs) do if name == j.name then return true end end
  return false
end

--- Click steps per slide: how many different `step` numbers animated elements use (same rule as the page).
local function stepCounts(slides)
  local out = {}
  for i, s in ipairs(slides) do
    local seen, n = {}, 0
    for _, e in ipairs(type(s) == 'table' and type(s.els) == 'table' and s.els or {}) do
      if type(e) == 'table' and e.anim then
        local k = tonumber(e.step) or 1
        if not seen[k] then seen[k] = true; n = n + 1 end
      end
    end
    out[i] = n
  end
  return out
end

local function stateOf(c) return { deck = c.deck, title = c.title, slide = c.slide, step = c.step, by = c.by, count = #c.slides, version = c.version } end
local function sendState(tvId) local c = casts[tvId]; TriggerClientEvent('as-computer:client:tvState', -1, tvId, c and stateOf(c) or nil) end

local function mayControl(src, c)
  return c.by == src or canPlace(src)
end

exports('tvNearby', function(src)
  local out = {}
  for id, r in pairs(placed) do
    if r.kind == 'tv' then
      local d = distTo(src, r)
      if d <= RANGE and tvAllowed(src, r) then
        local c = casts[id]
        out[#out + 1] = { id = id, label = r.label, dist = math.floor(d * 10 + 0.5) / 10, busy = c ~= nil and c.by ~= src, mine = c ~= nil and c.by == src, showing = c and c.title or nil }
      end
    end
  end
  table.sort(out, function(a, b) return a.dist < b.dist end)
  return out
end)

exports('tvCast', function(src, tvId, deck, slides, slide, step)
  local r = placed[tonumber(tvId) or 0]
  if not r or r.kind ~= 'tv' then return nil, L('tv_err_gone') end
  if distTo(src, r) > RANGE then return nil, L('tv_err_far') end
  if not tvAllowed(src, r) then return nil, L('tv_err_job') end
  local cur = casts[r.id]
  if cur and cur.by ~= src and GetPlayerPing(cur.by) > 0 and not canPlace(src) then return nil, L('tv_err_busy', cur.title or '') end
  if type(slides) ~= 'table' or #slides == 0 or type(deck) ~= 'table' then return nil, L('tv_err_gone') end
  local c = {
    deck = tostring(deck.id or ''), title = tostring(deck.title or ''):sub(1, 100), slides = slides, steps = stepCounts(slides),
    by = src, byCid = Bridge.GetIdentifier(src), at = os.time(),
  }
  c.slide = math.max(1, math.min(math.floor(tonumber(slide) or 1), #slides))
  c.step = math.max(0, math.min(math.floor(tonumber(step) or 0), c.steps[c.slide] or 0))
  c.version = (cur and cur.version or 0) + 1
  casts[r.id] = c
  sendState(r.id)
  return true
end)

exports('tvGo', function(src, tvId, slide, step)
  local c = casts[tonumber(tvId) or 0]
  if not c then return nil, L('tv_err_notshowing') end
  if not mayControl(src, c) then return nil, L('tv_err_notyours') end
  c.slide = math.max(1, math.min(math.floor(tonumber(slide) or 1), #c.slides))
  c.step = math.max(0, math.min(math.floor(tonumber(step) or 0), c.steps[c.slide] or 0))
  c.at = os.time()
  sendState(tonumber(tvId))
  return true
end)

exports('tvStop', function(src, tvId)
  tvId = tonumber(tvId) or 0
  local c = casts[tvId]
  if not c then return true end
  if not mayControl(src, c) then return nil, L('tv_err_notyours') end
  casts[tvId] = nil
  sendState(tvId)
  return true
end)

-- The clicker keybind: dir = 1 next, -1 back. Only the presenter (or an admin) standing within range.
RegisterNetEvent('as-computer:server:tvStep', function(tvId, dir)
  local src = source
  tvId = tonumber(tvId) or 0
  local c, r = casts[tvId], placed[tvId]
  if not c or not r or not mayControl(src, c) or distTo(src, r) > RANGE then return end
  if dir == 1 then
    if c.step < (c.steps[c.slide] or 0) then c.step = c.step + 1
    elseif c.slide < #c.slides then c.slide, c.step = c.slide + 1, 0
    else return end
  else
    if c.step > 0 then c.step = c.step - 1
    elseif c.slide > 1 then c.slide = c.slide - 1; c.step = c.steps[c.slide] or 0
    else return end
  end
  c.at = os.time()
  sendState(tvId)
end)

RegisterNetEvent('as-computer:server:tvStopMine', function(tvId)
  local src = source
  tvId = tonumber(tvId) or 0
  local c = casts[tvId]
  if c and mayControl(src, c) then casts[tvId] = nil; sendState(tvId) end
end)

-- A client in range asks for the slides of what a TV is showing (big: sent with a latent event).
RegisterNetEvent('as-computer:server:tvSlides', function(tvId)
  local src = source
  tvId = tonumber(tvId) or 0
  local c, r = casts[tvId], placed[tvId]
  if not c or not r or distTo(src, r) > (PC.tvDrawDistance or 30.0) + 20.0 then return end
  TriggerLatentClientEvent('as-computer:client:tvSlides', src, 250000, tvId, c.deck, c.version, c.slides)
end)

-- What every TV is showing right now, for a player who just joined.
MotCallback.Register('tv:states', function(src, respond)
  local out = {}
  for id, c in pairs(casts) do out[tostring(id)] = stateOf(c) end
  respond(out)
end)

AddEventHandler('playerDropped', function()
  local src = source
  for id, c in pairs(casts) do
    if c.by == src then casts[id] = nil; sendState(id) end
  end
end)

-- Nobody touched it for castIdleMinutes: switch it off.
CreateThread(function()
  while true do
    Wait(60000)
    local limit = (PC.castIdleMinutes or 30) * 60
    for id, c in pairs(casts) do
      if os.time() - c.at > limit then casts[id] = nil; sendState(id) end
    end
  end
end)
