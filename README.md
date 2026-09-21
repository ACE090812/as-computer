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

as-computer does not use items. Nothing to add to ox_inventory or qb-inventory. Certificate printing is not built (`Config.PrintEvent`).

### What is not done or not tested

- Not run on a real ESX server (see Vehicles and plates).
- The Mail app and Mechanic card payments have not been tested in game.
- Certificate printing (`Config.PrintEvent`) is a hook only.
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

The File Explorer's **Documents** and **Downloads** folders (and a **shared folder for the character's job**, shown as "Mechanic (shared)") now hold real text files kept on the server. The MOT Certificates part and the Recycle Bin for certificates work as before.

- **Documents / Downloads** belong to the character and follow them to any computer. **The shared folder** belongs to the job: everyone on the job can open files, add files and copy them out; only the author can rename or delete a file (and the job boss can too, unless `bossManagesAll = false`).
- **Files:** New text document, Open (a built-in text editor that saves by itself), Rename (F2), Delete (Del, asks first), Search, sorting. Names are cleaned (no `\ / : * ? " < > |`), `.txt` is added if there is no extension, and a duplicate name becomes `name (2).txt`.
- **Upload and download:** select files, then **Copy to** (or right-click, or drag onto a folder in the left tree). From Documents or Downloads it offers "Upload to <Job>"; from the shared folder it offers "Download to Downloads". Copies are independent files.
- **Notepad:** a "Save to Documents" button saves a copy of the open note as a text file.
- Settings in `config/apps/files.lua` (`Config.Files`): `enabled`, `maxPerFolder` (200), `maxLength` (50000 characters), `maxNameLength`, `sharedFolders` (`'auto'` = every job that may use the computer, or a list like `{ mechanic = true }`), `excludeJobs`, `bossManagesAll`. Table `computer_files` is created automatically. Text is in `locales/files_en.lua` (`fl_*`).
- Not done: real uploads from your own PC (FiveM cannot pick files from the player's disk), binary files or images, a Recycle Bin for deleted files (deleting a file is permanent, after a confirmation), folders inside folders. Not tested in game.

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