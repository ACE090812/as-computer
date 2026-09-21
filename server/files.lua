-- File Explorer files (server side). Text files in three folders:
--   docs / dl : personal, kept per character (citizenid / identifier)
--   job       : shared by the player's current job
-- The page never sends an owner or a job: both come from the character making the request.
--   folders -> { enabled, job = label|nil, isBoss, limits }
--   list    -> { files = { {id,name,size,updated,by,mine,manage,snippet} } }        (folder = 'docs'|'dl'|'job')
--   get     -> { file = {..., body} }
--   save    -> { file }   (no id = new file in `folder`; with id = new body)
--   rename / delete / copy { id, to }

local function cfg() return Config.Files or {} end
local function on() return cfg().enabled ~= false end
local function maxPer() return math.max(1, math.floor(tonumber(cfg().maxPerFolder) or 200)) end
local function maxLen() return math.max(100, math.floor(tonumber(cfg().maxLength) or 50000)) end
local function maxName() return math.max(8, math.floor(tonumber(cfg().maxNameLength) or 80)) end

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_files` (
      `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      `scope` VARCHAR(8) NOT NULL,
      `owner` VARCHAR(64) NOT NULL,
      `folder` VARCHAR(8) NOT NULL DEFAULT '',
      `name` VARCHAR(255) NOT NULL,
      `body` MEDIUMTEXT NOT NULL,
      `created_by` VARCHAR(64) NOT NULL,
      `created_by_name` VARCHAR(100) NOT NULL DEFAULT '',
      `created_at` INT NOT NULL,
      `updated_at` INT NOT NULL,
      KEY `idx_folder` (`scope`, `owner`, `folder`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  ]])
end)

local function cut(s, n)
  local len = utf8.len(s)
  if not len or len <= n then return s end
  return s:sub(1, (utf8.offset(s, n + 1) or (#s + 1)) - 1)
end

local function jobFolder(j)
  if not j or not j.name then return false end
  local ex = cfg().excludeJobs or { unemployed = true }
  if type(ex) == 'table' and ex[j.name] then return false end
  local sf = cfg().sharedFolders
  if type(sf) == 'table' then return sf[j.name] == true end
  return sf ~= false and sf ~= 'off'
end

--- Where a folder id points for this player, or nil.
local function place(src, cid, folder)
  if folder == 'docs' or folder == 'dl' then return { scope = 'personal', owner = cid, folder = folder } end
  if folder == 'job' then
    local j = Bridge.GetJob(src)
    if jobFolder(j) then return { scope = 'job', owner = j.name, folder = '', isBoss = j.isBoss == true } end
  end
  return nil
end

local function where(p) return 'scope = ? AND owner = ? AND folder = ?', { p.scope, p.owner, p.folder } end

--- The place a row lives in, but only if this player may see it.
local function placeOfRow(src, cid, row)
  if row.scope == 'personal' then
    if row.owner ~= cid then return nil end
    return place(src, cid, row.folder)
  end
  local j = Bridge.GetJob(src)
  if jobFolder(j) and j.name == row.owner then return { scope = 'job', owner = j.name, folder = '', isBoss = j.isBoss == true } end
  return nil
end

local function canManage(p, row, cid)
  if p.scope == 'personal' then return true end
  if row.created_by == cid then return true end
  return cfg().bossManagesAll ~= false and p.isBoss == true
end

--- Cleans a file name; nil when nothing usable is left.
local function cleanName(name)
  if type(name) ~= 'string' then return nil end
  name = name:gsub('[%c\\/:*?"<>|]', ''):gsub('%s+', ' ')
  name = name:match('^[%s%.]*(.-)%s*$') or ''
  if name == '' or not utf8.len(name) then return nil end
  name = cut(name, maxName())
  if not name:find('%.[%w]+$') then name = cut(name, maxName() - 4) .. '.txt' end
  return name
end

local function splitExt(name)
  local base, ext = name:match('^(.*)(%.[%w]+)$')
  if base and base ~= '' then return base, ext end
  return name, ''
end

--- A name not used in that folder (adds " (2)", " (3)" ... before the extension).
local function uniqueName(p, name, exceptId)
  local w, params = where(p)
  local rows = MySQL.query.await('SELECT id, name FROM computer_files WHERE ' .. w, params) or {}
  local used = {}
  for _, r in ipairs(rows) do if r.id ~= exceptId then used[r.name:lower()] = true end end
  if not used[name:lower()] then return name end
  local base, ext = splitExt(name)
  for i = 2, 999 do
    local cand = ('%s (%d)%s'):format(cut(base, maxName() - #ext - 6), i, ext)
    if not used[cand:lower()] then return cand end
  end
  return nil
end

local function meta(row, cid, p)
  local body = row.body
  return {
    id = row.id, name = row.name, size = row.size or (body and utf8.len(body)) or 0, updated = row.updated_at,
    by = row.created_by_name or '', mine = row.created_by == cid, manage = canManage(p, row, cid),
    snippet = row.snip or (body and cut((body:gsub('%s+', ' ')), 160)) or '',
  }
end

local function cleanBody(body)
  if type(body) ~= 'string' then return nil end
  body = body:gsub('\0', '')   -- (not %z: that is not a class in Lua 5.4 and would strip the letter z)
  if not utf8.len(body) then return nil end
  return body
end

local last = {}   -- src -> GetGameTimer() of the last change, so a runaway page cannot hammer the database
local function busy(src)
  local t = GetGameTimer()
  if last[src] and t - last[src] < 150 then return true end
  last[src] = t
  return false
end

local function count(p)
  local w, params = where(p)
  return MySQL.scalar.await('SELECT COUNT(*) FROM computer_files WHERE ' .. w, params) or 0
end

local function getRow(id)
  if id < 1 then return nil end
  return MySQL.single.await('SELECT * FROM computer_files WHERE id = ?', { id })
end

MotCallback.Register('filesApi', function(src, respond, name, data)
  if not on() or not Apps.allowed(src, 'explorer') then return respond({ ok = false, reason = 'not_authorised' }) end
  local cid = Bridge.GetIdentifier(src)
  if not cid or cid == '' then return respond({ ok = false, reason = 'error' }) end
  data = type(data) == 'table' and data or {}
  local function bad(reason) return respond({ ok = false, reason = reason or 'invalid' }) end

  if name == 'folders' then
    local j = Bridge.GetJob(src)
    return respond({ ok = true, data = {
      enabled = true,
      job = jobFolder(j) and (j.label or j.name) or nil,
      isBoss = j and j.isBoss == true or false,
      limits = { maxPerFolder = maxPer(), maxLength = maxLen() },
    } })
  end

  if name == 'list' then
    local p = place(src, cid, data.folder)
    if not p then return bad() end
    local w, params = where(p)
    params[#params + 1] = maxPer()
    local rows = MySQL.query.await(
      'SELECT id, name, CHAR_LENGTH(body) AS size, LEFT(body, 200) AS snip, created_by, created_by_name, updated_at FROM computer_files WHERE '
      .. w .. ' ORDER BY name ASC LIMIT ?', params) or {}
    local out = {}
    for _, r in ipairs(rows) do
      r.snip = cut((r.snip or ''):gsub('%s+', ' '), 160)
      out[#out + 1] = meta(r, cid, p)
    end
    return respond({ ok = true, data = { files = out } })
  end

  local id = math.floor(tonumber(data.id) or 0)

  if name == 'get' then
    local row = getRow(id)
    local p = row and placeOfRow(src, cid, row)
    if not p then return bad() end
    local m = meta(row, cid, p)
    m.body = row.body
    return respond({ ok = true, data = { file = m } })
  end

  if busy(src) then return bad('busy') end

  if name == 'save' then
    local body = cleanBody(data.body == nil and '' or data.body)
    if not body then return bad() end
    if utf8.len(body) > maxLen() then return bad('too_long') end
    local now = os.time()

    if id > 0 then
      local row = getRow(id)
      local p = row and placeOfRow(src, cid, row)
      if not p then return bad() end
      if not canManage(p, row, cid) then return bad('forbidden') end
      MySQL.update.await('UPDATE computer_files SET body = ?, updated_at = ? WHERE id = ?', { body, now, id })
      row.body, row.updated_at = body, now
      return respond({ ok = true, data = { file = meta(row, cid, p) } })
    end

    local p = place(src, cid, data.folder)
    if not p then return bad() end
    local nm = cleanName(data.name or '') or 'New Text Document.txt'
    if count(p) >= maxPer() then return bad('too_many') end
    nm = uniqueName(p, nm)
    if not nm then return bad() end
    local newId = MySQL.insert.await(
      'INSERT INTO computer_files (scope, owner, folder, name, body, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      { p.scope, p.owner, p.folder, nm, body, cid, cut(tostring(Bridge.GetName(src) or ''), 90), now, now })
    if not newId then return bad('error') end
    local row = getRow(newId)
    return respond({ ok = true, data = { file = meta(row, cid, p) } })
  end

  if name == 'rename' then
    local row = getRow(id)
    local p = row and placeOfRow(src, cid, row)
    if not p then return bad() end
    if not canManage(p, row, cid) then return bad('forbidden') end
    local nm = cleanName(data.name)
    if not nm then return bad() end
    nm = uniqueName(p, nm, id)
    if not nm then return bad() end
    MySQL.update.await('UPDATE computer_files SET name = ?, updated_at = ? WHERE id = ?', { nm, os.time(), id })
    row.name = nm
    return respond({ ok = true, data = { file = meta(row, cid, p) } })
  end

  if name == 'delete' then
    local row = getRow(id)
    local p = row and placeOfRow(src, cid, row)
    if not p then return bad() end
    if not canManage(p, row, cid) then return bad('forbidden') end
    MySQL.update.await('DELETE FROM computer_files WHERE id = ?', { id })
    return respond({ ok = true, data = {} })
  end

  if name == 'copy' then
    local row = getRow(id)
    local from = row and placeOfRow(src, cid, row)
    local to = place(src, cid, data.to)
    if not from or not to then return bad() end
    if from.scope == to.scope and from.owner == to.owner and from.folder == to.folder then return bad() end
    if count(to) >= maxPer() then return bad('too_many') end
    local nm = uniqueName(to, row.name)
    if not nm then return bad() end
    local now = os.time()
    local newId = MySQL.insert.await(
      'INSERT INTO computer_files (scope, owner, folder, name, body, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      { to.scope, to.owner, to.folder, nm, row.body, cid, cut(tostring(Bridge.GetName(src) or ''), 90), now, now })
    if not newId then return bad('error') end
    return respond({ ok = true, data = { file = meta(getRow(newId), cid, to) } })
  end

  bad()
end)

AddEventHandler('playerDropped', function() last[source] = nil end)
