-- Evidence Reports: the moment a DNA / Fingerprint / Ballistics analysis in the evidence laptop
-- apps confirms a match, this writes an actual report file into a File Explorer folder — no manual
-- step from the officer. New reports land loose in an "Evidence" inbox folder inside the shared
-- Case Files area (Config.LegalFolder); server/mdt.lua's "Link Evidence" action then MOVES a
-- report's folder out of that inbox into the matching case's own folder. See the chat for the
-- report template this was built from.
--
-- This listens for evidences' own local server event `evidences:evidenceItemAnalysed` (fired from
-- evidences/server/dui/callbacks.lua's `evidences:setAnalysed` callback) rather than touching any
-- of evidences' own files, so it survives an evidences update untouched.

EvidenceReports = {}

local GROUP_OWNER_LEGAL = 'legal'   -- must match server/files.lua's own GROUP_OWNER_LEGAL
local EVIDENCE_ROOT_NAME = 'Evidence'
local evidenceRootId = nil

local function now() return os.time() end
local function legalPlace() return { scope = 'group', owner = GROUP_OWNER_LEGAL, folder = '' } end

local function insertRow(kind, name, body, parentId, createdBy, createdByName)
  local p = legalPlace()
  local t = now()
  return MySQL.insert.await(
    'INSERT INTO computer_files (scope, owner, folder, parent_id, kind, name, body, url, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    { p.scope, p.owner, p.folder, parentId or 0, kind, name, body or '', '', createdBy or 'system', createdByName or 'System', t, t }
  )
end

local function findChildFolder(parentId, name)
  local p = legalPlace()
  return MySQL.scalar.await(
    'SELECT id FROM computer_files WHERE deleted_at = 0 AND scope = ? AND owner = ? AND folder = ? AND parent_id = ? AND kind = ? AND name = ? LIMIT 1',
    { p.scope, p.owner, p.folder, parentId, 'folder', name }
  )
end

local function uniqueChildName(parentId, name)
  local p = legalPlace()
  local rows = MySQL.query.await(
    'SELECT name FROM computer_files WHERE deleted_at = 0 AND scope = ? AND owner = ? AND folder = ? AND parent_id = ?',
    { p.scope, p.owner, p.folder, parentId }) or {}
  local used = {}
  for _, r in ipairs(rows) do used[r.name:lower()] = true end
  if not used[name:lower()] then return name end
  local n = 2
  while used[(name .. ' (' .. n .. ')'):lower()] do n = n + 1 end
  return name .. ' (' .. n .. ')'
end

local function ensureEvidenceRoot()
  if evidenceRootId then return evidenceRootId end
  local id = findChildFolder(0, EVIDENCE_ROOT_NAME)
  if not id then id = insertRow('folder', EVIDENCE_ROOT_NAME, '', 0, 'system', 'System') end
  evidenceRootId = id
  return id
end

-- Offline-safe dob/gender lookup, independent of any other file's local framework variable
-- (mirrors Bridge.CharacterName's own dual-schema try-qb/qbox-then-esx approach).
local function citizenDetails(identifier)
  if not identifier then return nil end
  local ok, result = pcall(function()
    local row = MySQL.single.await('SELECT charinfo FROM players WHERE citizenid = ?', { identifier })
    if row and row.charinfo then
      local ci = row.charinfo
      if type(ci) == 'string' then ci = json.decode(ci) end
      if type(ci) == 'table' then
        local gender = ci.gender
        if type(gender) == 'number' then gender = gender == 1 and 'Female' or 'Male' end
        return { dob = ci.birthdate or '', gender = gender or '' }
      end
    end
    local row2 = MySQL.single.await('SELECT dateofbirth FROM users WHERE identifier = ?', { identifier })
    if row2 then return { dob = row2.dateofbirth or '', gender = '' } end
    return nil
  end)
  return ok and result or nil
end

local function fmtDateTime(ts) return os.date('%d %b %Y, %H:%M', ts) end

local function orUnknown(s) return (s and s ~= '') and s or 'Unknown' end

-- The report is stored as the SAME small rich-text HTML fragment the File Explorer editor itself
-- produces (see ui/app.js's FE_TOOLS / FE_HEADINGS and server/files.lua's ALLOWED_TAGS), so it opens
-- looking like every other formatted document in the app - headings, bold field labels, real
-- paragraphs - instead of one run-on line. This is inserted straight into computer_files.body via
-- SQL, bypassing the normal save() sanitizer, so ONLY tags from that allowlist are used here
-- (b, i, u, s, ul/ol/li, br, div, p, h1/h2/h3, font) and every interpolated value is escaped.
local function esc(s)
  s = tostring(s or '')
  return (s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local function field(label, value)
  return '<p><b>' .. esc(label) .. ':</b> ' .. esc(value) .. '</p>'
end

local function buildReport(kind, d)
  local L = {}
  local function add(s) L[#L + 1] = s end

  add('<h1>Forensic Analysis Report</h1>')
  add(field('Case Number', 'Unassigned'))
  add(field('Evidence Type', d.evidenceTypeLabel))
  add(field('Status', 'Match Confirmed'))

  add('<h2>Analysis</h2>')
  add(field('Analysed By', d.officerName))
  add(field('Date & Time', d.analysedAt))

  add('<h2>Subject Matched</h2>')
  add(field('Name', orUnknown(d.subjectName)))
  add(field('Citizen ID', orUnknown(d.identifier)))
  add(field('Date of Birth', orUnknown(d.dob)))
  add(field('Gender', orUnknown(d.gender)))

  add('<h2>Collection Details</h2>')
  add(field('Collected At', orUnknown(d.crimeScene)))
  add(field('Collection Time', orUnknown(d.collectionTime)))
  add(field('Location Notes', (d.additionalData and d.additionalData ~= '') and d.additionalData or '—'))

  if kind == 'ballistics' then
    add('<h2>Weapon Details</h2>')
    add(field('Weapon Type', orUnknown(d.weaponType)))
    add(field('Serial Number', (d.serial and d.serial ~= '') and d.serial or 'Filed off / illegible'))
    add(field('Evidence Type', orUnknown(d.subKind)))
  end

  add('<h2>Notes</h2>')
  add('<p><br></p><p><br></p>')

  add('<p><i>Auto-generated by the Evidence Laptop system.</i></p>')
  return table.concat(L, '')
end

AddEventHandler('evidences:evidenceItemAnalysed', function(source, item)
  local ok, err = pcall(function()
    local metadata = item and item.metadata
    if not metadata then return end

    -- setAnalysed doesn't tell us which type it just marked, so find whichever evidence category
    -- on this item is analysed — an item only ever carries one of these at a time.
    local evidenceType, entry
    for _, t in ipairs({ 'dna', 'fingerprint', 'ballistics' }) do
      if metadata[t] and metadata[t].analysed then evidenceType = t; entry = metadata[t]; break end
    end
    if not evidenceType or not entry or not entry.owner then return end -- no confirmed match, nothing to file

    local info = metadata.information or {}
    local officerName = (Bridge.GetName(source)) or ('Officer #' .. tostring(source))
    local nowTs = now()

    local data = {
      officerName = officerName,
      analysedAt = fmtDateTime(nowTs),
      crimeScene = info.crimeScene or '',
      collectionTime = info.collectionTime or '',
      additionalData = info.additionalData or '',
    }

    local subjectLabel, folderPrefix

    if evidenceType == 'ballistics' then
      -- for ballistics, `entry.owner` is the WEAPON'S SERIAL, not a citizen — see
      -- client/evidences/registry/casing.lua. Registered ownership is a separate, best-effort lookup.
      data.weaponType = entry.weaponType
      data.serial = entry.serial or entry.imperfections
      data.subKind = item.label or 'Ballistics evidence'

      local ownerIdentifier = MySQL.scalar.await('SELECT identifier FROM firearms_registry WHERE serial = ? LIMIT 1', { entry.owner })
      data.identifier = ownerIdentifier
      data.subjectName = ownerIdentifier and Bridge.CharacterName(ownerIdentifier) or nil
      if ownerIdentifier then
        local cd = citizenDetails(ownerIdentifier)
        if cd then data.dob = cd.dob; data.gender = cd.gender end
      end
      subjectLabel = data.subjectName or 'Unregistered Weapon'
      folderPrefix = 'Ballistics'
    else
      data.identifier = entry.owner
      data.subjectName = Bridge.CharacterName(entry.owner)
      local cd = citizenDetails(entry.owner)
      if cd then data.dob = cd.dob; data.gender = cd.gender end
      subjectLabel = data.subjectName or data.identifier
      folderPrefix = evidenceType == 'dna' and 'DNA' or 'Fingerprint'
    end

    data.evidenceTypeLabel = folderPrefix

    local reportText = buildReport(evidenceType, data)
    local rootId = ensureEvidenceRoot()
    local folderName = uniqueChildName(rootId, folderPrefix .. ' — ' .. subjectLabel .. ' — ' .. os.date('%d %b', nowTs))
    local createdBy = Bridge.GetIdentifier(source) or 'system'
    local folderId = insertRow('folder', folderName, '', rootId, createdBy, officerName)
    insertRow('text', 'Report.txt', reportText, folderId, createdBy, officerName)
  end)
  if not ok then
    print('^1[as-computer] evidence report generation failed: ' .. tostring(err) .. '^7')
  end
end)

-- ---- used by server/mdt.lua's "Link Evidence" action ----

local function withFmtDates(rows)
  for _, r in ipairs(rows) do r.created_at = fmtDateTime(tonumber(r.created_at) or 0) end
  return rows
end

--- Evidence report folders still sitting loose in the Evidence inbox, unlinked to any case.
function EvidenceReports.listUnlinked()
  local rootId = ensureEvidenceRoot()
  local p = legalPlace()
  return withFmtDates(MySQL.query.await(
    'SELECT id, name, created_at FROM computer_files WHERE deleted_at = 0 AND scope = ? AND owner = ? AND folder = ? AND parent_id = ? AND kind = ? ORDER BY id DESC',
    { p.scope, p.owner, p.folder, rootId, 'folder' }) or {})
end

-- Evidence is linked INTO the SAME case folder server/mdt.lua's own report-saving already creates
-- and maintains (e.g. "CASE-0001 - Sds Sdsd"), via Files.FindLegalCaseFolder — never a second,
-- differently-named folder for the same case. Inside that folder, linked evidence lands in its own
-- "Evidence" subfolder, created the first time anything is linked to that case.
local EVIDENCE_SUBFOLDER_NAME = 'Evidence'

--- The case's own "Evidence" subfolder inside its real case folder, or nil if either doesn't exist yet.
local function findCaseEvidenceFolder(caseNumber)
  if not caseNumber or caseNumber == '' then return nil end
  local caseFolder = Files.FindLegalCaseFolder(caseNumber)
  if not caseFolder then return nil end
  local subId = findChildFolder(caseFolder.id, EVIDENCE_SUBFOLDER_NAME)
  return subId and { id = subId, caseFolderId = caseFolder.id } or nil
end

--- Evidence report folders currently linked to (moved into) the given case's own "Evidence" subfolder.
function EvidenceReports.listForCase(caseNumber)
  local evFolder = findCaseEvidenceFolder(caseNumber)
  if not evFolder then return {} end
  local p = legalPlace()
  return withFmtDates(MySQL.query.await(
    'SELECT id, name, created_at FROM computer_files WHERE deleted_at = 0 AND scope = ? AND owner = ? AND folder = ? AND parent_id = ? AND kind = ? ORDER BY id DESC',
    { p.scope, p.owner, p.folder, evFolder.id, 'folder' }) or {})
end

--- Moves an evidence report folder out of the Evidence inbox into the case's OWN existing case folder
--- (under an "Evidence" subfolder there, created the first time anything is linked to that case).
--- The case folder itself must already exist (the report must already have been saved with this case
--- number — same precondition server/files.lua's own UpsertLegalReportFileInCase relies on).
function EvidenceReports.linkToCase(folderId, caseNumber)
  if not folderId or not caseNumber or caseNumber == '' then return false end
  local rootId = ensureEvidenceRoot()
  local p = legalPlace()
  local isLoose = MySQL.scalar.await(
    'SELECT id FROM computer_files WHERE deleted_at = 0 AND scope = ? AND owner = ? AND folder = ? AND id = ? AND parent_id = ? AND kind = ?',
    { p.scope, p.owner, p.folder, folderId, rootId, 'folder' })
  if not isLoose then return false end

  local caseFolder = Files.FindLegalCaseFolder(caseNumber)
  if not caseFolder then return false end -- case has no folder yet - save the report first

  local evId = findChildFolder(caseFolder.id, EVIDENCE_SUBFOLDER_NAME)
  if not evId then evId = insertRow('folder', EVIDENCE_SUBFOLDER_NAME, '', caseFolder.id, 'system', 'System') end

  MySQL.update.await('UPDATE computer_files SET parent_id = ?, updated_at = ? WHERE id = ?', { evId, now(), folderId })
  return true
end

--- Moves an evidence report folder back out of the case's "Evidence" subfolder into the Evidence inbox.
function EvidenceReports.unlink(folderId, caseNumber)
  if not folderId then return false end
  local evFolder = caseNumber and findCaseEvidenceFolder(caseNumber)
  local p = legalPlace()
  local ok
  if evFolder then
    ok = MySQL.scalar.await(
      'SELECT id FROM computer_files WHERE deleted_at = 0 AND scope = ? AND owner = ? AND folder = ? AND id = ? AND parent_id = ? AND kind = ?',
      { p.scope, p.owner, p.folder, folderId, evFolder.id, 'folder' })
  else
    ok = true -- best effort if the case's Evidence subfolder can't be resolved
  end
  if not ok then return false end

  local rootId = ensureEvidenceRoot()
  MySQL.update.await('UPDATE computer_files SET parent_id = ?, updated_at = ? WHERE id = ?', { rootId, now(), folderId })
  return true
end
