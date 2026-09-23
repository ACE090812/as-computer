-- Notepad app (server side). Notes belong to the character (their citizenid / identifier), so they follow the player to any
-- computer. The page never sends an owner: it is always the character making the request.
--   list    -> { notes = { { id, title, snippet, updated } }, limits = { maxNotes, maxLength } }
--   get     -> { note = { id, title, body, updated } }
--   save    -> { note = { ... } }   (no id = a new note)
--   delete  -> {}
--
-- A note's `body` is now a small formatted-text HTML fragment (bold/italic/underline/strikethrough and
-- bulleted/numbered lists), produced by the page's rich-text editor (ui/notepad.js) via the browser's
-- execCommand. It is NEVER trusted as-is: sanitize() below strips it down to a tiny fixed set of plain tags
-- with no attributes at all before it is stored or sent back to anyone, so a tampered client cannot smuggle
-- a <script>, an event-handler attribute, or a javascript: link through this field.

local function cfg() return Config.Notepad or {} end
local function maxNotes() return math.max(1, math.floor(tonumber(cfg().maxNotes) or 50)) end
local function maxLength() return math.max(100, math.floor(tonumber(cfg().maxLength) or 30000)) end

-- Tags the rich-text editor can actually produce. Nothing else is ever allowed through, and every tag is
-- re-emitted with NO attributes at all - EXCEPT `font`, whose `face`/`color` are individually validated
-- against a fixed font list / a strict #rrggbb pattern below (see FONTS / isColor), never passed through raw.
local ALLOWED_TAGS = {
  b = true, strong = true, i = true, em = true, u = true, s = true, strike = true,
  ul = true, ol = true, li = true, br = true, div = true, p = true,
  h1 = true, h2 = true, h3 = true, font = true,
}
local SELF_CLOSING = { br = true }

-- Fixed set of font faces the toolbar can offer. Anything else on a `font face="..."` is dropped.
local FONTS = {
  ['arial'] = 'Arial', ['consolas'] = 'Consolas', ['courier new'] = 'Courier New',
  ['georgia'] = 'Georgia', ['times new roman'] = 'Times New Roman', ['verdana'] = 'Verdana',
  ['comic sans ms'] = 'Comic Sans MS',
}
local function isColor(v) return type(v) == 'string' and v:match('^#%x%x%x%x%x%x$') ~= nil end

local ENTITY_IN = { ['&amp;'] = '&', ['&lt;'] = '<', ['&gt;'] = '>', ['&quot;'] = '"', ['&#39;'] = "'", ['&apos;'] = "'" }
local function decodeEntities(s) return (s:gsub('&%a+;', ENTITY_IN)) end
local function encodeEntities(s) return (s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;')) end

--- Builds a safe `<font ...>` open tag from the client's raw attribute string, keeping only a validated
--- face and/or color. Returns nil (tag dropped entirely, contents kept via the outer loop) if neither survives.
local function fontTag(attrs)
  local face = attrs:match('face%s*=%s*"([^"]*)"') or attrs:match("face%s*=%s*'([^']*)'")
  local color = attrs:match('color%s*=%s*"([^"]*)"') or attrs:match("color%s*=%s*'([^']*)'")
  face = face and FONTS[face:lower()]
  color = isColor(color) and color:lower() or nil
  if not face and not color then return '<font>' end
  local bits = {}
  if face then bits[#bits + 1] = 'face="' .. face .. '"' end
  if color then bits[#bits + 1] = 'color="' .. color .. '"' end
  return '<font ' .. table.concat(bits, ' ') .. '>'
end

--- Turns arbitrary client-supplied HTML into a safe fragment: only ALLOWED_TAGS survive as tags (with every
--- attribute stripped, except `font`'s validated face/color), and anything else - a real <script>, an
--- <img onerror=...>, a stray '<' in typed text - is emitted back as literal, escaped text instead of being
--- dropped or (worse) executed anywhere.
local function sanitize(html)
  local out, i, len = {}, 1, #html
  while i <= len do
    local s, e, closeSlash, name, attrs = html:find('^<(/?)(%a[%w]*)([^>]-)/?>', i)
    if s then
      name = name:lower()
      if ALLOWED_TAGS[name] then
        if SELF_CLOSING[name] then
          out[#out + 1] = '<' .. name .. '>'
        elseif closeSlash == '/' then
          out[#out + 1] = '</' .. name .. '>'
        elseif name == 'font' then
          out[#out + 1] = fontTag(attrs)
        else
          out[#out + 1] = '<' .. name .. '>'
        end
      else
        out[#out + 1] = encodeEntities(html:sub(s, e))
      end
      i = e + 1
    else
      local ltPos = html:find('<', i, true)
      if ltPos == i then
        -- a '<' that isn't the start of any recognisable tag (e.g. "5 < 10"): emit it as literal text and
        -- move on one character, rather than re-searching from the same spot (which would never advance).
        out[#out + 1] = '&lt;'
        i = i + 1
      else
        local chunk = ltPos and html:sub(i, ltPos - 1) or html:sub(i)
        out[#out + 1] = encodeEntities(decodeEntities(chunk))
        if not ltPos then break end
        i = ltPos
      end
    end
  end
  return table.concat(out)
end

--- Sanitized HTML -> plain text (tags dropped, entities decoded), for titles/snippets and length checks.
--- `html` may be a LEFT(body, n)-truncated prefix (the 'list' query below), so also drop a dangling,
--- never-closed tag at the very end instead of leaking it as literal text.
local function plainText(html)
  local text = html:gsub('<br>', '\n'):gsub('</?p>', '\n'):gsub('</div>', '\n'):gsub('</h[123]>', '\n'):gsub('</li>', '\n')
    :gsub('<[^>]+>', ''):gsub('<[^>]*$', '')
  return decodeEntities(text)
end

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

--- body is the sanitized HTML; title/snippet are always derived from its plain-text reading.
local function titleOf(body)
  for line in plainText(body):gmatch('[^\r\n]+') do
    local t = line:match('^%s*(.-)%s*$')
    if t ~= '' then return cut(t, 60) end
  end
  return ''
end

local function snippetOf(body)
  return cut((plainText(body):gsub('%s+', ' ')):match('^%s*(.-)%s*$'), 100)
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
    body = sanitize(body)
    local plainLen = utf8.len(plainText(body))
    if not plainLen then return respond({ ok = false, reason = 'invalid' }) end
    if plainLen > maxLength() then return respond({ ok = false, reason = 'too_long' }) end

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
