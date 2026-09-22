-- File Explorer files (server side). Files and folders (folders can nest) in three places:
--   docs / dl : personal, kept per character (citizenid / identifier)
--   job       : shared by the player's current job
-- A row is a folder, a text file (body kept here), or a link to hosted media (image / video / audio / other file: only the
-- URL is kept here, never the bytes). The page never sends an owner or a job: both come from the character making the request.
--   folders  -> { enabled, job = label|nil, isBoss, phone, limits }
--   tree     -> { folders = { {id,parent,name,place} } }        every folder the player can reach (for the Move / Copy picker)
--   list     -> { files = { {id,name,kind,size,url,updated,by,mine,manage,snippet} }, path = { {id,name} } }   (folder, parent)
--   get      -> { file }
--   save     -> { file }   text file: no id = new file in (folder, parent); with id = new body
--   folder   -> { file }   new folder
--   link     -> { file }   image / video / audio / other file from a link (host must be allowed)
--   rename / delete / copy / move { id, to, parent }
--   phoneList / phoneImport / toPhone   photos to and from sd-phone's Photos app

local function cfg() return Config.Files or {} end
local function on() return cfg().enabled ~= false end
local function maxPer() return math.max(1, math.floor(tonumber(cfg().maxPerFolder) or 200)) end
local function maxTotal() return math.max(1, math.floor(tonumber(cfg().maxTotal) or 1000)) end
local function maxDepth() return math.max(1, math.floor(tonumber(cfg().maxDepth) or 8)) end
local function maxLen() return math.max(100, math.floor(tonumber(cfg().maxLength) or 50000)) end
local function maxName() return math.max(8, math.floor(tonumber(cfg().maxNameLength) or 80)) end
local function binOn() return cfg().recycleBin ~= false end
local function binDays() return math.max(0, math.floor(tonumber(cfg().binDays) or 30)) end
local COPY_CAP = 200      -- rows one copy may create
local TREE_CAP = 5000     -- rows one move / delete may touch

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_files` (
      `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      `scope` VARCHAR(8) NOT NULL,
      `owner` VARCHAR(64) NOT NULL,
      `folder` VARCHAR(8) NOT NULL DEFAULT '',
      `parent_id` INT NOT NULL DEFAULT 0,
      `kind` VARCHAR(8) NOT NULL DEFAULT 'text',
      `name` VARCHAR(255) NOT NULL,
      `body` MEDIUMTEXT NOT NULL,
      `url` VARCHAR(600) NOT NULL DEFAULT '',
      `created_by` VARCHAR(64) NOT NULL,
      `created_by_name` VARCHAR(100) NOT NULL DEFAULT '',
      `created_at` INT NOT NULL,
      `updated_at` INT NOT NULL,
      `deleted_at` INT NOT NULL DEFAULT 0,
      `del_root` TINYINT NOT NULL DEFAULT 0,
      `deleted_by` VARCHAR(100) NOT NULL DEFAULT '',
      KEY `idx_folder` (`scope`, `owner`, `folder`, `parent_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  ]])
  -- A table made by the first version (text files only) gets the new columns.
  if not pcall(function() MySQL.query.await('SELECT kind, parent_id, url FROM computer_files LIMIT 1') end) then
    for _, q in ipairs({
      "ALTER TABLE computer_files ADD COLUMN parent_id INT NOT NULL DEFAULT 0",
      "ALTER TABLE computer_files ADD COLUMN kind VARCHAR(8) NOT NULL DEFAULT 'text'",
      "ALTER TABLE computer_files ADD COLUMN url VARCHAR(600) NOT NULL DEFAULT ''",
    }) do pcall(function() MySQL.query.await(q) end) end
  end
  -- ... and the Recycle Bin columns (deleted_at > 0 = in the bin; del_root = 1 on the item that was deleted, 0 on what was inside it).
  for _, c in ipairs({
    { 'deleted_at', "ALTER TABLE computer_files ADD COLUMN deleted_at INT NOT NULL DEFAULT 0" },
    { 'del_root', "ALTER TABLE computer_files ADD COLUMN del_root TINYINT NOT NULL DEFAULT 0" },
    { 'deleted_by', "ALTER TABLE computer_files ADD COLUMN deleted_by VARCHAR(100) NOT NULL DEFAULT ''" },
  }) do
    if not pcall(function() MySQL.query.await('SELECT ' .. c[1] .. ' FROM computer_files LIMIT 1') end) then
      pcall(function() MySQL.query.await(c[2]) end)
    end
  end
end)

local function cut(s, n)
  local len = utf8.len(s)
  if not len or len <= n then return s end
  return s:sub(1, (utf8.offset(s, n + 1) or (#s + 1)) - 1)
end

-- ---------------------------------------------------------------------------------------------
-- kinds and links
-- ---------------------------------------------------------------------------------------------
local IMG = { png = true, jpg = true, jpeg = true, gif = true, webp = true, bmp = true }
local VID = { mp4 = true, webm = true, mov = true, m4v = true, ogv = true }
local AUD = { mp3 = true, wav = true, ogg = true, m4a = true, aac = true, flac = true }

local function extOf(s)
  local path = tostring(s or ''):match('^[^?#]*') or ''
  local e = path:match('%.([%w]+)$')
  return e and e:lower() or nil
end
local function kindOfExt(e)
  if e and IMG[e] then return 'image' end
  if e and VID[e] then return 'video' end
  if e and AUD[e] then return 'audio' end
  return 'file'
end

--- A clean https URL and its host, or nil.
local function parseUrl(url)
  if type(url) ~= 'string' or #url < 12 or #url > 500 then return nil end
  if url:find('[%c%s\\<>"\'`]') then return nil end
  local host, rest = url:match('^[Hh][Tt][Tt][Pp][Ss]://([%w%.%-]+)(.*)$')
  if not host or host == '' or host:find('%.%.') then return nil end
  if rest ~= '' and not rest:match('^[/?#]') then return nil end   -- no port, no user@
  return url, host:lower()
end

local function hostAllowed(host)
  if cfg().allowAnyHost == true then return true end
  for _, raw in ipairs(cfg().allowedHosts or {}) do
    local e = tostring(raw):lower()
    if e:sub(1, 2) == '*.' then
      local dom = e:sub(3)
      if host == dom or host:sub(-(#dom + 1)) == '.' .. dom then return true end
    elseif e ~= '' and host == e then return true end
  end
  return false
end

-- ---------------------------------------------------------------------------------------------
-- places and permissions
-- ---------------------------------------------------------------------------------------------
local function jobFolder(j)
  if not j or not j.name then return false end
  local ex = cfg().excludeJobs or { unemployed = true }
  if type(ex) == 'table' and ex[j.name] then return false end
  local sf = cfg().sharedFolders
  if type(sf) == 'table' then return sf[j.name] == true end
  return sf ~= false and sf ~= 'off'
end

--- Where a place id points for this player, or nil.
local function place(src, cid, folder)
  if folder == 'docs' or folder == 'dl' then return { scope = 'personal', owner = cid, folder = folder, key = folder } end
  if folder == 'job' then
    local j = Bridge.GetJob(src)
    if jobFolder(j) then return { scope = 'job', owner = j.name, folder = '', isBoss = j.isBoss == true, key = 'job' } end
  end
  return nil
end

local function inPlace(p, row) return row.scope == p.scope and row.owner == p.owner and row.folder == p.folder end
local function samePlace(a, b) return a.scope == b.scope and a.owner == b.owner and a.folder == b.folder end

--- The place a row lives in, but only if this player may see it.
local function placeOfRow(src, cid, row)
  if row.scope == 'personal' then
    if row.owner ~= cid then return nil end
    return place(src, cid, row.folder)
  end
  local j = Bridge.GetJob(src)
  if jobFolder(j) and j.name == row.owner then return { scope = 'job', owner = j.name, folder = '', isBoss = j.isBoss == true, key = 'job' } end
  return nil
end

local function canManage(p, row, cid)
  if p.scope == 'personal' then return true end
  if row.created_by == cid then return true end
  return cfg().bossManagesAll ~= false and p.isBoss == true
end

local function getRow(id)
  if type(id) ~= 'number' or id < 1 then return nil end
  return MySQL.single.await('SELECT * FROM computer_files WHERE id = ?', { id })
end
--- A row that is not in the Recycle Bin.
local function getLive(id)
  local row = getRow(id)
  if row and (row.deleted_at or 0) > 0 then return nil end
  return row
end

--- The parent folder (a row) if it is a folder in that place, true for the top level (0), else nil.
local function getParent(p, pid)
  if pid == 0 then return true end
  local row = getRow(pid)
  if row and row.kind == 'folder' and inPlace(p, row) and (row.deleted_at or 0) == 0 then return row end
  return nil
end

--- How many folders deep a folder id sits (a top-level folder is 1, the top level itself is 0).
local function depthOf(pid)
  local d, cur = 0, pid
  while cur and cur > 0 and d < 64 do
    local row = MySQL.single.await('SELECT parent_id FROM computer_files WHERE id = ?', { cur })
    if not row then break end
    d = d + 1
    cur = row.parent_id
  end
  return d
end

--- Every row under (and including) rootId, parents before children. The second value is true when the cap cut it short.
--- mode 'live' skips anything already in the bin, 'restore' skips items that were binned on their own, 'all' takes everything.
local function subtree(rootId, cap, mode)
  local root = getRow(rootId)
  if not root then return nil end
  local out, frontier = { root }, { rootId }
  local extra = mode == 'live' and ' AND deleted_at = 0' or mode == 'restore' and ' AND del_root = 0' or ''
  while #frontier > 0 do
    local ph = string.rep('?,', #frontier):sub(1, -2)
    local rows = MySQL.query.await('SELECT * FROM computer_files WHERE parent_id IN (' .. ph .. ')' .. extra, frontier) or {}
    frontier = {}
    for _, r in ipairs(rows) do
      out[#out + 1] = r
      if r.kind == 'folder' then frontier[#frontier + 1] = r.id end
    end
    if #out > cap then return out, true end
  end
  return out, false
end

local function isInside(id, candidate)   -- is `candidate` the folder `id` or somewhere below it?
  local cur, n = candidate, 0
  while cur and cur > 0 and n < 64 do
    if cur == id then return true end
    local row = MySQL.single.await('SELECT parent_id FROM computer_files WHERE id = ?', { cur })
    if not row then return false end
    cur = row.parent_id
    n = n + 1
  end
  return false
end

local function heightOf(rows, rootId)   -- deepest folder level below rootId (0 = no sub-folders)
  local depth, best = { [rootId] = 0 }, 0
  for _, r in ipairs(rows) do
    if r.kind == 'folder' and r.id ~= rootId then
      depth[r.id] = (depth[r.parent_id] or 0) + 1
      if depth[r.id] > best then best = depth[r.id] end
    end
  end
  return best
end

local function chunked(ids, fn)
  for i = 1, #ids, 200 do
    local part = {}
    for j = i, math.min(i + 199, #ids) do part[#part + 1] = ids[j] end
    fn(part, string.rep('?,', #part):sub(1, -2))
  end
end

-- ---------------------------------------------------------------------------------------------
-- names, bodies
-- ---------------------------------------------------------------------------------------------
--- Cleans a name; nil when nothing usable is left. Text files get .txt when they have no extension.
local function cleanName(name, kind)
  if type(name) ~= 'string' then return nil end
  name = name:gsub('[%c\\/:*?"<>|]', ''):gsub('%s+', ' ')
  name = name:match('^[%s%.]*(.-)%s*$') or ''
  if name == '' or not utf8.len(name) then return nil end
  name = cut(name, maxName())
  if kind == 'text' and not name:find('%.[%w]+$') then name = cut(name, maxName() - 4) .. '.txt' end
  return name
end

local function splitExt(name)
  local base, ext = name:match('^(.*)(%.[%w]+)$')
  if base and base ~= '' then return base, ext end
  return name, ''
end

--- A name not used in that folder (adds " (2)", " (3)" ... before the extension).
local function uniqueName(p, pid, name, exceptId)
  local rows = MySQL.query.await('SELECT id, name FROM computer_files WHERE deleted_at = 0 AND scope = ? AND owner = ? AND folder = ? AND parent_id = ?',
    { p.scope, p.owner, p.folder, pid }) or {}
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

local function cleanBody(body)
  if type(body) ~= 'string' then return nil end
  body = body:gsub('\0', '')   -- (not %z: that is not a class in Lua 5.4 and would strip the letter z)
  if not utf8.len(body) then return nil end
  return body
end

local function meta(row, cid, p)
  local out = {
    id = row.id, name = row.name, kind = row.kind or 'text', updated = row.updated_at, parent = row.parent_id or 0,
    by = row.created_by_name or '', mine = row.created_by == cid, manage = canManage(p, row, cid),
  }
  if out.kind == 'folder' then
    out.size = row.kids or 0
  elseif out.kind == 'text' then
    out.size = row.size or (row.body and utf8.len(row.body)) or 0
    out.snippet = row.snip or (row.body and cut((row.body:gsub('%s+', ' ')), 160)) or ''
  else
    out.size = 0
    out.url = row.url or ''
  end
  return out
end

local last = {}   -- src -> GetGameTimer() of the last change, so a runaway page cannot hammer the database
local function busy(src)
  local t = GetGameTimer()
  if last[src] and t - last[src] < 150 then return true end
  last[src] = t
  return false
end

local function countIn(p, pid)
  return MySQL.scalar.await('SELECT COUNT(*) FROM computer_files WHERE deleted_at = 0 AND scope = ? AND owner = ? AND folder = ? AND parent_id = ?',
    { p.scope, p.owner, p.folder, pid }) or 0
end
local function countAll(p)
  return MySQL.scalar.await('SELECT COUNT(*) FROM computer_files WHERE deleted_at = 0 AND scope = ? AND owner = ? AND folder = ?', { p.scope, p.owner, p.folder }) or 0
end

local function insertRow(p, pid, kind, name, body, url, cid, cname)
  local now = os.time()
  return MySQL.insert.await(
    'INSERT INTO computer_files (scope, owner, folder, parent_id, kind, name, body, url, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    { p.scope, p.owner, p.folder, pid, kind, name, body or '', url or '', cid, cname, now, now })
end

-- ---------------------------------------------------------------------------------------------
-- sd-phone Photos (public exports; nothing in sd-phone is edited)
-- ---------------------------------------------------------------------------------------------
local function phoneRes()
  if cfg().phoneImport == false then return nil end
  local r = cfg().phoneResource or 'sd-phone'
  if GetResourceState(r) ~= 'started' then return nil end
  return r
end
local function phonePhotos(src, limit)
  local r = phoneRes()
  if not r then return nil end
  local ok, list = pcall(function() return exports[r]:getPhotos(src, { limit = limit or 100 }) end)
  if not ok or type(list) ~= 'table' then return nil end
  local out = {}
  for _, ph in ipairs(list) do
    if type(ph) == 'table' and type(ph.id) == 'string' and parseUrl(ph.url) then
      out[#out + 1] = { id = ph.id, url = ph.url, isVideo = ph.isVideo == true, timestamp = math.floor(tonumber(ph.timestamp) or 0) }
    end
  end
  return out
end

-- ---------------------------------------------------------------------------------------------
-- the callback
-- ---------------------------------------------------------------------------------------------
--- Items in this player's Recycle Bin: what they deleted from Documents / Downloads, and the shared job folder's bin.
local function binRoots(src, cid, limit)
  local out = {}
  local function add(rows) for _, r in ipairs(rows or {}) do out[#out + 1] = r end end
  add(MySQL.query.await(
    "SELECT id, name, kind, scope, owner, folder, parent_id, created_by, created_by_name, deleted_at, deleted_by FROM computer_files " ..
    "WHERE deleted_at > 0 AND del_root = 1 AND scope = 'personal' AND owner = ? ORDER BY deleted_at DESC LIMIT ?", { cid, limit }))
  local p = place(src, cid, 'job')
  if p then
    add(MySQL.query.await(
      "SELECT id, name, kind, scope, owner, folder, parent_id, created_by, created_by_name, deleted_at, deleted_by FROM computer_files " ..
      "WHERE deleted_at > 0 AND del_root = 1 AND scope = 'job' AND owner = ? ORDER BY deleted_at DESC LIMIT ?", { p.owner, limit }))
  end
  table.sort(out, function(a, b) return a.deleted_at > b.deleted_at end)
  return out
end

MotCallback.Register('filesApi', function(src, respond, name, data)
  if not on() or not Apps.allowed(src, 'explorer') then return respond({ ok = false, reason = 'not_authorised' }) end
  local cid = Bridge.GetIdentifier(src)
  if not cid or cid == '' then return respond({ ok = false, reason = 'error' }) end
  data = type(data) == 'table' and data or {}
  local function bad(reason) return respond({ ok = false, reason = reason or 'invalid' }) end
  local cname = cut(tostring(Bridge.GetName(src) or ''), 90)
  local pid = math.floor(tonumber(data.parent) or 0)
  if pid < 0 then pid = 0 end

  if name == 'folders' then
    local j = Bridge.GetJob(src)
    return respond({ ok = true, data = {
      enabled = true,
      job = jobFolder(j) and (j.label or j.name) or nil,
      isBoss = j and j.isBoss == true or false,
      phone = phoneRes() ~= nil,
      recycleBin = binOn(),
      limits = { maxPerFolder = maxPer(), maxLength = maxLen(), maxDepth = maxDepth(), maxNameLength = maxName() },
    } })
  end

  if name == 'tree' then
    local out = {}
    for _, key in ipairs({ 'docs', 'dl', 'job' }) do
      local p = place(src, cid, key)
      if p then
        local rows = MySQL.query.await(
          "SELECT id, parent_id, name FROM computer_files WHERE deleted_at = 0 AND scope = ? AND owner = ? AND folder = ? AND kind = 'folder' ORDER BY name ASC LIMIT 500",
          { p.scope, p.owner, p.folder }) or {}
        for _, r in ipairs(rows) do out[#out + 1] = { id = r.id, parent = r.parent_id, name = r.name, place = key } end
      end
    end
    return respond({ ok = true, data = { folders = out } })
  end

  if name == 'list' then
    local p = place(src, cid, data.folder)
    if not p then return bad() end
    if not getParent(p, pid) then return bad() end
    local rows = MySQL.query.await(
      'SELECT id, name, kind, url, parent_id, CHAR_LENGTH(body) AS size, LEFT(body, 200) AS snip, created_by, created_by_name, updated_at, ' ..
      '(SELECT COUNT(*) FROM computer_files c WHERE c.parent_id = computer_files.id AND c.deleted_at = 0) AS kids ' ..
      'FROM computer_files WHERE deleted_at = 0 AND scope = ? AND owner = ? AND folder = ? AND parent_id = ? ORDER BY name ASC LIMIT ?',
      { p.scope, p.owner, p.folder, pid, maxPer() }) or {}
    local out = {}
    for _, r in ipairs(rows) do
      r.snip = cut((r.snip or ''):gsub('%s+', ' '), 160)
      out[#out + 1] = meta(r, cid, p)
    end
    local path, cur = {}, pid
    while cur > 0 and #path < 64 do
      local row = getRow(cur)
      if not row then break end
      table.insert(path, 1, { id = row.id, name = row.name })
      cur = row.parent_id
    end
    return respond({ ok = true, data = { files = out, path = path } })
  end

  if name == 'phoneList' then
    local list = phonePhotos(src, 100)
    if not list then return bad('unavailable') end
    return respond({ ok = true, data = { photos = list } })
  end

  if name == 'binList' then
    local out = {}
    for _, row in ipairs(binRoots(src, cid, 200)) do
      local p = placeOfRow(src, cid, row)
      if p then
        out[#out + 1] = { id = row.id, name = row.name, kind = row.kind or 'text', place = p.key, deletedAt = row.deleted_at,
          deletedBy = row.deleted_by or '', by = row.created_by_name or '', manage = canManage(p, row, cid) }
      end
    end
    return respond({ ok = true, data = { files = out, days = binDays() } })
  end

  local id = math.floor(tonumber(data.id) or 0)

  if name == 'get' then
    local row = getLive(id)
    local p = row and placeOfRow(src, cid, row)
    if not p or row.kind == 'folder' then return bad() end
    local m = meta(row, cid, p)
    if m.kind == 'text' then m.body = row.body end
    return respond({ ok = true, data = { file = m } })
  end

  if busy(src) then return bad('busy') end

  if name == 'save' then
    local body = cleanBody(data.body == nil and '' or data.body)
    if not body then return bad() end
    if utf8.len(body) > maxLen() then return bad('too_long') end

    if id > 0 then
      local row = getLive(id)
      local p = row and placeOfRow(src, cid, row)
      if not p or row.kind ~= 'text' then return bad() end
      if not canManage(p, row, cid) then return bad('forbidden') end
      local now = os.time()
      MySQL.update.await('UPDATE computer_files SET body = ?, updated_at = ? WHERE id = ?', { body, now, id })
      row.body, row.updated_at = body, now
      return respond({ ok = true, data = { file = meta(row, cid, p) } })
    end

    local p = place(src, cid, data.folder)
    if not p or not getParent(p, pid) then return bad() end
    local nm = cleanName(data.name or '', 'text') or 'New Text Document.txt'
    if countIn(p, pid) >= maxPer() or countAll(p) >= maxTotal() then return bad('too_many') end
    nm = uniqueName(p, pid, nm)
    if not nm then return bad() end
    local newId = insertRow(p, pid, 'text', nm, body, '', cid, cname)
    if not newId then return bad('error') end
    return respond({ ok = true, data = { file = meta(getRow(newId), cid, p) } })
  end

  if name == 'folder' then
    local p = place(src, cid, data.folder)
    if not p or not getParent(p, pid) then return bad() end
    if depthOf(pid) + 1 > maxDepth() then return bad('too_deep') end
    local nm = cleanName(data.name or '', 'folder') or 'New folder'
    if countIn(p, pid) >= maxPer() or countAll(p) >= maxTotal() then return bad('too_many') end
    nm = uniqueName(p, pid, nm)
    if not nm then return bad() end
    local newId = insertRow(p, pid, 'folder', nm, '', '', cid, cname)
    if not newId then return bad('error') end
    return respond({ ok = true, data = { file = meta(getRow(newId), cid, p) } })
  end

  if name == 'link' then
    local p = place(src, cid, data.folder)
    if not p or not getParent(p, pid) then return bad() end
    local url, host = parseUrl(data.url)
    if not url then return bad('bad_link') end
    if not hostAllowed(host) then return bad('host') end
    local kind = kindOfExt(extOf(url))
    local nm = cleanName(data.name or '', kind)
    if not nm then
      local seg = (url:match('^[^?#]*') or ''):match('([^/]+)$')
      nm = seg and cleanName(seg:gsub('%%(%x%x)', function(h) return string.char(tonumber(h, 16)) end), kind) or nil
      nm = nm or cleanName(host, kind) or 'Link'
    end
    if countIn(p, pid) >= maxPer() or countAll(p) >= maxTotal() then return bad('too_many') end
    nm = uniqueName(p, pid, nm)
    if not nm then return bad() end
    local newId = insertRow(p, pid, kind, nm, '', url, cid, cname)
    if not newId then return bad('error') end
    return respond({ ok = true, data = { file = meta(getRow(newId), cid, p) } })
  end

  if name == 'phoneImport' then
    local p = place(src, cid, data.folder)
    if not p or not getParent(p, pid) then return bad() end
    local want = {}
    for _, v in ipairs(type(data.ids) == 'table' and data.ids or {}) do
      if type(v) == 'string' and #want < 20 then want[v] = true end
    end
    local list = phonePhotos(src, 200)
    if not list then return bad('unavailable') end
    local made, skipped = {}, 0
    for _, ph in ipairs(list) do
      if want[ph.id] then
        if countIn(p, pid) >= maxPer() or countAll(p) >= maxTotal() then skipped = skipped + 1
        else
          local e = extOf(ph.url) or (ph.isVideo and 'mp4' or 'jpg')
          local nm = uniqueName(p, pid, ('Photo %s.%s'):format(os.date('%Y-%m-%d %H.%M.%S', ph.timestamp > 0 and ph.timestamp or os.time()), e))
          local newId = nm and insertRow(p, pid, kindOfExt(e) == 'file' and (ph.isVideo and 'video' or 'image') or kindOfExt(e), nm, '', ph.url, cid, cname)
          if newId then made[#made + 1] = meta(getRow(newId), cid, p) else skipped = skipped + 1 end
        end
      end
    end
    return respond({ ok = true, data = { files = made, skipped = skipped } })
  end

  if name == 'toPhone' then
    local row = getLive(id)
    local p = row and placeOfRow(src, cid, row)
    if not p or (row.kind ~= 'image' and row.kind ~= 'video') then return bad() end
    local r = phoneRes()
    if not r then return bad('unavailable') end
    local ok, res = pcall(function() return exports[r]:addPhoto(src, row.url) end)
    if not ok or type(res) ~= 'table' or res.success ~= true then return bad('error') end
    return respond({ ok = true, data = {} })
  end

  if name == 'rename' then
    local row = getLive(id)
    local p = row and placeOfRow(src, cid, row)
    if not p then return bad() end
    if not canManage(p, row, cid) then return bad('forbidden') end
    local nm = cleanName(data.name, row.kind)
    if not nm then return bad() end
    nm = uniqueName(p, row.parent_id, nm, id)
    if not nm then return bad() end
    MySQL.update.await('UPDATE computer_files SET name = ?, updated_at = ? WHERE id = ?', { nm, os.time(), id })
    row.name = nm
    return respond({ ok = true, data = { file = meta(row, cid, p) } })
  end

  if name == 'delete' then
    local row = getLive(id)
    local p = row and placeOfRow(src, cid, row)
    if not p then return bad() end
    local bin = binOn()
    local rows, cutShort = subtree(id, TREE_CAP, bin and 'live' or 'all')
    if cutShort then return bad('too_many') end
    for _, r in ipairs(rows) do
      if not canManage(p, r, cid) then return bad('forbidden') end   -- e.g. a folder holding a workmate's file
    end
    local ids = {}
    for _, r in ipairs(rows) do ids[#ids + 1] = r.id end
    if bin then
      local now, by = os.time(), cut(tostring(Bridge.GetName(src) or ''), 90)
      chunked(ids, function(part, ph)
        local params = { now, by }
        for _, v in ipairs(part) do params[#params + 1] = v end
        MySQL.update.await('UPDATE computer_files SET deleted_at = ?, deleted_by = ? WHERE id IN (' .. ph .. ')', params)
      end)
      MySQL.update.await('UPDATE computer_files SET del_root = 1 WHERE id = ?', { id })
    else
      chunked(ids, function(part, ph) MySQL.update.await('DELETE FROM computer_files WHERE id IN (' .. ph .. ')', part) end)
    end
    return respond({ ok = true, data = { removed = ids, binned = bin } })
  end

  if name == 'restore' then
    local row = getRow(id)
    local p = row and placeOfRow(src, cid, row)
    if not p or (row.deleted_at or 0) == 0 or row.del_root ~= 1 then return bad() end
    local rows, cutShort = subtree(id, TREE_CAP, 'restore')
    if cutShort then return bad('too_many') end
    for _, r in ipairs(rows) do if not canManage(p, r, cid) then return bad('forbidden') end end
    -- back where it was, or the top level when that folder is gone, in the bin, or too deep / full
    local target = row.parent_id or 0
    if target > 0 then
      local par = getRow(target)
      if not (par and par.kind == 'folder' and (par.deleted_at or 0) == 0 and inPlace(p, par)) then target = 0 end
    end
    local h = row.kind == 'folder' and heightOf(rows, id) or 0
    if target > 0 and depthOf(target) + 1 + h > maxDepth() then target = 0 end
    if row.kind == 'folder' and 1 + h > maxDepth() then return bad('too_deep') end
    if countAll(p) + #rows > maxTotal() then return bad('too_many') end
    if target > 0 and countIn(p, target) >= maxPer() then target = 0 end
    if countIn(p, target) >= maxPer() then return bad('too_many') end
    local nm = uniqueName(p, target, row.name)
    if not nm then return bad() end
    local ids = {}
    for _, r in ipairs(rows) do ids[#ids + 1] = r.id end
    chunked(ids, function(part, ph) MySQL.update.await("UPDATE computer_files SET deleted_at = 0, del_root = 0, deleted_by = '' WHERE id IN (" .. ph .. ')', part) end)
    MySQL.update.await('UPDATE computer_files SET parent_id = ?, name = ?, updated_at = ? WHERE id = ?', { target, nm, os.time(), id })
    return respond({ ok = true, data = { id = id, place = p.key } })
  end

  if name == 'purge' then
    local row = getRow(id)
    local p = row and placeOfRow(src, cid, row)
    if not p or (row.deleted_at or 0) == 0 or row.del_root ~= 1 then return bad() end
    local rows, cutShort = subtree(id, TREE_CAP, 'all')
    if cutShort then return bad('too_many') end
    for _, r in ipairs(rows) do if not canManage(p, r, cid) then return bad('forbidden') end end
    local ids = {}
    for _, r in ipairs(rows) do ids[#ids + 1] = r.id end
    chunked(ids, function(part, ph) MySQL.update.await('DELETE FROM computer_files WHERE id IN (' .. ph .. ')', part) end)
    return respond({ ok = true, data = { removed = ids } })
  end

  if name == 'binEmpty' then
    local removed, skipped = 0, 0
    for _, row in ipairs(binRoots(src, cid, 500)) do
      local p = placeOfRow(src, cid, row)
      local rows, cutShort = subtree(row.id, TREE_CAP, 'all')
      local okAll = p and rows and not cutShort
      if okAll then for _, r in ipairs(rows) do if not canManage(p, r, cid) then okAll = false break end end end
      if okAll then
        local ids = {}
        for _, r in ipairs(rows) do ids[#ids + 1] = r.id end
        chunked(ids, function(part, ph) MySQL.update.await('DELETE FROM computer_files WHERE id IN (' .. ph .. ')', part) end)
        removed = removed + 1
      else skipped = skipped + 1 end
    end
    return respond({ ok = true, data = { removed = removed, skipped = skipped } })
  end

  if name == 'copy' or name == 'move' then
    local row = getLive(id)
    local from = row and placeOfRow(src, cid, row)
    local to = place(src, cid, data.to)
    if not from or not to or not getParent(to, pid) then return bad() end
    local same = samePlace(from, to)
    if same and (row.parent_id == pid and name == 'move') then return bad() end
    if row.kind == 'folder' and same and isInside(id, pid) then return bad('inside') end   -- into itself

    local rows, cutShort = subtree(id, name == 'copy' and COPY_CAP or TREE_CAP, 'live')
    if cutShort then return bad('too_many') end
    if row.kind == 'folder' and depthOf(pid) + 1 + heightOf(rows, id) > maxDepth() then return bad('too_deep') end
    if not same and countAll(to) + (name == 'copy' and #rows or 0) > maxTotal() then return bad('too_many') end
    if countIn(to, pid) >= maxPer() and not (name == 'move' and row.parent_id == pid) then return bad('too_many') end

    if name == 'move' then
      for _, r in ipairs(rows) do if not canManage(from, r, cid) then return bad('forbidden') end end
      local nm = uniqueName(to, pid, row.name, id)
      if not nm then return bad() end
      MySQL.update.await('UPDATE computer_files SET parent_id = ?, name = ?, updated_at = ? WHERE id = ?', { pid, nm, os.time(), id })
      if not same then
        local ids = {}
        for _, r in ipairs(rows) do ids[#ids + 1] = r.id end
        chunked(ids, function(part, ph)
          local params = { to.scope, to.owner, to.folder }
          for _, v in ipairs(part) do params[#params + 1] = v end
          MySQL.update.await('UPDATE computer_files SET scope = ?, owner = ?, folder = ? WHERE id IN (' .. ph .. ')', params)
        end)
      end
      return respond({ ok = true, data = { file = meta(getRow(id), cid, to) } })
    end

    -- copy: the top item gets a free name, everything below keeps its own
    local map, rootNew = {}, nil
    for i, r in ipairs(rows) do
      local nm = r.name
      local parent = map[r.parent_id]
      if i == 1 then
        nm = uniqueName(to, pid, r.name)
        parent = pid
      end
      if not nm or not parent then return bad('error') end
      local newId = insertRow(to, parent, r.kind, nm, r.body, r.url, cid, cname)
      if not newId then return bad('error') end
      map[r.id] = newId
      if i == 1 then rootNew = newId end
    end
    return respond({ ok = true, data = { file = meta(getRow(rootNew), cid, to) } })
  end

  bad()
end)

AddEventHandler('playerDropped', function() last[source] = nil end)

-- Items stay in the bin for Config.Files.binDays days (0 = until someone empties it), then go for good.
CreateThread(function()
  Wait(30000)
  while true do
    local days = binDays()
    if binOn() and days > 0 then
      pcall(function() MySQL.update.await('DELETE FROM computer_files WHERE deleted_at > 0 AND deleted_at < ?', { os.time() - days * 86400 }) end)
    end
    Wait(3600000)
  end
end)
