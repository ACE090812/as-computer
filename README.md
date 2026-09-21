# as-computer

A Windows-style desktop ("Los Santos OS") on a prop monitor: Store, MOT Testing Service, File Explorer (with Recycle Bin), Scout browser (as-browser sites) and Calendar. Formerly `mot-dui`.

## Rename from mot-dui
1. Rename the resource folder `mot-dui` to `as-computer` and change the `ensure mot-dui` line in `server.cfg` to `ensure as-computer` (after `as-browser`).
2. `provide 'mot-dui'` in `fxmanifest.lua` keeps any script that calls `exports['mot-dui']` working. Remove that line when nothing uses the old name.
3. Debug commands are now `/computer_coords`, `/computer_open`, `/computer_goto`, `/computer_screen` (were `/mot_*`).
4. `client/config.lua` and `shared/checklist.lua` are empty stubs now. Nothing loads them, delete both files.
5. The `mot_history` and `mot_calendar` tables and the `stream/` files keep their names, so no data moves.

## Config layout
Every app has its own file, so no single file grows. Nothing is hard-coded to a list of apps: the manifest loads `config/apps/*.lua`, so a new file there is picked up automatically.

| File | What it holds |
|---|---|
| `config/config.lua` | Core: locations and props, target/interaction, `Config.Jobs`, lock screen, locale, notify hook, debug |
| `config/apps/mot.lua` | MOT Testing Service: expiry days, notes rules, print hook |
| `config/apps/mot_checklist.lua` | The MOT checklist sections and items |
| `config/apps/explorer.lua` | File Explorer: who can rename/delete, what emptying the bin does |
| `config/apps/scout.lua` | Scout browser: on/off, as-browser resource name, MOT push |
| `config/apps/calendar.lua` | Calendar: on/off, week start |
| `config/apps/store.lua` | The Store itself: who may install, currency, society bank |
| `config/apps/booking.lua` | MOT bookings from the government website: fee, days ahead, time slots, closed days, cancel rules, reminders |
| `config/apps/settings.lua` | Settings: default look, wallpapers, custom-wallpaper rules, device and network info shown in About/Network |

To give a new app its own settings, add `config/apps/<app>.lua` that only writes to `Config` (for example `Config.MyApp = { ... }`). `config/config.lua` always loads first, so `Config` exists.

Settings mentioned further down as living in `client/config.lua` or `shared/checklist.lua` are now in the files above.

## Store, jobs and apps

The computer can be used by several jobs. `Config.Jobs` (config/config.lua) lists the jobs that may use it at all, and a location can set its own `jobs = { ... }`. What a job has on its desktop is decided by the **Store**:

- File Explorer, Calendar and the Store are built in. Apps with `store = true` (MOT Testing Service, Scout) are not on the desktop until they are installed.
- Who may install is set per app with `manage` in its `Config.Apps` entry (`'boss'`, `'any'` or a grade number; default `Config.Store.manage`). MOT is boss-only, Scout can be installed by anyone. An employee who is allowed installs an app once in the Store and it is stored against the job, so everyone on that job has it. Members who already have the computer open get it straight away. Installs live in the `computer_apps` table (created automatically).
- Everyone sees every app. Apps made for another job show as "Not for your job" and cannot be installed.
- Each app's own file sets `jobs` (who may install/use it, nil = any), `price` (pounds, taken from the job's society account, 0 = free; a job that has paid once reinstalls free), `icon`, `tint`, `category`, `publisher`, `version`. Set `store = false` to make an app built in. Names, descriptions and feature lists come from the locale (`store_<id>_name`, `_desc`, `_f1` to `_f4`), or set `label` / `desc` / `features` in the app's config entry.
- `config/apps/store.lua`: `manage = 'boss'` (or `'any'`, or a minimum grade number), `currency`, `accountFor(job)`, and the society `bank` (auto-detects Renewed-Banking, qb-banking, okokBanking, fd_banking, qb-management, esx_society, or `'custom'`). A bank is only needed if an app has a price.
- `Config.Store.enabled = false` removes the Store: every app is simply available to the jobs listed for it.
- The Calendar is per job (`mot_calendar.job`, added automatically; old events go to the first job in `Config.Jobs`). The MOT Certificates folder only shows for jobs that have the MOT app.
- Uninstalling only removes the app from the desktop. Data (MOT records, calendar events) is kept.

To add an app: write its window in `ui/`, add `config/apps/<id>.lua` with a `Config.Apps.<id>` entry, add the locale strings, and gate its server callbacks with `Apps.allowed(src, '<id>')`.

## Settings

A copy of the Windows 11 Settings app, built in (not in the Store). Pages: Personalisation (Background, Colours, Themes, Taskbar, Start), System (Display brightness, Night light, About), Accounts, Time & language (Date & time, Language & region) and Network & internet. The search box finds any setting.

- **Saved per character** in `computer_settings` (created automatically). Only values the player changed are stored; everything else comes from `Config.Settings.defaults`, so changing a default updates everyone who never touched it.
- Dark mode covers the taskbar, Start, title bars, Store, Settings, Explorer and Calendar. MOT and Scout stay light.
- Wallpapers: the built-in set in `Config.Settings.wallpapers` (add your own entries) plus **paste an image URL**. URLs must be https, at most 300 characters and safe characters only. Set `allowCustomWallpaper = false` to turn it off, or `customWallpaperHosts = { 'i.imgur.com', 'cdn.discordapp.com' }` to allow only those hosts.
- Language is picked from the files in `locales/`; the choice is per character. About and Network show `Config.Settings.device` / `.network` (name, model, SSID etc.). The version shown is `fxmanifest.lua`.
- Every value a client sends is validated on the server against a whitelist (`SPEC` in `server/settings.lua`); one bad value refuses the whole change.
- New server script + manifest change: run `refresh` in the server console, then `restart as-computer`.

## MOT bookings (government website)

Players book an MOT on `lsgov.co.uk` > "Book an MOT test" (the as-browser resource; both resources must be running). The website only passes requests through: garages, slots, the fee and the bookings live here.

- **Garages**: every entry in `Config.Locations` with a `booking = { id, name, address, ... }` table is a garage players can choose. To add one, add a location (its own monitor) with a `booking` table. `booking.job` picks whose Calendar and society account it uses (default: the location's first job). Per-garage `bays`, `fee` and `slots` override the defaults.
- **Slots and rules** are in `config/apps/booking.lua`: fee, `daysAhead`, time slots (a range or a list), `closedWeekdays`, `minNoticeMinutes`, `cancelMinutes` (players can change or cancel until then), `maxActivePerPlayer`, `remindMinutes`.
- **Money**: the player pays from their bank when they book. The fee is held and paid into the job's society account when a tester records the MOT for that plate, or when the slot has passed unused (`noShowGraceMinutes`). Cancelling in time gives it back in full. Changing the time costs nothing.
- **Calendar**: bookings show in the job's Calendar (read-only, colour `Config.Booking.colour`) and look-ups in the MOT app show "Booked for ..." for the plate.
- **Emails** (Mail app, sent by as-browser): booking confirmed, changed, cancelled, a reminder shortly before the slot, and when the vehicle's MOT is about to run out (`Config.gov.motBooking.expiryReminderDays` in as-browser's `sites/gov/config.lua`).
- Table `computer_bookings` is created automatically. Times are real server time.
- Also used by the government site (0.5.1): `exports['as-computer']:getMotRecords(plate)` returns `{ records = { { testedAt, passed, expiresAt, mileage, unit, location }, ... } }` for the vehicle history check, and `renamePlate(oldPlate, newPlate)` moves MOT records and bookings when a player buys a personalised plate.

## What's real vs placeholder here
- `ui/index.html` + `ui/style.css` + `ui/app.js` — **Los Santos OS**, a lore-friendly
  desktop (lock screen, desktop icons, taskbar, start menu, draggable windows).
  The GOV.UK MOT service is one window (lookup → history → checklist → result),
  File Explorer is another, and certificates open in their own viewer windows.
  Same page renders as the DUI (idle desktop on the world texture) and the
  focused NUI (interactive, drawn over the monitor's screen).
- `client/dui.lua` — creates one DUI per configured location, swaps it onto
  the prop's screen texture (`AddReplaceTexture`), and opens a focused NUI
  overlay for the interacting player via ox_target/qb-target.
- `client/bridge.lua` — bare job check for QBCore/Qbox/ESX. No inventory or
  payment bridging yet — add as needed.
- `config/config.lua` — **you need to fill in**: `prop`, `txd`, `txn` for
  your actual terminal model, and real coords per garage.

## Finding txd/txn for a prop
Use a model viewer (e.g. CodeWalker) on your terminal prop, find the texture
dictionary and texture name for the screen surface specifically (not the
whole prop) — that's what `AddReplaceTexture` swaps out.

## What's now wired up
- `sql/install.sql` — `mot_history` table.
- `config/apps/mot_checklist.lua` — single source of truth for checklist items; the
  checklist screen renders itself from this (edit here, not in the HTML).
- `server/main.lua` — `lookupVehicle` (reads the framework's owned-vehicle
  table + `mot_history`), `submitInspection` (computes pass/fail from ticked
  items, inserts a row, sets expiry from `Config.MOTExpiryDays`).
- **Mileage** — pulled from `jg-vehiclemileage` (`getMileageByPlate` /
  `getUnit`) if that resource is running, both on lookup (pre-fills the
  mileage field) and on submit (overrides whatever the tester typed, so it
  can't be faked). Falls back to the manual field if jg-vehiclemileage isn't
  installed — no hard dependency added, it's checked with `GetResourceState`.
- `exports('GetMOTStatus', plate)` — ready for your future police script.
- `client/callback.lua` + `server/callback.lua` — dependency-free
  request/response bridge (works without ox_lib, since ESX is supported).
- The UI (lookup → overview/history → checklist → result) is now driven by
  real data end to end, not mock content.

## jg-mechanic job caveat
`Bridge.HasMechanicJob` checks the player's framework job directly — correct
if jg-mechanic is set to `Config.UseFrameworkJobs = true`. If you're using
jg-mechanic's own built-in employee system instead
(`Config.UseFrameworkJobs = false`), there's no public jg-mechanic export to
check "is this player an employee" — access there is managed internally
through `/tablet`. You'd need to either switch jg-mechanic to framework jobs,
or gate the MOT terminal on something else (a separate job/whitelist) until
jg-mechanic exposes that.

## Notifications + locale (wired)
- `Bridge.Notify(msg, type)` in `client/bridge.lua` — uses `Config.Notify(msg, type)`
  if you define it, else qbx/qb/ESX native, else ox_lib, else the GTA feed.
- Fired on: job-check fail, lookup errors (empty / no vehicle / not authorised),
  submit errors (incomplete checklist / not authorised), and submit success.
- `locales/en.lua` holds every UI + notification string; `Config.Locale` picks the
  language (copy `en.lua` to add one). Missing keys fall back to English. The UI
  gets the table via a `setLocale` message (NUI and DUI). Checklist labels still
  come from `config/apps/mot_checklist.lua`. Los Santos OS / Explorer / certificate strings are all in the locale file.
- The page has two modes: `?dui=1` (world texture, always visible) and the
  default NUI overlay (hidden until `open`, scaled to fit, ESC closes).
- `submitInspection` now rejects unanswered checklist items (`incomplete`).

## Los Santos OS (desktop, File Explorer, certificates)
- **Lock screen** shows the tester's name; click / Enter signs in and opens the MOT
  window. `Config.LockScreen = false` skips it. ESC closes menus first, then the terminal.
- **File Explorer** (`This PC › MOT Certificates`) lists every row of `mot_history`
  via the `listCertificates` callback (newest 300). Folders: My tests, Passed, Failed,
  Expiring soon (≤ 7 days), Expired. Sortable columns, search (plate / test number /
  model / tester), preview pane, double-click or Enter to open. The list refreshes
  after each submitted test.
- **Certificate viewer** builds a certificate from the real record (test number, plate,
  model, mileage, dates, station, tester, failed reasons grouped by checklist section,
  advisories). Opened from Explorer, the start menu, MOT history ("View certificate")
  or straight after submitting a test. VIN shows "—" (not stored).
- **Printing (Stage 3, not built)** — the Print button is disabled until you set
  `Config.PrintEvent` to a client event name; it then receives the certificate table
  (`testNumber, plate, model, passed, issuedAt, expiresAt, mileage, mileageUnit,
  testerName, locationLabel, failedItems, advisoryItems`). Hook your printer script there.
- **Tester notes** — marking an item Advise or Fail opens a note box under it (max
  `Config.MaxNoteLength`, default 200 chars). Notes are saved in `mot_history.notes`
  (column auto-added on start) and show in the MOT history, result screen, Explorer
  preview and on the certificate under the item. `Config.RequireNotes = true` makes a
  note compulsory for every advisory/fail.
- **Right-click + Recycle Bin** — right-click files (Open, Print, Copy test number, Rename,
  Delete, Properties), folders, empty space (sort, refresh) and the desktop. Delete moves a
  certificate to the **Recycle Bin** (desktop icon shows empty/full); there you can Restore,
  Delete permanently or Empty Recycle Bin (with Windows-style confirmation). F2 renames, Del
  deletes, Ctrl/Shift-click multi-selects. Rename only changes the file's display name.
  `Config.ManageOthers` (default false) limits rename/delete/restore to your own tests.
  `Config.PurgeRemovesRecords` (default false): emptying the bin hides the file but keeps the
  MOT record so vehicle history / police checks stay intact; true deletes the row for good.
  New `mot_history` columns are added automatically on start.
- New server callbacks: `listCertificates`, `whoami`. `submitInspection` now also
  returns mileage / tester / location so the certificate can open immediately.
- oxmysql DATETIME values are normalised to `YYYY-MM-DD HH:MM:SS` strings on the server.
- The ambient DUI shows the idle desktop + live clock (no windows).

## Still not wired up
- **Certificate printing** — viewer is real now; only the printer hand-off (`Config.PrintEvent`) is missing.
- **DUI state mirroring** — the world screen only shows the idle desktop; it
  doesn't follow what the interacting player is doing.
- **Fee/payment logic** — deliberately not built (mechanics paid via wage/bonus).
- **txd in `config/config.lua`** — `securitymonitor` confirmed as an embedded texture
  in `lgmods_sinner_monitor.ydr` (no separate .ytd), so txd = model name is right.
  Still worth an in-game test.

## Scout (as-browser websites on the desktop)

The desktop has a **Scout** browser app (Chrome-style: tabs, address bar, bookmarks bar, history, and a start page with search). It opens the same in-game websites as the phone browser through the `as-browser` resource, so nothing is duplicated. Bookmarks and history are shared with the phone (per character). The app only appears while `as-browser` is running.

Setup:

1. Replace `as-browser/server/main.lua` with the patched copy from `as-browser-patch/` (it adds two exports, `handle` and `shellInfo`; nothing else changes). `as-browser/sites/gov/config.lua` in the patch has `mot = { enabled = true }` so the vehicle checker shows MOT status.
2. Start order: `as-browser` before `as-computer`.
3. Restart `as-browser`, then `as-computer`.

Settings (`config/apps/scout.lua`): `Config.Browser = { enabled, resource, pushMotResults }`. With `pushMotResults` on, every finished MOT test is sent to as-browser (`setMotResult`) with the failed items and advisories as the details text, so the government site's vehicle checker shows the MOT status, expiry and history. With MOT switched on in the gov site, `isRoadLegal` (police/ANPR exports) reports `no_mot` for vehicles that have never been tested.

Only jobs that have the Scout app can use the browser through this terminal: requests go client -> `as-computer` server (job check) -> `as-browser` `handle` export with the real player source. Site pages are as-browser's own `sites/*/index.html` in an iframe, so site changes need no edits here. Saving logins to the phone's Passwords app is not available on the computer.

## Calendar

A Calendar app on the Los Santos OS desktop (also opens from the taskbar clock): Month / Week / Day views, a mini month picker, colour-coded events with optional start/end times or All day, notes, and a current-time line. One **shared team calendar**: every tester with the MOT job sees, edits and deletes the same events (bookings, reminders, shifts). Double-click a day or a time slot to add an event, click one to edit it, right-click for Edit / Delete. Keys: Left/Right change period, T = today.

"Today" is the real date of the PC (the same clock as the taskbar). Events are stored in the `mot_calendar` table, created automatically. Settings in `config/apps/calendar.lua`: `Config.Calendar = { enabled, weekStart }` (weekStart 1 = Monday, 0 = Sunday).
