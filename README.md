# as-computer

A Windows-style desktop ("Los Santos OS") on a prop monitor: Store, MOT Testing Service, File Explorer (with Recycle Bin), Scout browser (as-browser sites), Calendar and the Mechanic app. Formerly `mot-dui`.

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
| `config/apps/mechanic.lua` | Mechanic app: prefixes, VAT, labour rate, business details, payment methods, stock rules, email, delete rule, part categories, hooks |
| `config/apps/booking.lua` | MOT bookings from the government website: fee, days ahead, time slots, closed days, cancel rules, reminders |
| `config/apps/settings.lua` | Settings: default look, wallpapers, custom-wallpaper rules, device and network info shown in About/Network |

To give a new app its own settings, add `config/apps/<app>.lua` that only writes to `Config` (for example `Config.MyApp = { ... }`). `config/config.lua` always loads first, so `Config` exists.

Settings mentioned further down as living in `client/config.lua` or `shared/checklist.lua` are now in the files above.

## Store, jobs and apps

The computer can be used by several jobs. `Config.Jobs` (config/config.lua) lists the jobs that may use it at all, and a location can set its own `jobs = { ... }`. What a job has on its desktop is decided by the **Store**:

- File Explorer, Calendar, Mail and the Store are built in. Apps with `store = true` (MOT Testing Service, Scout) are not on the desktop until they are installed.
- Who may install is set per app with `manage` in its `Config.Apps` entry (`'boss'`, `'any'` or a grade number; default `Config.Store.manage`). MOT is boss-only, Scout can be installed by anyone. An employee who is allowed installs an app once in the Store and it is stored against the job, so everyone on that job has it. Members who already have the computer open get it straight away. Installs live in the `computer_apps` table (created automatically).
- Everyone sees every app. Apps made for another job show as "Not for your job" and cannot be installed.
- Each app's own file sets `jobs` (who may install/use it, nil = any), `price` (pounds, taken from the job's society account, 0 = free; a job that has paid once reinstalls free), `icon`, `tint`, `category`, `publisher`, `version`. Set `store = false` to make an app built in. Names, descriptions and feature lists come from the locale (`store_<id>_name`, `_desc`, `_f1` to `_f4`), or set `label` / `desc` / `features` in the app's config entry.
- `config/apps/store.lua`: `manage = 'boss'` (or `'any'`, or a minimum grade number), `currency`, `accountFor(job)`, and the society `bank` (auto-detects Renewed-Banking, qb-banking, okokBanking, fd_banking, qb-management, esx_society, or `'custom'`). A bank is only needed if an app has a price.
- `Config.Store.enabled = false` removes the Store: every app is simply available to the jobs listed for it.
- The Calendar is per job (`mot_calendar.job`, added automatically; old events go to the first job in `Config.Jobs`). The MOT Certificates folder only shows for jobs that have the MOT app.
- Uninstalling only removes the app from the desktop. Data (MOT records, calendar events) is kept.

To add an app: write its window in `ui/`, add `config/apps/<id>.lua` with a `Config.Apps.<id>` entry, add the locale strings, and gate its server callbacks with `Apps.allowed(src, '<id>')`.

## Turning apps off (US servers, other regions)

Some apps are UK-flavoured (the MOT Testing Service, £ prices). To remove an app, set it to `false` in `Config.EnabledApps` (config/config.lua):

```lua
Config.EnabledApps = { mot = false, mechanic = true, mail = true, calendar = true, browser = true }
```

A switched-off app has no desktop icon, is not in the Store, and the server refuses everything it would have done (every app's server gate goes through `Apps.def`). Anything you leave out stays on. An app's own `config/apps/<app>.lua` entry can also say `enabled = false`. Ids: `mot`, `mechanic`, `mail`, `calendar`, `calculator`, `notepad`, `browser`, `store`, `settings`, `explorer`. Existing data (MOT records, calendar events) is kept if you turn an app back on.

Turning `mot` off also turns off MOT bookings automatically. For a US server also, in **as-browser** `config.lua`:

- `Config.Sites.gov / plates / vehiclecheck / insurance / jobs / parts = { enabled = false }` hides any website (each has a `.co.uk` domain you can also change),
- inside the government site, individual services (MOT booking, DBS, council tax, and so on) have their own on/off in `sites/gov/config.lua`, and `Config.gov.mot.enabled = false` removes MOT results from the vehicle checker,
- `Config.currency = '$'` changes the currency symbol; as-computer's `Config.Store.currency` does the same here.

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

## Working with other scripts (what must match on your server)

as-computer talks to the framework, the database, a banking script, sd-phone, as-browser and a few optional scripts. Everything below is read from the code. The table says what each thing needs from you; details for each kind of script follow. Nothing here edits another resource, except where it says so.

| Needs | Used for | What you must do |
| --- | --- | --- |
| Framework (`qbx_core`, `qb-core` or `es_extended`) | jobs, money, names | Nothing (auto-detected, in that order). Jobs listed in `Config.Jobs` must exist in your framework. |
| `oxmysql` | every table | Nothing. Tables are created on start. |
| `ox_lib` (client and server) | Mail app (`lib.callback`), notifications | Start `ox_lib` first. It is in the manifest. |
| A target script (`ox_target` or `qb-target`) | the "use computer" interaction | Optional: `Config.Interaction = 'key'` needs neither. |
| Owned vehicles table | MOT lookup, Mechanic vehicle lookup, model names | See [Vehicles and plates](#vehicles-and-plates). |
| A society bank script | Store prices, Mechanic card payments | See [Banking](#banking-society-accounts). |
| `sd-phone` | Mail app, Mechanic emails | See [sd-phone](#sd-phone). |
| `as-browser` | Scout, MOT bookings, vehicle history, MOT results on the gov site | Start it before as-computer. |
| `jg-vehiclemileage` | live mileage on MOT tests and job cards | Optional. |

### Start order

```
ensure ox_lib
ensure oxmysql
ensure <your framework, banking and inventory scripts>
ensure sd-phone
ensure as-browser
ensure as-computer
```

Remove any old `ensure mot-dui` line (see "Rename from mot-dui" above); `provide 'mot-dui'` in the manifest keeps old exports calls working.

### Framework and jobs

- `Config.Jobs` (and any location's own `jobs`) are **framework job names**. The job must exist, and the players who should use the computer must be on it (on-duty is not checked).
- "Boss" (Store installs, Mechanic deletes) is read from the framework: `isboss` on qbx/qb, `grade_name == 'boss'` on ESX. If your boss grade is called something else on ESX, give `manage` a grade number instead (`manage = 3`).
- Player money is taken through the framework (`bank` account) for Mechanic card payments. Cash is not used.
- **jg-mechanic:** the job check reads the framework job, which is right when jg-mechanic has `Config.UseFrameworkJobs = true`. With jg-mechanic's own employee system there is no export to check, so switch it to framework jobs or use a separate job for the computer (see "jg-mechanic job caveat" above).

### Vehicles and plates

- **Which table.** The MOT lookup, the Mechanic vehicle lookup and the Explorer model names read the owned vehicles table with `Bridge.VehicleTable()` (`server/bridge.lua`): `player_vehicles` on qbx/qb, `owned_vehicles` on ESX, selecting `plate`, `vehicle` and `citizenid`. It does **not** read `Config.vehicleTable` from as-browser. On qbx/qb with the standard table there is nothing to do. On ESX, or with a custom vehicles table, edit `Bridge.VehicleTable()` and the three queries that select `citizenid` (`server/main.lua` `lookupVehicle`, `server/mechanic.lua` `ownedRow`). ESX vehicles are keyed by `owner`, not `citizenid`, so the Mechanic owner lookup does not work on ESX until that is changed. The ESX paths here have not been run on a real ESX server.
- **The `vehicle` column** is shown as the vehicle's model name. On qbx/qb it is the spawn name (`sultan`). ESX stores JSON there, so it would show as text.
- **Plates are compared without spaces and in upper case** (`UPPER(REPLACE(plate, " ", ""))`), so `AB12 CDE` and `AB12CDE` are the same vehicle. A script that stores plates in another format still matches as long as only spaces and case differ.
- **Personalised plates (LS Plates in as-browser).** as-computer follows a plate change by itself. as-browser calls `exports['as-computer']:renamePlate(old, new)` (MOT records and MOT bookings move; needs 0.5.1 or later) and fires `as-browser:plateChanged` (Mechanic job cards and documents move). You have nothing to configure. as-browser finds this resource by the name in `Config.gov.motBooking.resource` (default `as-computer`), so keep the folder name `as-computer` or change that setting to match.
- **Other scripts that store plates.** Data in other resources is not moved. Use as-browser's `extraTables` / `onChanged` for those (see the as-browser README, "Working with other scripts"). To find every table on your server that has a plate column:

  ```sql
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema = DATABASE() AND column_name LIKE '%plate%';
  ```

- **Mileage.** With `jg-vehiclemileage` running, `getMileageByPlate(plate)` and `getUnit()` are used on the MOT lookup, on submit (this overrides what the tester typed) and on Mechanic job cards. Without it the tester types the mileage. A different mileage script needs `GetLiveMileage` in `server/main.lua` and `liveMileage` in `server/mechanic.lua` pointed at its export.

### Vehicle key scripts

as-computer does not read or give keys, so no key script needs changing to use it. The only thing that touches keys is a plate change, and that is as-browser's job: see its README, "1. Vehicle key scripts" (item keys such as `acestudios_vehiclekeys` are rewritten, table keys go in `extraTables`, and anything else uses the `onChanged` hook). Keys in the ox_inventory database follow along; nothing in as-computer needs to know.

### Garages and impound

There is no garage or impound integration here. A Mechanic job card is a record, it does not repair, store or release anything. What a garage script must know: personalised plates are only allowed while the vehicle is stored (checked by as-browser), and a garage script that keeps its own copy of the plate needs `extraTables` in as-browser. To flag a vehicle as impounded or stolen on the gov site (shown on the Mechanic vehicle lookup as police flags and on LS Vehicle Check), your impound or police script calls:

```lua
exports['as-browser']:setVehicleFlag(plate, 'impounded', true, 'optional note')   -- false clears it
```

### Housing

Not used by as-computer. Housing scripts matter to as-browser's council tax (`housing = 'auto'` there) and to Postal Prime home delivery for the parts shop.

### Banking (society accounts)

Used when an app has a `price` above 0 (Store) and by the Mechanic app when a customer pays an invoice by card.

- `Config.Store.bank` is **`'renewed'` by default**, not `'auto'`. If you use `qb-banking`, `qb-management`, `okokBanking`, `fd_banking` or `esx_society`, change it (or use `'auto'`, or `'custom'` and fill in `balance`, `remove` and `add`). If no supported bank is running, the server console says so and paid apps cannot be bought; free apps are unaffected. A failed bank call is also printed.
- `Config.Store.accountFor(job)` returns the society account name for a job (default: the job name). It must match the name your banking script uses (`mechanic`, or `society_mechanic` for esx_society, which the driver adds itself).
- The Mechanic app pays its society account through the same bank driver.
- If nothing is paid for and card payments are off (`Config.Mechanic.allowCard = false`), no banking script is needed.

### sd-phone

- **Mail app.** Calls sd-phone's own Mail callbacks as the player (`sd-phone:server:mail:list`, `signIn`, `signOut`, `send`, `saveDraft`, `discardDraft`, `markRead`, `toggleFlag`, `moveToBin`, `move`) and listens to `sd-phone:client:mail:received`. These must exist in your sd-phone version. Without sd-phone (or with `Config.Mail.enabled = false`) the app is not shown.
- **Mechanic emails** (`Config.Mechanic.mail`) use the sd-phone server exports `getMailAccounts(source)`, `getMailAddresses(citizenId)` and `sendMail(mail)`. as-browser uses the same three, plus `addBankTransaction`, `notify` and `createDocument`. If your sd-phone does not have an export, the email is skipped with a console message and nothing else breaks (as-browser's other calls are skipped silently). Check `sd-phone`'s exports if emails do not arrive.
- A customer needs a Mail account in the phone's Mail app to receive anything. Addresses are created on the phone (Sign up).

### as-browser

- **Scout** needs `as-browser` started and `Config.Browser.enabled = true`. Site pages, bookmarks and history are as-browser's; job checks are made here.
- **MOT results.** With `pushMotResults`, every finished test is sent to as-browser through `setMotResult`; keep `Config.gov.mot.enabled = true` in as-browser's `sites/gov/config.lua`.
- **MOT bookings** are served through as-computer's `booking*` exports (`bookingConfig`, `bookingAvailability`, `bookingHold`, `bookingConfirm`, `bookingRelease`, `bookingMine`, `bookingCancel`, `bookingMove`, `bookingDueReminders`, `bookingMarkReminded`), called by as-browser. Turning off `mot` here turns bookings off; `Config.gov.scripts.motbooking = false` in as-browser hides the pages.
- **Vehicle history.** Completed Mechanic job cards are logged as "service" events on LS Vehicle Check (`logToHistory`). Set `logToHistory = false` to stop.
- **Not on the desktop:** the parts shop is desktop-only, so it only works from Scout, and needs its own Postal Prime and society bank setup (as-browser README, "Parts shop").

### Police, MDT and ANPR scripts

```lua
exports['as-computer']:GetMOTStatus('AB12CDE')        -- { status = 'valid' | 'expired' | 'failed_last_test' | 'never_tested', expiresAt }
exports['as-computer']:getMotRecords('AB12CDE')       -- { records = { { testedAt, passed, expiresAt, mileage, unit, location }, ... } }
exports['as-computer']:getServiceHistory('AB12CDE')   -- { records = { { ref, title, completedAt, mileage, garage }, ... } }
```

Add `exports['as-browser']:getVehicleStatus(plate)`, `isRoadLegal(plate)`, `getVehicleHistory(plate)` and `getVehicleFlags(plate)` for tax, insurance, flags and owners. Mechanic events for payroll, logging or Discord: `as-computer:mechanic:invoiceIssued`, `:invoicePaid`, `:jobCompleted` (server events, or the `onInvoiceIssued` / `onInvoicePaid` / `onJobCompleted` functions in `config/apps/mechanic.lua`).

### Inventory and items

as-computer does not use items. Nothing to add to ox_inventory or qb-inventory. Printing needs the `as-printer` resource (see its README); without it the Print buttons are hidden. `Config.PrintEvent` is still supported as a fallback for certificates.

### What is not done or not tested

- Not run on a real ESX server (see Vehicles and plates).
- The Mail app and Mechanic card payments have not been tested in game.
- Printing goes through `as-printer` (`config/apps/printing.lua`: `Config.Printing.enabled`). `Config.PrintEvent` remains a fallback hook for certificates.
- The prop, texture names (`txd`, `txn`) and the `stream/` files need an in-game check on your server.

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
- **MOT fee logic** — a tester recording an MOT is not charged anything. Fees only exist for website bookings (`config/apps/booking.lua`) and for the Mechanic app's invoices.
- **txd in `config/config.lua`** — `securitymonitor` confirmed as an embedded texture
  in `lgmods_sinner_monitor.ydr` (no separate .ytd), so txd = model name is right.
  Still worth an in-game test.

## Public apps (anyone can use a computer)

`Config.PublicApps` in `config/config.lua` lists apps that everyone may use on any computer, whatever their job, with no Store install: by default Scout (`browser`), Notepad, Calculator and Settings. That is what lets every player use Presento and the other websites. Job apps (MOT, Mechanic, MDT, Mail, File Explorer, Calendar...) stay limited to `Config.Jobs` and the Store works as before. Players without a computer job only see the public apps and no Store. Empty the table to make computers job-only again.

## Placed computers and TVs (`/placeprops`)

Admins place computers and TVs in-game instead of editing `Config.Locations`. Needs the [object_gizmo](https://github.com/DemiAutomatic/object_gizmo) resource and ox_lib, plus:

```
add_ace group.admin command.placeprops allow
```

`/placeprops` opens a menu: **Place a computer**, **Place a TV / screen** (pick a model), **Placed near me** and **Everything placed** (move with the gizmo, rename, set a TV's jobs, teleport, switch a TV off, delete). Placing spawns the model in front of you with the gizmo. W is move, R is rotate, Left Alt snaps to the ground, and Enter saves. Everything is saved in `computer_placed` (created automatically) and spawned for every player; changes show up for everyone straight away.

- **Placed computers** work exactly like `Config.Locations` ones: target or the E prompt, same camera and apps. Their models are `Config.Placement.computers` (same fields as a location: `prop`, `txd`, `txn`, `screen`, `target`).
- **Placed TVs** show Presento presentations. When placing one you can name it and list the jobs that may cast to it (empty = anyone). Models are `Config.Placement.tvs`; `txd` / `txn` must be the model's screen texture (the defaults use the usual `script_rt_tvscreen` texture; check any model that stays blank with CodeWalker or OpenIV, see "Finding txd/txn for a prop").
- **Casting:** in Presento, Present ▾ > "Show on a TV…" lists TVs within `tvRange` that your job may use. Players within `tvDrawDistance` see the slides; transitions and click animations play on the TV too. The presenter changes slides from the computer or, standing near the TV, with the clicker keys (`Config.Placement.clicker`, default Page Down / Page Up, rebindable in FiveM key bindings). `/tvstop` switches your TV off. A TV switches off when the presenter disconnects or after `castIdleMinutes` without a change. An admin can take over or switch off any TV.
- **Limits:** the texture swap is per model, so two TVs of the same model near each other both show whichever is nearest to you. Use different models for TVs in the same room. TV videos are muted, because DUI sound is not positional.

## Sessions and the live monitor view

**Coming back to a computer.** Walking away (Esc, the close button, or leaving) keeps everything open: come back to the same computer and every window, app and Scout tab is where you left it, still signed in. Start › Power › **Lock** keeps the apps but opens on the lock screen. **Shut down** ends the session and the next open starts fresh. If someone else uses that computer in between, your session there is gone. Sessions last `Config.Session.resumeMinutes` (default 60) and are cleared by a server restart. Open apps keep running while you are away: a playing YouTube video keeps its sound, and an open Presento editor keeps its edit lock.

**Live view.** While someone uses a computer, players within `Config.Mirror.range` see their screen on the monitor, updated about once a second (`Config.Mirror`). The desktop draws itself to a small JPEG with `ui/vendor/html-to-image.js` (MIT), skipping everything not on screen. Scout websites are iframes the snapshot can't see into, so each visible site draws itself through as-browser's SDK (`sdk/html-to-image.js`) and is painted into place. The server passes the picture only to players nearby and only from whoever is signed in and sitting at that computer. Onlookers draw it straight onto that one monitor's screen (two textured triangles over `screen.offset/size`), so each computer shows its own user whatever the model. After the user walks away the last picture stays; Shut down clears it. A location can opt out with `mirror = false`. Videos show their poster, and pictures from other sites that don't allow it (some Imgur/Discord links) show as grey boxes in the live view only. Tested in a headless browser (about 1 s per picture, 20-30 KB each); not yet tried in game.

## Scout (as-browser websites on the desktop)

The desktop has a **Scout** browser app (Chrome-style: tabs, address bar, bookmarks bar, history, and a start page with search). It opens the same in-game websites as the phone browser through the `as-browser` resource, so nothing is duplicated. Bookmarks and history are shared with the phone (per character). The app only appears while `as-browser` is running.

Setup:

1. Nothing to patch. `as-browser` already exports `handle` and `shellInfo` (which Scout uses) and ships with `mot = { enabled = true }` in `sites/gov/config.lua`, so the vehicle checker shows MOT status out of the box. There is no `as-browser-patch` folder any more.
2. Start order: `as-browser` before `as-computer` (see [Start order](#start-order) below).
3. After changing either resource: `refresh` in the server console (needed when a manifest changed), then `restart as-browser`, then `restart as-computer`.

Settings (`config/apps/scout.lua`): `Config.Browser = { enabled, resource, pushMotResults }`. With `pushMotResults` on, every finished MOT test is sent to as-browser (`setMotResult`) with the failed items and advisories as the details text, so the government site's vehicle checker shows the MOT status, expiry and history. With MOT switched on in the gov site, `isRoadLegal` (police/ANPR exports) reports `no_mot` for vehicles that have never been tested.

Only jobs that have the Scout app can use the browser through this terminal: requests go client -> `as-computer` server (job check) -> `as-browser` `handle` export with the real player source. Site pages are as-browser's own `sites/*/index.html` in an iframe, so site changes need no edits here. Saving logins to the phone's Passwords app is not available on the computer.

## Calendar

A Calendar app on the Los Santos OS desktop (also opens from the taskbar clock): Month / Week / Day views, a mini month picker, colour-coded events with optional start/end times or All day, notes, and a current-time line. One **shared team calendar**: every tester with the MOT job sees, edits and deletes the same events (bookings, reminders, shifts). Double-click a day or a time slot to add an event, click one to edit it, right-click for Edit / Delete. Keys: Left/Right change period, T = today.

"Today" is the real date of the PC (the same clock as the taskbar). Events are stored in the `mot_calendar` table, created automatically. Settings in `config/apps/calendar.lua`: `Config.Calendar = { enabled, weekStart }` (weekStart 1 = Monday, 0 = Sunday).

## Calculator and Notepad

Two built-in apps for every character that may use the computer (`store = false` in `config/apps/calculator.lua` and `notepad.lua`; switch either off with `Config.EnabledApps`).

**Calculator:** standard calculator (immediate execution, so 2 + 3 x 4 = 20), memory keys (MC, MR, M+, M-), a history panel (last 30) and keyboard support. Nothing is stored.

**Notepad:** notes saved per character (`computer_notes`, created automatically, utf8mb4 so emoji work). Sidebar list, search, autosave, Ctrl+S / Ctrl+N, font size, delete needs a second click. Limits in `config/apps/notepad.lua`: `Config.Notepad = { maxNotes = 50, maxLength = 20000 }`. Text is in `locales/calculator_en.lua` (`cl_*`) and `locales/notepad_en.lua` (`np_*`). Not tested in game.

## File Explorer files (Documents, Downloads, shared job folder)

The File Explorer's **Documents** and **Downloads** folders (and a **shared folder for the character's job**, shown as "Mechanic (shared)") hold real files kept on the server. The MOT Certificates part and the Recycle Bin for certificates work as before.

- **Folders inside folders:** New folder, open with a double-click, Back / Forward / Up and the address bar all follow the path. `maxDepth` (default 8) limits how deep, `maxPerFolder` how many items per folder and `maxTotal` how many per place.
- **Text files:** New text document, a built-in editor that saves by itself, Rename (F2), Delete (Del, asks first; deleting a folder takes everything in it to the Recycle Bin), search and sorting (folders first). Names are cleaned (no `\ / : * ? " < > |`), `.txt` is added to text files with no extension, and a duplicate name becomes `name (2).txt`.
- **Images, video, audio and other files:** the server never stores the file itself, only a **link** to media hosted somewhere. **Add > Image or file from a link** takes an https address (Imgur, Discord CDN, and so on). Images, video and audio open in a viewer window; other files show their details with Copy link. A thumbnail shows in the preview pane.
  - Because a player's game loads the link, which tells the host their IP address, only hosts in `Config.Files.allowedHosts` work (`'*.example.com'` allows every sub-domain). The default list is a starting point; edit it. `allowAnyHost = true` lifts the limit (not recommended). The address must be https, without a port or `user@`, and is shown as text, never as HTML.
  - **Phone Photos (sd-phone):** **Add > Photos from your phone** lists the character's own photos and imports the ones ticked (up to 20 at a time). **Send to phone Photos** (right-click, or in the viewer) saves an image or video back to the phone. This uses sd-phone's public `getPhotos` and `addPhoto` exports, so nothing in sd-phone is edited; `phoneImport = false` switches it off. Photos already on the phone do not need to be in `allowedHosts`.
- **Copy and move:** select items, then **Copy to...** or **Move to...** (a picker with every folder), or right-click, or drag. Dragging onto a folder (in the list or the left tree, or the address bar) moves within the same place and copies to another place (hold Ctrl to copy). Copying a folder copies everything inside it.
- **Who can do what:** Documents and Downloads belong to the character. In the shared folder everyone on the job can open, add and copy; only the author can rename, delete or move a file or folder, and the job boss can too unless `bossManagesAll = false`. A folder that holds a workmate's file can only be deleted by the boss.
- **Notepad:** a "Save to Documents" button saves a copy of the open note as a text file.
- **Recycle Bin for files:** deleting a file or folder moves it to the same Recycle Bin the MOT certificates use (a folder goes in as one item and comes back whole). In the bin you can Restore (back to where it was, or to the top level of that place if the folder is gone or full; a name clash becomes `name (2)`), Delete permanently, or Empty Recycle Bin. Items leave the bin by themselves after `Config.Files.binDays` days (default 30, 0 = never); `recycleBin = false` makes deleting permanent again. In the shared job folder the whole job sees the bin, but only the author or the boss can restore or delete a given item (Empty skips what you may not manage). Binned items do not count toward the folder limits. A table from before the bin is upgraded on start (columns `deleted_at`, `del_root`, `deleted_by`).
- Settings in `config/apps/files.lua` (`Config.Files`): `enabled`, `maxPerFolder`, `maxTotal`, `maxDepth`, `maxLength`, `maxNameLength`, `sharedFolders` (`'auto'` = every job that may use the computer, or a list like `{ mechanic = true }`), `excludeJobs`, `bossManagesAll`, `allowedHosts`, `allowAnyHost`, `phoneImport`, `phoneResource`, `recycleBin`, `binDays`. Table `computer_files` is created automatically, and a table from the earlier text-only version is upgraded on start. Text is in `locales/files_en.lua` (`fl_*`).
- Not done: uploading a file from a player's own PC (FiveM cannot pick files from the player's disk), storing the file bytes on the server, cut and paste with the keyboard. Not tested in game.

## Mail

A Mail app on the desktop that shows the character's **own mailboxes from the phone's Mail app (sd-phone)**: the same accounts, folders and messages, not a separate inbox. Read, reply, reply all, forward, flag, mark as spam, delete (bin, then delete for good), write new mail, save drafts and send to any address (other players, businesses, the quotes and invoices the Mechanic app emails). Mail read here is read on the phone, and the phone still pings and shows its banner when mail arrives; while the computer is open the list also updates live. If a character has no account signed in (or wants another one), the app signs in with the address and password from the phone. New addresses are created in the phone's Mail app (Sign up); this app does not create them. Attachments are shown (photos, notes, voice memos and documents are listed) but you attach and save them on the phone.

How it works: the page calls `client/mail.lua`, which asks the server whether this player may use the app (`server/mail.lua`, `mailGate`: computer job + the app is available), then calls sd-phone's own Mail callbacks as that player. So all of sd-phone's rules apply exactly as on the phone: you must be signed in to the account, send and delete rate limits, size limits. Only these callbacks can be reached: `list`, `signIn`, `signOut`, `send`, `saveDraft`, `discardDraft`, `markRead`, `toggleFlag`, `moveToBin`, `move`. Nothing is stored by as-computer and there is no database table.

Setup: nothing to install in sd-phone. **as-computer now loads `ox_lib` on the client** (the manifest has `@ox_lib/init.lua`); sd-phone needs ox_lib as well, so it is already on the server. The app only shows while `sd-phone` is running. Settings in `config/apps/mail.lua`: `Config.Mail = { enabled, resource }`, and `Config.Apps.mail` (built in for every job that may use the computer; set `store = true` to hand it out through the Store, `jobs` to limit it). Text is in `locales/mail_en.lua` (`ml_*`).

Not done: attaching photos or notes, contacts and address autocomplete, sign-up, mail folders beyond the phone's five, Windows-style notification toasts (a small "New mail from ..." message appears inside the app). Not tested in game.

## Mechanic (job cards, quotes, invoices, customers, vehicle history, parts)
A Store app for garages, opened from the desktop like the others. Everything is kept per job, so one garage never sees another's data. The Store decides who has it (`Config.Apps.mechanic` in `config/apps/mechanic.lua`, default job `mechanic`, managed by the boss). Tables are created on start (`computer_mech_*`, also in `sql/install.sql`).

- **Overview**: active job cards, waiting for parts, ready, unpaid and overdue invoices, quotes awaiting a reply, money paid this week, low stock, today's MOT bookings.
- **Job cards** (`JC-0001`): plate, vehicle, mileage, customer, work required, tasks, assigned mechanic. Status: open, in progress, waiting for parts, ready, completed, cancelled. Completing one writes a "service" entry to the vehicle's history on the government website (`logToHistory`).
- **Quotes** (`Q-0001`) and **invoices** (`INV-0001`): labour, part and other lines, optional VAT (`vatRate`). Quote flow: draft, sent, accepted or declined, then "Convert to invoice". Invoice flow: draft, issued, paid or void. Overdue is worked out from the due date (`dueDays`).
- **Stock is only touched when an invoice is issued.** Issuing is all or nothing: if any part is short it is refused and names the part (`allowNegativeStock` to change that). Voiding puts the parts back.
- **Taking payment**: *Card* asks the customer, on their own screen, to press Y or N (`payPromptSeconds`). The customer must be online, close (`playerRange`) and linked to a character. The money moves from their bank to the job's society account. *Paid in person* only records the payment and credits nothing unless `manualPaysSociety = true`, so nobody can create money by ticking a box.
- **Customers**: added by hand, or "Add person nearby" (server id), which links them to their character so they can be emailed and charged. Vehicle owners can be added from a plate lookup.
- **Vehicles**: look up any plate: register status, owner, MOT, police flags, and a timeline of job cards, quotes, invoices and MOT tests.
- **Parts**: stock list with categories, minimum level warnings, receive and adjust with a reason, a stock log, stock value.
- **Email**: with sd-phone running, quotes and invoices are emailed to the customer's phone and an in-game notice is shown (`Config.Mechanic.mail`).

For other scripts: `exports['as-computer']:getServiceHistory(plate)` returns completed job cards, and the server events `as-computer:mechanic:invoiceIssued`, `:invoicePaid` and `:jobCompleted` (or the `onInvoiceIssued` / `onInvoicePaid` / `onJobCompleted` hooks) fire with the record. A plate change from as-browser is followed automatically.

Files: `config/apps/mechanic.lua`, `server/mechanic.lua`, `client/mechanic.lua`, `ui/mechanic.js`, `ui/mechanic.css`, `locales/mechanic_en.lua`. The window is added through `LSOS.registerApp` at the end of `ui/app.js`, which any later app can use the same way. Translations: copy `locales/mechanic_en.lua` and change `'en'` to your language code. It adds strings to that language without creating a new one.

## Crypto Mining Rig

A full crypto-mining minigame: players buy a tower case, a monitor and a mining rig as regular inventory items, place them in the world themselves, wire the tower into their computer, load parts and GPUs into the rig, and run a Mining Rig app on the desktop that mines a coin balance over time. Open to every player — there is no job or licence gate, and no admin step is needed to set any of it up.

**Items and the shop.** A ped/blip shop (`Config.Mining.Shop`) sells everything: the 15 tower part items (5 slots x 3 tiers) from the original Phase 1 build, one **`computer_tower_<model>`** item per tower case model (`dyn`, `res`, `x17`, `pca`, `apt`, `heist`, `pcb` — each model is its own distinct item so players choose the look they buy, not a look they pick after placing it), a **`computer_monitor`** item, and **`mining_rig_small` / `mining_rig_medium` / `mining_rig_large`** chassis items. Prices are in `Config.Mining.ChassisPrices` (per tower model, the monitor, and per rig size); part prices are in the original Phase 1 part config. Buying a chassis or part removes the money and gives the ox_inventory item; using an item is what places it.

**Placing things.** Using a tower, monitor or rig item drops it from your inventory and shows the same object-gizmo tool the admin `/placeprops` command uses, so you can position and rotate it exactly where you want, then confirm to place it. Nothing here needs `/placeprops` or an ace permission — any player can do this with an item in their inventory. Placement flow per item:

- **Monitor** — places on its own as a decorative screen. Interacting with it plays a short boot delay (`lib.progressBar`) and then powers it on; from that point it is a real Los Santos OS computer (its own login, session, and every desktop app), exactly like a business or admin-placed computer.
- **Tower case** — places as a decorative case (no screen of its own). Once placed, use it to open its 5-slot parts menu (CPU/GPU/RAM/PSU/storage, 3 tiers each) to install or remove parts from your inventory, same wear/condition system as the original Phase 1 tower.
- **Mining rig** — must be placed within `Config.Mining.TowerLinkRange` (8m) of a monitor, and the game offers a picker of nearby unlinked monitors to link it to. Once placed and linked, use it to open its GPU-slot menu and install GPUs. If a rig's chassis size has more than one prop option, you're offered a choice of look when placing it.

A placed monitor, tower or rig is tracked in its own database table (`computer_mining_placed`), separate from the admin `/placeprops` table (`computer_placed`) — the two systems don't interact, and **`/placeprops` still works exactly as before** for admins placing business/admin computers and monitors.

**The app.** Opening the Mining Rig app on a powered monitor shows the linked tower's parts and condition, any linked rigs and their GPU slots, the current coin balance and mining rate, and a Start/Stop control. The balance is polled every 8 seconds; when it goes up you get a short synthesized "ping" sound and the balance briefly flashes, and the "Mining" badge pulses gently while running (all of this respects `prefers-reduced-motion`). Rigs can be linked to or unlinked from a computer from the app as long as you own both sides (unlinking only needs you to own one side, so a computer owner is never stuck with a rig whose owner has moved on).

**Wear, failure and payout.** Parts and GPUs lose condition over time while mining and can randomly fail a tick, losing extra condition; if something fails, the owner gets an in-game notification (even if they aren't the one currently on the computer) naming the affected slot(s). There is no payout cap and no admin dashboard for this feature — both are deliberately out of scope per the locked spec.

**Anti-abuse.** Every action that changes state (buying, placing, powering on, starting/stopping, installing or removing a part or GPU, linking/unlinking) is rate-limited per player (`Config.Mining.RateLimitSeconds`, default 0.75s) and, when `Config.Mining.AuditLog` is enabled (default on), printed to the server console with a `[as-computer:mining:audit]` tag. Read-only polling (the app's periodic refresh, listing available rigs) is not rate-limited.

**Crypto cash-out.** The coin balance is spent the same way as the original Phase 1 design, through sd-phone's crypto app — this feature doesn't introduce a second currency.

**Requires two exports on `sd-phone`.** Mining payout and the app's balance/wallet display talk to sd-phone's crypto holdings directly (`server/mining.lua`), and stock sd-phone does not ship these — you have to add them to your `sd-phone` install yourself before the Mining Rig app will work:

- `exports['sd-phone']:creditCrypto(citizenid, coin, amount)` — adds `amount` of `coin` to that citizen's crypto balance (the periodic mining payout tick, paid straight to the tower's *owner*, never whoever's currently logged into the computer). Return `true` on success, or `false, "reason"` on failure (as-computer only checks the first value and logs the second on failure — `"unknown_asset"` is a sensible reason for a coin symbol your sd-phone build doesn't recognise). Coin symbols come from `Config.Mining.Coins` in `config/mining.lua` and are **not** validated against sd-phone's own asset list before this call — a typo'd symbol in that config just means every payout for it fails here instead of being caught earlier.
- `exports['sd-phone']:getCryptoInfo(citizenid, coin)` — read-only lookup used for the app's dashboard (current payout coin) and the Wallet tab (every configured coin at once). Return `true, { price = <number>, quantity = <number> }` on success (`price` = that coin's current price, `quantity` = how much of it this citizen holds), or `false` if the citizen or coin can't be resolved.

Both are called with the *citizenid* of the computer's owner (from `Accounts.getOwnerCitizenId`), not a player source, so they need to work for offline citizens too, the same way sd-phone's own crypto app would look up a balance. If these exports are missing entirely, the payout tick will error and the app's balance/price will always show as 0 — check your server console for `[as-computer:mining]` errors naming a missing export if crypto mining seems to do nothing.

**Exactly what to add to `sd-phone`** (tested against sd-phone's Stocks app, which already ships a `kind = 'crypto'` asset type — `configs/stocks.lua` needs no changes if your crypto symbols there already match `Config.Mining.Coins`, e.g. the default `SDC`/`BTL`/`ETD`/`SPC`/`MZC`/`FLC`/`WZC`/`POG`/`VWC`/`KIF`):

1. Open `sd-phone/server/stocks/actions.lua`. Add these two functions right before the file's final `return actions` line:

   ```lua
   ---Credits a citizenid's holding of a crypto symbol directly, with NO wallet cash or bank movement -
   ---for another resource paying out crypto it generated itself (as-computer's Crypto Mining Rig).
   ---Not a trade: no fee, no market impact, no price effect, and it works for an offline citizenid.
   ---@param citizenid string framework per-character id (the payout's owner)
   ---@param symbol string a crypto asset's symbol, e.g. 'SDC'
   ---@param units number units to credit; must be > 0
   ---@return boolean success, string|nil error one of 'unknown_asset' | 'not_crypto' | 'invalid_units' | 'db_error'
   function actions.creditCrypto(citizenid, symbol, units)
       if type(citizenid) ~= 'string' or citizenid == '' then return false, 'invalid_units' end
       symbol = tostring(symbol or '')
       local meta = engine.meta(symbol)
       if not meta then return false, 'unknown_asset' end
       if meta.kind ~= 'crypto' then return false, 'not_crypto' end
       units = tonumber(units)
       if not units or units <= 0 then return false, 'invalid_units' end

       local ok = store.creditHolding(citizenid, symbol, units)
       if not ok then return false, 'db_error' end
       return true
   end

   ---Read-only price + a citizenid's own balance for one crypto symbol, with no wallet/holding writes -
   ---for another resource that wants "current price" + "your balance" (as-computer's Mining Rig
   ---dashboard). Works for an offline citizenid.
   ---@param citizenid string framework per-character id
   ---@param symbol string a crypto asset's symbol, e.g. 'SDC'
   ---@return boolean success, table|string data { price, quantity } on success, else an error string
   ---  one of 'unknown_asset' | 'not_crypto'
   function actions.getCryptoInfo(citizenid, symbol)
       symbol = tostring(symbol or '')
       local meta = engine.meta(symbol)
       if not meta then return false, 'unknown_asset' end
       if meta.kind ~= 'crypto' then return false, 'not_crypto' end

       local price = engine.priceOf(symbol) or meta.basePrice or 0
       local holding = type(citizenid) == 'string' and citizenid ~= '' and store.getHolding(citizenid, symbol) or nil
       return true, { price = price, quantity = holding and tonumber(holding.quantity) or 0 }
   end
   ```

   Both reuse functions the Stocks module already has: `engine.meta`/`engine.priceOf` (the same price simulation the phone's own Stocks app reads) and `store.creditHolding`/`store.getHolding` (the same `phone_stock_holdings` table trades already write to). No new database table and no `configs/stocks.lua` changes are needed — you're adding two functions, not a feature.

2. Open `sd-phone/server/stocks/init.lua`. Add these two exports anywhere after `local actions = require 'server.stocks.actions'` (right after the existing `lib.callback.register('sd-phone:server:stocks:...')` block is a natural spot):

   ```lua
   -- Cross-resource export: another resource crediting crypto it generated itself (no trade, no wallet
   -- cash involved) calls exports.sd-phone:creditCrypto(citizenid, symbol, units) -> true, or false + an
   -- error string ('unknown_asset' | 'not_crypto' | 'invalid_units' | 'db_error'). See actions.creditCrypto.
   exports('creditCrypto', function(citizenid, symbol, units)
       return actions.creditCrypto(citizenid, symbol, units)
   end)

   -- Cross-resource export: read-only price + a citizenid's own balance for one crypto symbol, e.g. for
   -- as-computer's Mining Rig dashboard. exports.sd-phone:getCryptoInfo(citizenid, symbol) ->
   -- true, {price, quantity} or false, errorString. See actions.getCryptoInfo.
   exports('getCryptoInfo', function(citizenid, symbol)
       return actions.getCryptoInfo(citizenid, symbol)
   end)
   ```

3. Restart `sd-phone`, then restart `as-computer`. Test by placing a mining monitor, filling its 5 slots, starting it, and checking the Wallet tab shows a balance for the owner's citizen — or just wait for one payout tick and confirm the balance in the phone's own Stocks app went up too (it's the same holding row).

If your `sd-phone` fork doesn't use the `server/stocks` module layout above (a heavily customized or much older fork), the two functions can go anywhere server-side as long as they end up exported under those exact names with that exact signature — `engine.meta`/`engine.priceOf`/`store.creditHolding`/`store.getHolding` are just this build's names for "look up an asset's config", "get its current price", "atomically add to a holding" and "read a holding"; swap in your fork's equivalents if the names differ.

**Config:** `config/mining.lua` — tower/rig prop and item tables, the monitor prop/item, `TowerLinkRange`, chassis prices, and the Phase 5 tuning values (`RateLimitSeconds`, `AuditLog`, `Notifications`). **Locales:** `locales/en.lua` (`mp_*` keys for placement/power/parts/GPUs, `shop_*` keys for the shop, `mining_notify_failure` for the part-failure push). **Files:** `server/mining.lua`, `server/mining_place.lua`, `client/mining_place.lua`, `client/mining_shop.lua`, `ui/mining.js`, `ui/mining.css`, item defs in `ox_inventory/data/items.lua`.

**Pickup.** A tower, monitor or rig's owner (whoever placed it) can pick it back up from the same target menu it was placed with ("Pick up"), returning the item to their inventory. Picking up a monitor force-closes any active session on it, hands back everything its linked tower held plus every GPU on any linked rig (the rigs are auto-unlinked, not deleted — they stay placed, idle, ready to link to another monitor), and wipes its account/owner record entirely, since the machine stops existing. Picking up a tower or rig on its own just hands back what it was holding and unlinks it. A full inventory refuses the whole pickup up front rather than stranding a half-unwound prop.

Not done yet: the app's "add rig" picker still lists every unlinked rig server-wide rather than scoping to rigs on the same owned property; that's an accepted v1 simplification given the no-property-gate, item-based design chosen for this feature.
