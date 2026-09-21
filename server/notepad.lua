-- Notepad app (server side). Notes belong to the character (their citizenid / identifier), so they follow the player to any
-- computer. The page never sends an owner: it is always the character making the request.
--   list    -> { notes = { { id, title, snippet, updated } }, limits = { maxNotes, maxLength } }
--   get     -> { note = { id, title, body, updated } }
--   save    -> { note = { ... } }   (no id = a new note)
--   delete  -> {}

local function cfg() return Config.Notepad or {} end
local function maxNotes() return math.max(1, math.floor(tonumber(cfg().maxNotes) or 50)) end
local function maxLength() return math.max(100, math.floor(tonumber(cfg().maxLength) or 20000)) end

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_notes` (
      `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      `cid` VARCHAR(64) NOT NULL,
      `title` VARCHAR(200) NOT NULL DEFAULT '',
      `body` MEDIUMTEXT NOT NULL,
      `updated_at` INT NOT NULL,
      KEY `idx_cid` (`cid`, `updated_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  ]])
end)

--- Cuts to at most n characters without splitting a multi-byte character (a split one would be rejected by the database).
local function cut(s, n)
  local len = utf8.len(s)
  if not len or len <= n then return s end
  return s:sub(1, (utf8.offset(s, n + 1) or (#s + 1)) - 1)
end

local function titleOf(body)
  for line in body:gmatch('[^\r\n]+') do
    local t = line:match('^%s*(.-)%s*$')
    if t ~= '' then return cut(t, 60) end
  end
  return ''
end

local function snippetOf(body)
  return cut((body:gsub('%s+', ' ')):match('^%s*(.-)%s*$'), 100)
end

local function summary(row)
  return { id = row.id, title = row.title or '', snippet = snippetOf(row.body or ''), updated = row.updated_at }
end

local last = {}   -- src -> GetGameTimer() of the last save, so a runaway page cannot hammer the database

MotCallback.Register('notesApi', function(src, respond, name, data)
  if not Apps.allowed(src, 'notepad') then return respond({ ok = false, reason = 'not_authorised' }) end
  local cid = Bridge.GetIdentifier(src)
  if not cid or cid == '' then return respond({ ok = false, reason = 'error' }) end
  data = type(data) == 'table' and data or {}

  if name == 'list' then
    local rows = MySQL.query.await(
      'SELECT id, title, LEFT(body, 400) AS body, updated_at FROM computer_notes WHERE cid = ? ORDER BY updated_at DESC, id DESC LIMIT ?',
      { cid, maxNotes() }) or {}
    local out = {}
    for _, r in ipairs(rows) do out[#out + 1] = summary(r) end
    return respond({ ok = true, data = { notes = out, limits = { maxNotes = maxNotes(), maxLength = maxLength() } } })
  end

  local id = math.floor(tonumber(data.id) or 0)

  if name == 'get' then
    local r = MySQL.single.await('SELECT id, title, body, updated_at FROM computer_notes WHERE id = ? AND cid = ?', { id, cid })
    if not r then return respond({ ok = false, reason = 'invalid' }) end
    return respond({ ok = true, data = { note = { id = r.id, title = r.title, body = r.body, updated = r.updated_at } } })
  end

  if name == 'delete' then
    if id < 1 then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM computer_notes WHERE id = ? AND cid = ?', { id, cid })
    return respond({ ok = true, data = {} })
  end

  if name == 'save' then
    local body = type(data.body) == 'string' and data.body or nil
    if not body then return respond({ ok = false, reason = 'invalid' }) end
    body = body:gsub('\0', '')   -- (not %z: that is not a class in Lua 5.4 and would strip the letter z)
    if not utf8.len(body) then return respond({ ok = false, reason = 'invalid' }) end
    if utf8.len(body) > maxLength() then return respond({ ok = false, reason = 'too_long' }) end

    local t = GetGameTimer()
    if last[src] and t - last[src] < 250 then return respond({ ok = false, reason = 'busy' }) end
    last[src] = t

    local title, now = titleOf(body), os.time()
    if id > 0 then
      local n = MySQL.update.await('UPDATE computer_notes SET title = ?, body = ?, updated_at = ? WHERE id = ? AND cid = ?',
        { title, body, now, id, cid })
      if not n or n < 1 then return respond({ ok = false, reason = 'invalid' }) end
    else
      local count = MySQL.scalar.await('SELECT COUNT(*) FROM computer_notes WHERE cid = ?', { cid }) or 0
      if count >= maxNotes() then return respond({ ok = false, reason = 'too_many' }) end
      id = MySQL.insert.await('INSERT INTO computer_notes (cid, title, body, updated_at) VALUES (?, ?, ?, ?)', { cid, title, body, now })
      if not id then return respond({ ok = false, reason = 'error' }) end
    end
    return respond({ ok = true, data = { note = { id = id, title = title, snippet = snippetOf(body), updated = now } } })
  end

  respond({ ok = false, reason = 'invalid' })
end)

AddEventHandler('playerDropped', function() last[source] = nil end)
