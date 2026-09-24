-- MDT app (server side): dashboard, people/vehicle lookup, reports and BOLOs.
-- Ported from the old standalone as-mdt resource's server/main.lua, onto as-computer's own
-- MotCallback.Register('mdtApi', ...) dispatcher (see server/apps.lua's storeApi for the pattern)
-- and as-computer's Bridge (client/server framework bridge) instead of as-mdt's own copy of the
-- same framework-detection code.
--
-- Every branch below starts by requiring Apps.allowed(src, 'mdt') (the same gate every other
-- app's server callbacks use), so this app disappears completely if Config.EnabledApps.mdt = false,
-- if the job isn't in Config.MDT.jobs, or the App is otherwise unavailable.

-- NOTE (verify against your live server): as-computer's own Bridge (server/bridge.lua) has no
-- generic "search all citizens" helper — Apps that need one (this one) fall back to reading the
-- framework's players table directly, same as as-mdt's original code did. This local detection
-- block is new for this file; double check the qb/qbox/esx branches below against your actual
-- schema before relying on People search in production.
local FW = nil
CreateThread(function()
  if GetResourceState('qbx_core') == 'started' then FW = 'qbox'
  elseif GetResourceState('qb-core') == 'started' then FW = 'qbcore'
  elseif GetResourceState('es_extended') == 'started' then FW = 'esx' end
end)

-- ---- schema ---------------------------------------------------------------------------------
-- Table names kept identical to the old as-mdt resource so existing data isn't orphaned.
CreateThread(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_reports` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `title` VARCHAR(160) NOT NULL DEFAULT 'Report',
      `type` VARCHAR(40) NOT NULL DEFAULT 'Incident',
      `involved` VARCHAR(255) NOT NULL DEFAULT '',
      `charges` TEXT NULL,
      `narrative` TEXT NULL,
      `suspect_cid` VARCHAR(64) NULL,
      `suspect_name` VARCHAR(120) NULL,
      `author_cid` VARCHAR(64) NOT NULL,
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `case_number` VARCHAR(20) NULL,
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  -- A table made before case numbers existed gets the new column (guarded, same pattern as
  -- files.lua's own migrations: check information_schema first so this is safe to run repeatedly
  -- against a table that may already have existing rows/columns).
  local hasCaseNumber = MySQL.scalar.await([[
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'mdt_reports' AND column_name = 'case_number'
  ]])
  if not hasCaseNumber or hasCaseNumber == 0 then
    pcall(function() MySQL.query.await('ALTER TABLE mdt_reports ADD COLUMN case_number VARCHAR(20) NULL') end)
  end
  -- Set the moment a report's charges were sent down (xt-prison jail time + one DBS criminal
  -- record per charge, via the "Jail Suspect" button) - not null means it's already been done for
  -- THIS report's charges, so re-clicking the button (e.g. to add more time) never double-files
  -- the same convictions onto the suspect's DBS record.
  local hasJailedAt = MySQL.scalar.await([[
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'mdt_reports' AND column_name = 'jailed_at'
  ]])
  if not hasJailedAt or hasJailedAt == 0 then
    pcall(function() MySQL.query.await('ALTER TABLE mdt_reports ADD COLUMN jailed_at INT NULL') end)
  end
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_bolos` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `title` VARCHAR(160) NOT NULL DEFAULT 'BOLO',
      `plate` VARCHAR(16) NOT NULL DEFAULT '',
      `description` TEXT NULL,
      `active` TINYINT NOT NULL DEFAULT 1,
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_bookings` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `suspect_cid` VARCHAR(64) NOT NULL,
      `suspect_name` VARCHAR(120) NOT NULL DEFAULT '',
      `charges` TEXT NULL,
      `total_months` INT NOT NULL DEFAULT 0,
      `total_fine` INT NOT NULL DEFAULT 0,
      `officer_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `report_id` INT NULL,
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  -- A report's suspect either goes straight to jail (Jail Suspect - guilty plea/no contest) or, if
  -- they plead not guilty, gets sent to court instead. This table is shaped for the Court MDT that
  -- will be built later: judge/defence-solicitor/prosecution-solicitor sign-on and a court date are
  -- all nullable here because nothing populates them yet - reportSendToCourt below only ever fills
  -- report_id/case_number/suspect/charges/status/submitted_*. verdict/sentence_minutes/resolved_at
  -- are for the Court MDT to fill in once a trial concludes (a Guilty verdict would reuse the same
  -- xt-prison + DBS pipeline reportJailSuspect already uses).
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_court_cases` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `report_id` INT NOT NULL,
      `case_number` VARCHAR(20) NULL,
      `suspect_cid` VARCHAR(64) NOT NULL,
      `suspect_name` VARCHAR(120) NULL,
      `charges` TEXT NULL,
      `status` VARCHAR(20) NOT NULL DEFAULT 'awaiting_assignment',
      `judge_cid` VARCHAR(64) NULL,
      `judge_name` VARCHAR(120) NULL,
      `defense_cid` VARCHAR(64) NULL,
      `defense_name` VARCHAR(120) NULL,
      `prosecution_cid` VARCHAR(64) NULL,
      `prosecution_name` VARCHAR(120) NULL,
      `court_date` INT NULL,
      `verdict` VARCHAR(20) NULL,
      `sentence_minutes` INT NULL,
      `resolved_at` INT NULL,
      `submitted_by` VARCHAR(64) NOT NULL,
      `submitted_by_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `submitted_at` INT NOT NULL,
      PRIMARY KEY (`id`),
      KEY `idx_report` (`report_id`),
      KEY `idx_status` (`status`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  -- Same guarded-ALTER pattern as mdt_reports above, for columns added to mdt_court_cases after it
  -- first shipped: which courtroom a hearing is in, each side's private case notes, and whether each
  -- side has disclosed (locking their own notes/witness list as read-only to the other side and to
  -- themselves - un-disclosing re-locks BOTH sides, since blind disclosure only means anything if
  -- it's not one-sided).
  local function addColumnIfMissing(table_, column, ddl)
    local has = MySQL.scalar.await([[
      SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
    ]], { table_, column })
    if not has or has == 0 then
      pcall(function() MySQL.query.await('ALTER TABLE `' .. table_ .. '` ADD COLUMN ' .. ddl) end)
    end
  end
  addColumnIfMissing('mdt_court_cases', 'courtroom', '`courtroom` VARCHAR(60) NULL')
  addColumnIfMissing('mdt_court_cases', 'prosecution_notes', '`prosecution_notes` TEXT NULL')
  addColumnIfMissing('mdt_court_cases', 'defense_notes', '`defense_notes` TEXT NULL')
  addColumnIfMissing('mdt_court_cases', 'prosecution_disclosed', '`prosecution_disclosed` TINYINT NOT NULL DEFAULT 0')
  addColumnIfMissing('mdt_court_cases', 'defense_disclosed', '`defense_disclosed` TINYINT NOT NULL DEFAULT 0')
  addColumnIfMissing('mdt_court_cases', 'summary', '`summary` TEXT NULL')
  addColumnIfMissing('mdt_court_cases', 'fine', '`fine` INT NULL')
  -- One row per witness a side has added ahead of the hearing - pre-trial/bundle purposes only, no
  -- "call to testify" live-hearing mechanic (out of scope for now).
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_court_witnesses` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `court_case_id` INT NOT NULL,
      `side` VARCHAR(12) NOT NULL,
      `name` VARCHAR(120) NOT NULL,
      `note` VARCHAR(255) NULL,
      `added_by` VARCHAR(64) NOT NULL,
      `added_by_name` VARCHAR(120) NOT NULL DEFAULT 'Solicitor',
      `added_at` INT NOT NULL,
      PRIMARY KEY (`id`),
      KEY `idx_case` (`court_case_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  -- A motion either side files to the judge (e.g. "drop charge X", "admit this evidence"). Can be
  -- filed/ruled on any time before the verdict - there's no separate "live hearing" state gating it.
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_court_motions` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `court_case_id` INT NOT NULL,
      `side` VARCHAR(12) NOT NULL,
      `filed_by` VARCHAR(64) NOT NULL,
      `filed_by_name` VARCHAR(120) NOT NULL DEFAULT 'Solicitor',
      `text` TEXT NOT NULL,
      `status` VARCHAR(10) NOT NULL DEFAULT 'pending',
      `ruling_text` VARCHAR(255) NULL,
      `ruled_by_name` VARCHAR(120) NULL,
      `filed_at` INT NOT NULL,
      `ruled_at` INT NULL,
      PRIMARY KEY (`id`),
      KEY `idx_case` (`court_case_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_vehicle_status` (
      `plate` VARCHAR(16) NOT NULL,
      `insured` TINYINT NOT NULL DEFAULT 0,
      `insurance_expiry` DATE NULL,
      `taxed` TINYINT NOT NULL DEFAULT 0,
      `tax_expiry` DATE NULL,
      `impounded` TINYINT NOT NULL DEFAULT 0,
      `impound_reason` VARCHAR(255) NULL,
      `impounded_by` VARCHAR(120) NULL,
      `updated_by` VARCHAR(120) NULL,
      `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (`plate`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_vehicle_notes` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `plate` VARCHAR(16) NOT NULL DEFAULT '',
      `note` TEXT NULL,
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `plate` (`plate`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_vehicle_photos` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `plate` VARCHAR(16) NOT NULL DEFAULT '',
      `url` VARCHAR(500) NOT NULL DEFAULT '',
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `plate` (`plate`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_person_notes` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `cid` VARCHAR(64) NOT NULL DEFAULT '',
      `note` TEXT NULL,
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `cid` (`cid`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_person_photos` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `cid` VARCHAR(64) NOT NULL DEFAULT '',
      `url` VARCHAR(500) NOT NULL DEFAULT '',
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `cid` (`cid`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
end)

-- ---- helpers ----------------------------------------------------------------------------------

--- Uses the framework's own job grade number directly, same rule as as-mdt's Config.Permissions.
local function gradeAllowed(job, minGrade)
  minGrade = minGrade or (Config.MDT and Config.MDT.adminMinGrade) or 0
  if minGrade <= 0 then return true end
  return (job and job.grade or 0) >= minGrade
end

local function normDate(v)
  if v == nil then return nil end
  local s = tostring(v)
  if s:match('^%d+$') then
    local n = tonumber(s)
    if n and n > 100000000 then
      if n > 100000000000 then n = math.floor(n / 1000) end
      return os.date('%Y-%m-%d', n)
    end
  end
  return s:sub(1, 10)
end

function MdtVehImpoundStatus(plate)
  local row = MySQL.single.await('SELECT impounded, impound_reason, impounded_by FROM mdt_vehicle_status WHERE plate = ?', { plate })
  if not row then return { impounded = false } end
  return { impounded = row.impounded == 1, reason = row.impound_reason, by = row.impounded_by }
end

-- Insurance, tax and MOT are NOT tracked by MDT itself — they live in as-browser's Los Santos
-- Government / CoverCompare websites (the same ones the in-phone browser's vehicle checker
-- reads), so MDT asks that resource for the live state via its `getVehicleStatus` export rather
-- than keeping its own copy that would drift out of sync with what the vehicle checker shows.
-- Falls back to "none" for everything if as-browser isn't running or the plate is unknown to it.
local function getRealVehicleStatus(plate)
  local none = { state = 'none' }
  local ok, status = pcall(function() return exports['as-browser']:getVehicleStatus(plate) end)
  if not ok or type(status) ~= 'table' then return none, none, nil end

  local insurance = { state = status.insured and 'valid' or 'none',
    date = status.insuranceEndsAt and os.date('%Y-%m-%d', status.insuranceEndsAt) or nil,
    provider = status.insuranceProvider }

  local tax = none
  if status.tax then
    if status.tax.status == 'exempt' then tax = { state = 'valid' }
    elseif status.tax.status == 'taxed' then tax = { state = 'valid', date = status.tax.expiry and os.date('%Y-%m-%d', status.tax.expiry) or nil }
    elseif status.tax.status == 'untaxed' then tax = { state = 'expired', date = status.tax.expiry and os.date('%Y-%m-%d', status.tax.expiry) or nil }
    end
  end

  local mot = nil
  if status.mot and status.mot.enabled then
    if status.mot.status == 'valid' then
      mot = { passed = true, expired = false, expiresAt = status.mot.expiry and os.date('%Y-%m-%d', status.mot.expiry) or nil }
    elseif status.mot.status == 'expired' then
      mot = { passed = true, expired = true, expiresAt = status.mot.expiry and os.date('%Y-%m-%d', status.mot.expiry) or nil }
    elseif status.mot.status == 'failed' then
      mot = { passed = false, expired = false }
    end
  end

  return insurance, tax, mot
end

-- ---- report file template ------------------------------------------------------------------
-- Builds the formatted HTML that gets written into the report's file in Case Files, instead of
-- one flat run-on line of "Label: value" pairs. Uses only the tags File Explorer's rich-text
-- files allow (h1-h3, b, p, br, ul/li - see server/files.lua's ALLOWED_TAGS), and escapes every
-- officer-entered value so stray '<'/'&' in a narrative can't break the layout.

local REPORT_TEMPLATES = {
  Incident          = { title = 'Incident Report' },
  Arrest            = { title = 'Arrest Report' },
  ['Traffic Stop']  = { title = 'Traffic Stop Report' },
  Investigation     = { title = 'Investigation Report' },
  ['Use of Force']  = { title = 'Use of Force Report' },
  ['Field Interview'] = { title = 'Field Interview Report' },
}

local function escHtml(s)
  return (tostring(s or ''):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local function nlToBr(s) return (escHtml(s):gsub('\r?\n', '<br>')) end

--- MySQL TIMESTAMP columns can come back as a unix-seconds (or -ms) number depending on the
--- driver, or as a datetime string - handle both rather than tostring()-ing a raw epoch number.
local function fmtWhen(v)
  if v == nil or v == '' then return '' end
  local n = tonumber(v)
  if n then
    if n > 100000000000 then n = n / 1000 end
    return os.date('%d %b %Y, %H:%M', math.floor(n))
  end
  return tostring(v):gsub('%.0$', ''):sub(1, 16)
end

local function chargeItems(charges)
  local items = {}
  if not charges or charges == '' then return items end
  for part in (charges .. ','):gmatch('([^,]*),') do
    local t = part:match('^%s*(.-)%s*$')
    if t ~= '' then items[#items + 1] = t end
  end
  return items
end

-- Same "CODE - Title" parsing ui/mdt.js's parseChargeString does client-side, resolved against the
-- server's own Config.MDT.charges (the source 'chargesList' itself reads from) so the Jail Suspect
-- button's default sentence and its DBS entries always match what the officer sees on the report.
local function resolvedCharges(charges)
  local out = {}
  for _, entry in ipairs(chargeItems(charges)) do
    local code, title = entry:match('^(%S+)%s*%-%s*(.+)$')
    local def = nil
    if code then
      for _, ch in ipairs(Config.MDT and Config.MDT.charges or {}) do
        if ch.code == code then def = ch; break end
      end
    end
    out[#out + 1] = {
      code = code, title = def and def.title or (title or entry),
      type = def and def.type or nil, months = def and def.months or nil, fine = def and def.fine or nil,
    }
  end
  return out
end

local function kvLine(label, value)
  if not value or value == '' then return '' end
  return '<p><b>' .. escHtml(label) .. ':</b> ' .. escHtml(value) .. '</p>'
end

local function buildReportBody(reportId, caseNumber, row)
  local tpl = REPORT_TEMPLATES[row.type] or { title = (row.type or 'Incident') .. ' Report' }
  local out = {}
  out[#out + 1] = '<h2>' .. escHtml(tpl.title) .. '</h2>'
  out[#out + 1] = '<p><b>Case ' .. escHtml(caseNumber) .. '</b> — Report #' .. escHtml(reportId) .. '</p>'
  out[#out + 1] = '<p><b>Filed by:</b> ' .. escHtml(row.author_name) .. '<br><b>Filed:</b> ' .. escHtml(fmtWhen(row.created_at)) .. '</p>'
  out[#out + 1] = '<h3>' .. escHtml(row.title ~= '' and row.title or 'Untitled') .. '</h3>'
  out[#out + 1] = kvLine('Suspect', row.suspect_name)
  out[#out + 1] = kvLine('Involved', row.involved)
  local charges = chargeItems(row.charges)
  if #charges > 0 then
    local ul = { '<p><b>Charges</b></p><ul>' }
    for _, c in ipairs(charges) do ul[#ul + 1] = '<li>' .. escHtml(c) .. '</li>' end
    ul[#ul + 1] = '</ul>'
    out[#out + 1] = table.concat(ul)
  end
  local narrative = row.narrative
  if narrative == nil or narrative == '' then
    out[#out + 1] = '<p><b>Narrative</b></p><p>(none provided)</p>'
  elseif narrative:match('^%s*<') then
    -- Written with the rich-text narrative editor (Bold/Italic/Underline/Lists, or a template) -
    -- already safe HTML from a small, controlled set of tags execCommand produces, so it's
    -- inserted as-is rather than escaped, which would otherwise dump raw tags onto the page.
    out[#out + 1] = '<p><b>Narrative</b></p><div>' .. narrative .. '</div>'
  else
    out[#out + 1] = '<p><b>Narrative</b></p><p>' .. nlToBr(narrative) .. '</p>'
  end
  return table.concat(out)
end

-- ---- case numbers ------------------------------------------------------------------------------
-- Format CASE-0001, CASE-0002, ... zero-padded to at least 4 digits (grows past 5+ digits rather
-- than truncating once a server passes 9999 reports). Multiple reports may share one case number;
-- only the auto-generate path below is allowed to mint a brand-new one.

local function nextCaseNumber()
  local rows = MySQL.query.await(
    "SELECT case_number FROM mdt_reports WHERE case_number REGEXP '^CASE-[0-9]+$'") or {}
  local best = 0
  for _, r in ipairs(rows) do
    local n = tonumber((r.case_number or ''):match('^CASE%-(%d+)$'))
    if n and n > best then best = n end
  end
  return ('CASE-%04d'):format(best + 1)
end

--- Suspect names (deduplicated, in first-added order) across every report currently filed under
--- this case number. Used to name/rename the case's shared folder in the legal group folder.
local function caseSuspectNames(caseNumber)
  if not caseNumber or caseNumber == '' then return {} end
  local rows = MySQL.query.await(
    'SELECT suspect_name FROM mdt_reports WHERE case_number = ? ORDER BY id ASC', { caseNumber }) or {}
  local seen, names = {}, {}
  for _, r in ipairs(rows) do
    local nm = r.suspect_name
    if nm and nm ~= '' and not seen[nm] then
      seen[nm] = true
      names[#names + 1] = nm
    end
  end
  return names
end

--- { {name, job, grade, cid, onDuty}, ... } for every currently-connected officer on an MDT job.
local function jobsSet()
  local set = {}
  for _, j in ipairs(Config.MDT and Config.MDT.jobs or {}) do set[j] = true end
  return set
end

local function getOnDutyUnits()
  local units, allow = {}, jobsSet()
  for _, id in ipairs(GetPlayers()) do
    local src = tonumber(id)
    local job = Bridge.GetJob(src)
    if job and allow[job.name] then
      units[#units + 1] = { name = Bridge.GetName(src), job = job.name, jobLabel = job.label, grade = job.grade or 0, onDuty = true }
    end
  end
  return units
end

-- ---- people (citizen) search: reads the framework's own players table -----------------------

local function searchCitizens(query)
  local q = '%' .. (query or '') .. '%'
  local rows = {}
  if FW == 'qbcore' or FW == 'qbox' then
    rows = MySQL.query.await([[
      SELECT citizenid, charinfo FROM players
      WHERE JSON_EXTRACT(charinfo,'$.firstname') LIKE ? OR JSON_EXTRACT(charinfo,'$.lastname') LIKE ? OR citizenid LIKE ?
      LIMIT 30
    ]], { q, q, q }) or {}
  elseif FW == 'esx' then
    rows = MySQL.query.await([[
      SELECT identifier AS citizenid, firstname, lastname, dateofbirth FROM users
      WHERE firstname LIKE ? OR lastname LIKE ? OR identifier LIKE ? LIMIT 30
    ]], { q, q, q }) or {}
  end
  local out = {}
  for _, r in ipairs(rows) do
    local first, last, dob, phone = '', '', '', ''
    if r.charinfo then
      local ok, ci = pcall(json.decode, r.charinfo)
      if ok and ci then first = ci.firstname or ''; last = ci.lastname or ''; dob = ci.birthdate or ''; phone = ci.phone or '' end
    else
      first = r.firstname or ''; last = r.lastname or ''; dob = r.dateofbirth or ''
    end
    out[#out + 1] = { cid = r.citizenid, name = (first .. ' ' .. last), dob = dob, phone = phone }
  end
  return out
end

local function getCitizen(cid)
  if not cid then return nil end
  local person = { cid = cid }
  if FW == 'qbcore' or FW == 'qbox' then
    local row = MySQL.single.await('SELECT citizenid, charinfo FROM players WHERE citizenid = ?', { cid })
    if row and row.charinfo then
      local ok, ci = pcall(json.decode, row.charinfo)
      if ok and ci then
        person.name = (ci.firstname or '') .. ' ' .. (ci.lastname or '')
        person.dob = ci.birthdate or ''; person.phone = ci.phone or ''
        -- qb/qbox store gender as either a plain string or the old 0/1 numeric convention -
        -- handle both rather than assuming one.
        if type(ci.gender) == 'number' then person.gender = ci.gender == 1 and 'Female' or 'Male'
        elseif type(ci.gender) == 'string' and ci.gender ~= '' then person.gender = ci.gender end
        person.nationality = (type(ci.nationality) == 'string' and ci.nationality ~= '') and ci.nationality or nil
      end
    end
  elseif FW == 'esx' then
    local row = MySQL.single.await('SELECT identifier, firstname, lastname, dateofbirth, phone_number FROM users WHERE identifier = ?', { cid })
    if row then
      person.name = (row.firstname or '') .. ' ' .. (row.lastname or '')
      person.dob = row.dateofbirth or ''; person.phone = row.phone_number or ''
    end
  end

  -- vehicles owned, via Bridge's own table/column helpers (already handles qb/qbox/esx).
  local vehs = {}
  local ok = pcall(function()
    vehs = MySQL.query.await(('SELECT plate, vehicle FROM %s WHERE %s = ? LIMIT 20'):format(Bridge.VehicleTable(), Bridge.VehicleOwnerColumn()), { cid }) or {}
  end)
  if ok then
    for _, v in ipairs(vehs) do v.vehicle = Bridge.VehicleModelLabel(v.vehicle) end
  end

  -- booking / criminal history: reports where this person is the named suspect, plus processed bookings.
  local reports = MySQL.query.await(
    'SELECT id, title, type, involved, charges, narrative, author_name, created_at FROM mdt_reports WHERE suspect_cid = ? ORDER BY id DESC', { cid }) or {}
  for _, r in ipairs(reports) do r.created_at = fmtWhen(r.created_at) end

  local bookings = MySQL.query.await(
    'SELECT id, charges, total_months, total_fine, officer_name, report_id, created_at FROM mdt_bookings WHERE suspect_cid = ? ORDER BY id DESC LIMIT 30', { cid }) or {}
  for _, b in ipairs(bookings) do
    b.created_at = fmtWhen(b.created_at)
    local ok2, ch = pcall(json.decode, b.charges or '[]')
    b.charges = ok2 and ch or {}
  end

  local notes = MySQL.query.await(
    'SELECT id, note, author_name, created_at FROM mdt_person_notes WHERE cid = ? ORDER BY id DESC', { cid }) or {}
  for _, n in ipairs(notes) do n.created_at = fmtWhen(n.created_at) end

  local photos = MySQL.query.await(
    'SELECT id, url, author_name, created_at FROM mdt_person_photos WHERE cid = ? ORDER BY id DESC', { cid }) or {}
  for _, ph in ipairs(photos) do ph.created_at = fmtWhen(ph.created_at) end

  person.vehicles = vehs
  person.reports = reports
  person.bookings = bookings
  person.notes = notes
  person.photos = photos

  -- Forensics (from the `evidences` resource, folded into this profile instead of its own
  -- separate Citizens app): evidences' own citizen sync is on the same `citizenid`, so `cid` here
  -- IS its `identifier` column directly — no cross-resource call needed, just read its tables.
  if GetResourceState('evidences') == 'started' then
    local ok = pcall(function()
      local bio = MySQL.single.await([[
        SELECT lf.fingerprint, ld.dna
        FROM (SELECT ? AS identifier) AS dummy
        LEFT JOIN linked_fingerprint lf ON dummy.identifier = lf.identifier
        LEFT JOIN linked_dna ld ON dummy.identifier = ld.identifier
      ]], { cid })
      person.biometrics = { fingerprint = bio and bio.fingerprint or nil, dna = bio and bio.dna or nil }

      person.firearms = MySQL.query.await(
        'SELECT serial, label, imagePath, status, identifier, reason, registeredBy, registeredAt FROM firearms_registry WHERE identifier = ? ORDER BY registeredAt DESC LIMIT 20',
        { cid }) or {}
    end)
    if not ok then person.biometrics = nil; person.firearms = nil end
  end

  return person
end

-- ---- vehicles -----------------------------------------------------------------------------

local function searchVehicles(query)
  local q = '%' .. (query or '') .. '%'
  local rows = {}
  local ok = pcall(function()
    rows = MySQL.query.await(([[
      SELECT plate, vehicle FROM %s WHERE plate LIKE ? LIMIT 30
    ]]):format(Bridge.VehicleTable()), { q }) or {}
  end)
  if not ok then return {} end
  local out = {}
  for _, r in ipairs(rows) do
    out[#out + 1] = { plate = r.plate, model = Bridge.VehicleModelLabel(r.vehicle) }
  end
  return out
end

local function getVehicle(plate)
  if not plate then return nil end
  local model, ownerCid = '', nil
  local ok = pcall(function()
    local row = MySQL.single.await(
      ('SELECT plate, vehicle, %s AS owner_cid FROM %s WHERE plate = ? LIMIT 1'):format(Bridge.VehicleOwnerColumn(), Bridge.VehicleTable()), { plate })
    if row then model = Bridge.VehicleModelLabel(row.vehicle) or ''; ownerCid = row.owner_cid end
  end)

  local ownerName = 'Unknown'
  if ownerCid then
    local nm = Bridge.CharacterName(ownerCid)
    if nm then ownerName = nm end
  end

  local bolos = MySQL.query.await(
    'SELECT id, title, description, active, author_name, created_at FROM mdt_bolos WHERE plate = ? ORDER BY active DESC, id DESC', { plate }) or {}
  for _, b in ipairs(bolos) do b.created_at = fmtWhen(b.created_at); b.active = (b.active == 1) end

  local insurance, tax, mot = getRealVehicleStatus(plate)

  local impound = MdtVehImpoundStatus(plate)

  local notes = MySQL.query.await(
    'SELECT id, note, author_name, created_at FROM mdt_vehicle_notes WHERE plate = ? ORDER BY id DESC', { plate }) or {}
  for _, n in ipairs(notes) do n.created_at = fmtWhen(n.created_at) end

  local photos = MySQL.query.await(
    'SELECT id, url, author_name, created_at FROM mdt_vehicle_photos WHERE plate = ? ORDER BY id DESC', { plate }) or {}
  for _, p in ipairs(photos) do p.created_at = fmtWhen(p.created_at) end

  return { plate = plate, model = model, owner = ownerName, ownerCid = ownerCid, bolos = bolos, insurance = insurance, tax = tax, mot = mot, impound = impound, notes = notes, photos = photos }
end

-- ---- dispatcher ---------------------------------------------------------------------------
-- name: 'boot' | 'dashboard' | 'peopleSearch' | 'personGet' | 'vehicleSearch' | 'vehicleGet' |
--       'vehicleSetStatus' | 'vehicleToggleImpound' | 'reportsList' | 'reportGet' | 'reportSave' |
--       'reportDelete' | 'bolosList' | 'boloSave' | 'boloToggle' | 'boloDelete' | 'chargesList'
MotCallback.Register('mdtApi', function(src, respond, name, data)
  data = type(data) == 'table' and data or {}
  local job = Bridge.GetJob(src)
  if not job or not Apps.allowed(src, 'mdt') then return respond({ ok = false, reason = 'not_authorised' }) end
  local isAdmin = gradeAllowed(job)

  if name == 'boot' then
    return respond({ ok = true, data = {
      officer = { name = Bridge.GetName(src), cid = Bridge.GetIdentifier(src), job = job.name, jobLabel = job.label, grade = job.grade or 0 },
      isAdmin = isAdmin,
      reportTypes = { 'Incident', 'Arrest', 'Traffic Stop', 'Investigation', 'Use of Force', 'Field Interview' },
    } })
  end

  if name == 'dashboard' then
    local reportCount = MySQL.scalar.await('SELECT COUNT(*) FROM mdt_reports') or 0
    local boloCount = MySQL.scalar.await('SELECT COUNT(*) FROM mdt_bolos WHERE active = 1') or 0
    local recentReports = MySQL.query.await('SELECT id, title, type, author_name, created_at FROM mdt_reports ORDER BY id DESC LIMIT 6') or {}
    for _, r in ipairs(recentReports) do r.created_at = fmtWhen(r.created_at) end
    local activeBolos = MySQL.query.await('SELECT id, title, plate, created_at FROM mdt_bolos WHERE active = 1 ORDER BY id DESC LIMIT 5') or {}
    for _, b in ipairs(activeBolos) do b.created_at = fmtWhen(b.created_at) end
    local units = getOnDutyUnits()
    return respond({ ok = true, data = {
      reportCount = reportCount, boloCount = boloCount, recentReports = recentReports, activeBolos = activeBolos,
      units = units, onDutyCount = #units,
    } })
  end

  if name == 'peopleSearch' then
    return respond({ ok = true, data = { people = searchCitizens(data.query) } })
  end

  if name == 'personGet' then
    local p = getCitizen(data.cid)
    if not p then return respond({ ok = false, reason = 'not_found' }) end
    return respond({ ok = true, data = { person = p } })
  end

  if name == 'personNoteAdd' then
    local cid = (data.cid or ''):sub(1, 64)
    local note = (data.note or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if cid == '' or note == '' then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.insert.await('INSERT INTO mdt_person_notes (cid, note, author_name) VALUES (?, ?, ?)',
      { cid, note:sub(1, 2000), Bridge.GetName(src) })
    return respond({ ok = true, data = { person = getCitizen(cid) } })
  end

  if name == 'personNoteDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id or not data.cid then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM mdt_person_notes WHERE id = ?', { data.id })
    return respond({ ok = true, data = { person = getCitizen(data.cid) } })
  end

  if name == 'personPhotoAdd' then
    local cid = (data.cid or ''):sub(1, 64)
    local url = (data.url or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if cid == '' or url == '' then return respond({ ok = false, reason = 'invalid' }) end
    if not url:match('^https?://') then return respond({ ok = false, reason = 'invalid_url' }) end
    MySQL.insert.await('INSERT INTO mdt_person_photos (cid, url, author_name) VALUES (?, ?, ?)',
      { cid, url:sub(1, 500), Bridge.GetName(src) })
    return respond({ ok = true, data = { person = getCitizen(cid) } })
  end

  if name == 'personPhotoDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id or not data.cid then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM mdt_person_photos WHERE id = ?', { data.id })
    return respond({ ok = true, data = { person = getCitizen(data.cid) } })
  end

  -- Biometric linking: DNA/fingerprint samples are physical evidence items (`evidences`' own
  -- "Collected Blood"/"Collected Fingerprint" items) sitting in the requesting officer's OWN
  -- inventory once analysed - there is no human-typed code anywhere. `mode = 'list'` reads the
  -- officer's own inventory (exactly like evidences' own DNA/fingerprint app does for `source`)
  -- and returns analysed samples with the internal code already attached, so the UI only ever
  -- shows a pick-list; `mode = 'link'` takes one of those codes straight back and writes it into
  -- evidences' own linked_dna/linked_fingerprint tables (same DELETE-then-INSERT evidences' own
  -- callback performs), so evidences' laptop apps immediately see the match too.
  if name == 'personLinkBiometric' then
    if GetResourceState('evidences') ~= 'started' then return respond({ ok = false, reason = 'no_evidences' }) end
    local btype = data.type
    if btype ~= 'dna' and btype ~= 'fingerprint' then return respond({ ok = false, reason = 'invalid' }) end

    if data.mode == 'list' then
      local items = exports.ox_inventory:GetInventoryItems(src)
      local out = {}
      for _, item in pairs(items or {}) do
        local metadata = item.metadata or {}
        local bio = metadata[btype]
        if bio and bio.owner and bio.analysed then
          local info = metadata.information or {}
          out[#out + 1] = {
            slot = item.slot,
            code = bio.owner,
            label = metadata.label or item.label,
            crimeScene = info.crimeScene or '',
            collectedAt = metadata.createdAt or '',
          }
        end
      end
      return respond({ ok = true, data = { samples = out } })
    end

    if data.mode == 'link' then
      local cid = (data.cid or ''):sub(1, 64)
      local code = data.code
      if cid == '' or not code or code == '' then return respond({ ok = false, reason = 'invalid' }) end

      -- confirm `code` really is a sample the officer is currently holding, rather than trusting
      -- whatever the client sends - never write a code we haven't just seen in this officer's own
      -- inventory ourselves.
      local items = exports.ox_inventory:GetInventoryItems(src)
      local found = false
      for _, item in pairs(items or {}) do
        local bio = (item.metadata or {})[btype]
        if bio and bio.owner == code and bio.analysed then found = true; break end
      end
      if not found then return respond({ ok = false, reason = 'unknown_code' }) end

      MySQL.update.await(('DELETE FROM linked_%s WHERE identifier = ?'):format(btype), { cid })
      MySQL.insert.await(
        ('INSERT INTO linked_%s (%s, identifier) VALUES (?, ?) ON DUPLICATE KEY UPDATE identifier = ?'):format(btype, btype),
        { code, cid, cid })

      return respond({ ok = true, data = { person = getCitizen(cid) } })
    end

    return respond({ ok = false, reason = 'invalid' })
  end

  if name == 'vehicleSearch' then
    return respond({ ok = true, data = { vehicles = searchVehicles(data.query) } })
  end

  if name == 'vehicleGet' then
    local v = getVehicle(data.plate)
    if not v then return respond({ ok = false, reason = 'not_found' }) end
    return respond({ ok = true, data = { vehicle = v } })
  end

  if name == 'vehicleToggleImpound' then
    if not data.plate or data.plate == '' then return respond({ ok = false, reason = 'invalid' }) end
    local cur = MdtVehImpoundStatus(data.plate)
    local newState = not cur.impounded
    MySQL.query.await([[
      INSERT INTO mdt_vehicle_status (plate, impounded, impound_reason, impounded_by) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE impounded = VALUES(impounded), impound_reason = VALUES(impound_reason), impounded_by = VALUES(impounded_by)
    ]], { data.plate, newState and 1 or 0, newState and (data.reason or 'Flagged from MDT') or nil, newState and Bridge.GetName(src) or nil })
    return respond({ ok = true, data = { vehicle = getVehicle(data.plate) } })
  end

  if name == 'vehicleNoteAdd' then
    local plate = (data.plate or ''):sub(1, 16)
    local note = (data.note or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if plate == '' or note == '' then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.insert.await('INSERT INTO mdt_vehicle_notes (plate, note, author_name) VALUES (?, ?, ?)',
      { plate, note:sub(1, 2000), Bridge.GetName(src) })
    return respond({ ok = true, data = { vehicle = getVehicle(plate) } })
  end

  if name == 'vehicleNoteDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id or not data.plate then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM mdt_vehicle_notes WHERE id = ?', { data.id })
    return respond({ ok = true, data = { vehicle = getVehicle(data.plate) } })
  end

  if name == 'vehiclePhotoAdd' then
    local plate = (data.plate or ''):sub(1, 16)
    local url = (data.url or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if plate == '' or url == '' then return respond({ ok = false, reason = 'invalid' }) end
    if not url:match('^https?://') then return respond({ ok = false, reason = 'invalid_url' }) end
    MySQL.insert.await('INSERT INTO mdt_vehicle_photos (plate, url, author_name) VALUES (?, ?, ?)',
      { plate, url:sub(1, 500), Bridge.GetName(src) })
    return respond({ ok = true, data = { vehicle = getVehicle(plate) } })
  end

  if name == 'vehiclePhotoDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id or not data.plate then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM mdt_vehicle_photos WHERE id = ?', { data.id })
    return respond({ ok = true, data = { vehicle = getVehicle(data.plate) } })
  end

  if name == 'reportsList' then
    local rows = MySQL.query.await(
      'SELECT id, title, type, involved, suspect_cid, suspect_name, author_name, case_number, created_at FROM mdt_reports ORDER BY id DESC LIMIT 100') or {}
    for _, r in ipairs(rows) do r.created_at = fmtWhen(r.created_at) end
    return respond({ ok = true, data = { reports = rows } })
  end

  if name == 'reportGet' then
    if not data.id then return respond({ ok = false, reason = 'invalid' }) end
    local r = MySQL.single.await(
      'SELECT id, title, type, involved, charges, narrative, suspect_cid, suspect_name, author_name, case_number, jailed_at, created_at FROM mdt_reports WHERE id = ?', { data.id })
    if not r then return respond({ ok = false, reason = 'not_found' }) end
    r.created_at = fmtWhen(r.created_at)
    -- So the UI can grey out "Jail Suspect" up front rather than let the officer fill in a time
    -- and only find out on click that xt-prison needs the suspect online (it works off their
    -- server id, not their citizen id - see reportJailSuspect below).
    if r.suspect_cid and r.suspect_cid ~= '' then
      r.suspectOnline = Bridge.FindSource(r.suspect_cid) ~= nil
    end
    -- An unresolved court case (see reportSendToCourt) hides Jail Suspect/Send to Court on the
    -- report until the future Court MDT resolves it - only ever set here, never here resolved.
    local court = MySQL.single.await(
      "SELECT id, status, submitted_at FROM mdt_court_cases WHERE report_id = ? AND status != 'resolved' ORDER BY id DESC LIMIT 1", { data.id })
    if court then
      court.submitted_at = fmtWhen(court.submitted_at)
      r.courtCase = court
    end
    -- Evidence Laptop reports (DNA/Fingerprint/Ballistics matches) linked to this case, filed away
    -- in File Explorer's shared Case Files area — see server/evidence_reports.lua.
    if r.case_number and r.case_number ~= '' and EvidenceReports then
      r.evidence = EvidenceReports.listForCase(r.case_number)
    end
    -- Images/videos pasted onto this report (server/files.lua's Files.AddLegalCaseAttachment),
    -- filed the same place the linked evidence lives: the case's own Evidence subfolder.
    if r.case_number and r.case_number ~= '' then
      r.attachments = Files.ListLegalCaseAttachments(r.case_number)
    end
    return respond({ ok = true, data = { report = r } })
  end

  if name == 'evidenceUnlinked' then
    if not EvidenceReports then return respond({ ok = true, data = { folders = {} } }) end
    return respond({ ok = true, data = { folders = EvidenceReports.listUnlinked() } })
  end

  if name == 'evidenceLink' then
    if not (EvidenceReports and data.folderId and data.case_number and data.case_number ~= '') then
      return respond({ ok = false, reason = 'invalid' })
    end
    local done = EvidenceReports.linkToCase(data.folderId, data.case_number)
    if not done then return respond({ ok = false, reason = 'error' }) end
    return respond({ ok = true, data = { evidence = EvidenceReports.listForCase(data.case_number) } })
  end

  if name == 'evidenceUnlink' then
    if not (EvidenceReports and data.folderId and data.case_number) then
      return respond({ ok = false, reason = 'invalid' })
    end
    EvidenceReports.unlink(data.folderId, data.case_number)
    return respond({ ok = true, data = { evidence = EvidenceReports.listForCase(data.case_number) } })
  end

  if name == 'reportAttachmentAdd' then
    local caseNumber = tostring(data.case_number or '')
    local url = (data.url or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if caseNumber == '' or url == '' then return respond({ ok = false, reason = 'invalid' }) end
    if not url:match('^https?://') then return respond({ ok = false, reason = 'invalid_url' }) end
    local newId = Files.AddLegalCaseAttachment(caseNumber, url, Bridge.GetIdentifier(src), Bridge.GetName(src))
    if not newId then return respond({ ok = false, reason = 'error' }) end
    return respond({ ok = true, data = { attachments = Files.ListLegalCaseAttachments(caseNumber) } })
  end

  if name == 'reportAttachmentDelete' then
    if not (data.id and data.case_number) then return respond({ ok = false, reason = 'invalid' }) end
    Files.DeleteLegalCaseAttachment(data.case_number, data.id)
    return respond({ ok = true, data = { attachments = Files.ListLegalCaseAttachments(data.case_number) } })
  end

  if name == 'reportPhoneList' then
    local photos = Files.ListPhonePhotos(src, 200)
    if not photos then return respond({ ok = false, reason = 'unavailable' }) end
    return respond({ ok = true, data = { photos = photos } })
  end

  if name == 'reportPhoneImport' then
    local caseNumber = tostring(data.case_number or '')
    if caseNumber == '' or type(data.ids) ~= 'table' or #data.ids == 0 then return respond({ ok = false, reason = 'invalid' }) end
    local result = Files.ImportPhonePhotosToCase(src, caseNumber, data.ids, Bridge.GetIdentifier(src), Bridge.GetName(src))
    if not result then return respond({ ok = false, reason = 'error' }) end
    return respond({ ok = true, data = { attachments = Files.ListLegalCaseAttachments(caseNumber), imported = result.imported, skipped = result.skipped } })
  end

  if name == 'reportJailSuspect' then
    if not data.id then return respond({ ok = false, reason = 'invalid' }) end
    local r = MySQL.single.await('SELECT suspect_cid, case_number, charges, jailed_at FROM mdt_reports WHERE id = ?', { data.id })
    if not r or not r.suspect_cid or r.suspect_cid == '' then return respond({ ok = false, reason = 'no_suspect' }) end
    if MySQL.scalar.await("SELECT 1 FROM mdt_court_cases WHERE report_id = ? AND status != 'resolved' LIMIT 1", { data.id }) then
      return respond({ ok = false, reason = 'sent_to_court' })
    end

    local minutes = math.floor(tonumber(data.minutes) or 0)
    if minutes <= 0 then return respond({ ok = false, reason = 'invalid_time' }) end

    -- xt-prison's SetJailTime works off the player's server id, not their citizen id, so the
    -- suspect must be online right now - same constraint its own /jail command has.
    local targetSrc = Bridge.FindSource(r.suspect_cid)
    if not targetSrc then return respond({ ok = false, reason = 'offline' }) end

    if GetResourceState('xt-prison') ~= 'started' then return respond({ ok = false, reason = 'jail_unavailable' }) end
    local okJail, errJail = pcall(function() exports['xt-prison']:SetJailTime(targetSrc, minutes) end)
    if not okJail then
      print(('^1[as-computer:mdt] xt-prison SetJailTime failed for report #%s: %s^0'):format(tostring(data.id), tostring(errJail)))
      return respond({ ok = false, reason = 'jail_failed' })
    end

    -- Only the FIRST time this report's charges are sent down do they go on the DBS record - a
    -- second click (e.g. to add more time) must never re-file the same convictions.
    if not r.jailed_at and GetResourceState('as-browser') == 'started' then
      local officerName = Bridge.GetName(src)
      for _, c in ipairs(resolvedCharges(r.charges)) do
        local offence = c.code and (c.code .. ' - ' .. c.title) or (c.title or 'Unknown offence')
        local sentence = (type(c.months) == 'number' and c.months > 0) and (c.months .. ' months') or ''
        pcall(function()
          exports['as-browser']:addCriminalRecord(r.suspect_cid, {
            offence = offence, sentence = sentence, issuedBy = officerName,
            notes = (r.case_number and r.case_number ~= '') and ('Case ' .. r.case_number) or '',
          })
        end)
      end
    end

    local jailedAt = os.time()
    MySQL.update.await('UPDATE mdt_reports SET jailed_at = COALESCE(jailed_at, ?) WHERE id = ?', { jailedAt, data.id })
    return respond({ ok = true, data = { jailedAt = jailedAt } })
  end

  if name == 'reportSendToCourt' then
    if not data.id then return respond({ ok = false, reason = 'invalid' }) end
    local r = MySQL.single.await('SELECT suspect_cid, suspect_name, case_number, charges, jailed_at FROM mdt_reports WHERE id = ?', { data.id })
    if not r or not r.suspect_cid or r.suspect_cid == '' then return respond({ ok = false, reason = 'no_suspect' }) end
    if r.jailed_at then return respond({ ok = false, reason = 'already_jailed' }) end
    if MySQL.scalar.await("SELECT 1 FROM mdt_court_cases WHERE report_id = ? AND status != 'resolved' LIMIT 1", { data.id }) then
      return respond({ ok = false, reason = 'already_sent_to_court' })
    end

    local now = os.time()
    MySQL.insert.await(
      'INSERT INTO mdt_court_cases (report_id, case_number, suspect_cid, suspect_name, charges, submitted_by, submitted_by_name, submitted_at) VALUES (?,?,?,?,?,?,?,?)',
      { data.id, r.case_number, r.suspect_cid, r.suspect_name, r.charges, Bridge.GetIdentifier(src), Bridge.GetName(src), now })

    -- Filing.txt goes in the normal (legal-bucket) case folder alongside the report - visible to
    -- officers as case history - the moment it's sent to court, not only once resolved.
    if r.case_number and r.case_number ~= '' then
      local lines = {}
      local function add(s) lines[#lines + 1] = s end
      add('<h1>Court Filing</h1>')
      add(('<p><b>Case Number:</b> %s</p>'):format(escHtml(r.case_number)))
      add(('<p><b>Defendant:</b> %s</p>'):format(escHtml(r.suspect_name or 'Unknown')))
      add(('<p><b>Filed By:</b> %s</p>'):format(escHtml(Bridge.GetName(src) or 'Officer')))
      add(('<p><b>Filed:</b> %s</p>'):format(escHtml(fmtWhen(now))))
      add('<h2>Charges</h2>')
      for _, c in ipairs(resolvedCharges(r.charges)) do
        add(('<p>%s</p>'):format(escHtml((c.code and (c.code .. ' - ') or '') .. (c.title or ''))))
      end
      add('<p><i>Awaiting judge, prosecution and defence sign-on. This case is not yet scheduled.</i></p>')
      Files.UpsertCaseNamedFile('legal', r.case_number, { r.suspect_name }, 'Filing.txt', table.concat(lines, ''))
    end

    return respond({ ok = true, data = { courtCase = { status = 'awaiting_assignment', submitted_at = fmtWhen(now) } } })
  end

  if name == 'reportSave' then
    local title = (data.title and data.title ~= '') and data.title:sub(1, 160) or 'Untitled report'
    local rtype = data.type or 'Incident'
    local involved = data.involved or ''
    local charges = data.charges or ''
    local narrative = data.narrative or ''
    local authorName = Bridge.GetName(src)

    -- ---- case number: auto-generate for a brand-new report left blank, otherwise attach to an
    -- existing case (typed case numbers may never mint a new case on their own). ----
    local existingCase = nil
    if data.id then
      existingCase = MySQL.scalar.await('SELECT case_number FROM mdt_reports WHERE id = ?', { data.id })
    end
    local typed = tostring(data.case_number or ''):match('^%s*(.-)%s*$')
    local caseNumber
    if typed == '' then
      if data.id and existingCase and existingCase ~= '' then
        caseNumber = existingCase   -- editing, left blank: keep whatever it already had
      else
        caseNumber = nextCaseNumber()
      end
    else
      typed = typed:upper()
      local found = MySQL.scalar.await('SELECT id FROM mdt_reports WHERE case_number = ? LIMIT 1', { typed })
      if not found then
        return respond({ ok = false, reason = 'case_not_found' })
      end
      caseNumber = typed
    end

    local reportId = data.id
    if data.id then
      MySQL.update.await(
        'UPDATE mdt_reports SET title=?, type=?, involved=?, charges=?, narrative=?, suspect_cid=?, suspect_name=?, case_number=? WHERE id=?',
        { title, rtype, involved, charges, narrative, data.suspect_cid, data.suspect_name, caseNumber, data.id })
    else
      reportId = MySQL.insert.await(
        'INSERT INTO mdt_reports (title, type, involved, charges, narrative, suspect_cid, suspect_name, author_cid, author_name, case_number) VALUES (?,?,?,?,?,?,?,?,?,?)',
        { title, rtype, involved, charges, narrative, data.suspect_cid, data.suspect_name, Bridge.GetIdentifier(src), authorName, caseNumber })
    end

    -- Mirror the report into File Explorer's shared "legal" group folder (police + judges/lawyers/
    -- solicitors/barristers): one folder per case number (named after the case and every suspect
    -- filed under it so far), with each report as a file inside. Safely inert if Config.LegalFolder
    -- is missing/disabled, or if files.lua isn't loaded.
    if reportId and Files and Files.SyncLegalCase then
      local row = MySQL.single.await(
        'SELECT title, type, involved, charges, narrative, suspect_name, author_name, created_at FROM mdt_reports WHERE id = ?', { reportId })
      if row then
        local caseHasReports = (MySQL.scalar.await('SELECT COUNT(*) FROM mdt_reports WHERE case_number = ?', { caseNumber }) or 0) > 0
        local okSync, errSync = pcall(function() Files.SyncLegalCase(caseNumber, caseSuspectNames(caseNumber), caseHasReports) end)
        if not okSync then print(('^1[as-computer:mdt] Files.SyncLegalCase failed for case %s: %s^0'):format(tostring(caseNumber), tostring(errSync))) end
        local body = buildReportBody(reportId, caseNumber, row)
        local fname = ('Report - %s (#%s).txt'):format((row.title or 'Untitled'):gsub('[%c\\/:*?"<>|]', ''), tostring(reportId))
        local maxNm = (Config.Files and Config.Files.maxNameLength) or 80
        if #fname > maxNm then
          local suffix = (' (#%s).txt'):format(tostring(reportId))
          fname = fname:sub(1, math.max(1, maxNm - #suffix)) .. suffix
        end
        local okFile, errFile = pcall(function() Files.UpsertLegalReportFileInCase(caseNumber, reportId, fname, body, Bridge.GetIdentifier(src), authorName) end)
        if not okFile then print(('^1[as-computer:mdt] Files.UpsertLegalReportFileInCase failed for report #%s: %s^0'):format(tostring(reportId), tostring(errFile))) end
      end
    elseif reportId and not (Files and Files.SyncLegalCase) then
      print('^1[as-computer:mdt] Files.SyncLegalCase is not defined — server/files.lua may not have loaded, or loaded before this change. Case folder sync skipped.^0')
    end

    return respond({ ok = true, data = { id = reportId, caseNumber = caseNumber } })
  end

  if name == 'reportDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id then return respond({ ok = false, reason = 'invalid' }) end
    local caseNumber = MySQL.scalar.await('SELECT case_number FROM mdt_reports WHERE id = ?', { data.id })
    MySQL.update.await('DELETE FROM mdt_reports WHERE id = ?', { data.id })
    if Files and Files.DeleteLegalReportFileInCase and caseNumber and caseNumber ~= '' then
      local okDel, errDel = pcall(function() Files.DeleteLegalReportFileInCase(caseNumber, data.id) end)
      if not okDel then print(('^1[as-computer:mdt] Files.DeleteLegalReportFileInCase failed for report #%s: %s^0'):format(tostring(data.id), tostring(errDel))) end
      local caseHasReports2 = (MySQL.scalar.await('SELECT COUNT(*) FROM mdt_reports WHERE case_number = ?', { caseNumber }) or 0) > 0
      local okSync2, errSync2 = pcall(function() Files.SyncLegalCase(caseNumber, caseSuspectNames(caseNumber), caseHasReports2) end)
      if not okSync2 then print(('^1[as-computer:mdt] Files.SyncLegalCase (post-delete) failed for case %s: %s^0'):format(tostring(caseNumber), tostring(errSync2))) end
    end
    return respond({ ok = true })
  end

  if name == 'boloVehicleLookup' then
    -- Used by the New BOLO form: given a plate the officer just typed/picked, look up its make,
    -- model, colour and registered owner so the description can be filled in automatically
    -- instead of the officer having to go check the vehicle record separately.
    local plate = (data.plate or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if plate == '' then return respond({ ok = false, reason = 'invalid' }) end
    local model, ownerCid = '', nil
    pcall(function()
      local row = MySQL.single.await(
        ('SELECT plate, vehicle, %s AS owner_cid FROM %s WHERE plate = ? LIMIT 1'):format(Bridge.VehicleOwnerColumn(), Bridge.VehicleTable()), { plate })
      if row then model = Bridge.VehicleModelLabel(row.vehicle) or ''; ownerCid = row.owner_cid end
    end)
    -- The officer is usually still typing (this fires on every debounced keystroke), so an exact
    -- match on the partial string will normally miss. Fall back to the same LIKE search the
    -- plate suggestions dropdown uses, and resolve to that vehicle's real plate when it's the
    -- only match - this is what actually makes "type ACE, see the details fill in" work rather
    -- than requiring the officer to type the complete plate first.
    if model == '' and not ownerCid then
      local likeOk, likeRows = pcall(function()
        return MySQL.query.await(
          ('SELECT plate, vehicle, %s AS owner_cid FROM %s WHERE plate LIKE ? LIMIT 2'):format(Bridge.VehicleOwnerColumn(), Bridge.VehicleTable()), { '%' .. plate .. '%' })
      end)
      if likeOk and type(likeRows) == 'table' and #likeRows == 1 then
        plate = likeRows[1].plate
        model = Bridge.VehicleModelLabel(likeRows[1].vehicle) or ''
        ownerCid = likeRows[1].owner_cid
      end
    end
    local ownerName = ownerCid and Bridge.CharacterName(ownerCid) or nil
    local colour, make = nil, nil
    local ok, status = pcall(function() return exports['as-browser']:getVehicleStatus(plate) end)
    if ok and type(status) == 'table' then
      colour = status.colour
      make = status.make
      if model == '' then model = status.model or '' end
    end
    if model == '' and not colour and not ownerName then return respond({ ok = false, reason = 'not_found' }) end
    return respond({ ok = true, data = { plate = plate, model = model, make = make, colour = colour, owner = ownerName } })
  end

  if name == 'bolosList' then
    local rows = MySQL.query.await(
      'SELECT id, title, plate, description, active, author_name, created_at FROM mdt_bolos ORDER BY active DESC, id DESC LIMIT 100') or {}
    for _, r in ipairs(rows) do r.created_at = fmtWhen(r.created_at); r.active = (r.active == 1) end
    return respond({ ok = true, data = { bolos = rows } })
  end

  if name == 'boloSave' then
    local title = (data.title or 'BOLO'):sub(1, 160)
    local plate = (data.plate or ''):sub(1, 16)
    local id = MySQL.insert.await('INSERT INTO mdt_bolos (title, plate, description, author_name) VALUES (?,?,?,?)',
      { title, plate, data.description or '', Bridge.GetName(src) })
    return respond({ ok = true, data = { id = id } })
  end

  if name == 'boloToggle' then
    if not data.id then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('UPDATE mdt_bolos SET active = IF(active=1,0,1) WHERE id = ?', { data.id })
    return respond({ ok = true })
  end

  if name == 'boloDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM mdt_bolos WHERE id = ?', { data.id })
    return respond({ ok = true })
  end

  if name == 'chargesList' then
    local out = {}
    for _, ch in ipairs(Config.MDT and Config.MDT.charges or {}) do
      out[#out + 1] = { code = ch.code, title = ch.title, type = ch.type, months = ch.months, fine = ch.fine, category = ch.category }
    end
    return respond({ ok = true, data = { charges = out } })
  end

  respond({ ok = false, reason = 'invalid' })
end)
