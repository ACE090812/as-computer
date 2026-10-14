# Los Santos OS and Browser: build plan (from the 200+ answers)

Work one feature at a time, test, commit and push straight to `main`. Strings go in locale files. Richer visuals are fine.

## 0. Rules that apply everywhere
- Existing computers are wiped once at launch (confirmed). Config and admin-placed PCs also need a tower.
- The only malware paths are: bad downloads (config list of "sketchy" files), mail attachments with a sketchy file, and an admin button. Infection only slows the PC, shows pop-ups, alerts the owner that logins were exposed, and can cause a crash. It never reads another player's files or logs and never bypasses a login. The hacking minigames stay robbery-target only.
- New job: `it`. News job: `news`.

## 1. Hardware and boot (first)
- Tower required for every computer. One tower per monitor. Mining rigs stay separate, with no effect on the desktop PC.
- Required parts: CPU, RAM, PSU, HDD. Optional: GPU, network card (Wi-Fi or Ethernet), 2nd HDD, 2nd RAM.
- Slots: one each, 2 RAM, and a second HDD.
- Tiers Std/Adv/Elite, existing mining items and prices reused. New: network card items, cooling items (fan, liquid), UPS not planned.
- Anyone nearby can fit or remove parts. Parts and towers are free to swap between monitors.
- Wear about 100 hours per part. Worn parts get slower. Temperature from load, wear and cooling.
- HDD holds the files: sizes in MB by file type, Cannot save when full, files travel with the HDD item.
- GPU needed for video and for Chess, Solitaire and Blocks (Std); Snake, Tic-tac-toe and Connect 4 need none.
- Boot time depends on CPU and startup apps. Settings > About shows the real parts.
- Starter: Basic PC box (Std parts), Gaming PC, Workstation, upgrade kits. Boxes unpack into separate part items.

## 2. Accounts
- Per-PC local accounts linked to the character: password with an optional PIN, several per PC, a guest account (no installs, no settings changes, files wiped on sign-out, owner can disable guests), lock screen lists accounts, only the owner creates accounts.
- Each account has its own folders plus a shared folder. Accounts and files stay with the PC and HDD.
- Shared across a character's computers: email (phone Mail inbox), calendar and notes, phone photos and files. Per PC only: files, downloads, installed software, desktop layout and icons, hardware and malware state.

## 3. Task Manager, notifications, desktop
- Task Manager tabs: Processes, Performance (CPU, memory, disk, GPU, network), Startup, Details/Services. Opened by Ctrl+Shift+Esc, taskbar right-click, Start menu and the Ctrl+Alt+Del screen. Same cost for every app, any window can be ended, frozen apps when overloaded. Background rows: miner, antivirus, malware, alarm and update services.
- Notification centre: toasts bottom right for 5 seconds, a panel, Do not disturb that silences everything, per-app mute, sound (mail, alarms, security, breaking news), kept for the session only. Export for other scripts takes target, title, text, icon, app name, action link and priority.
- Desktop: snap left/right and maximise by drag, right-click menus (file, desktop, taskbar, send to phone/Mail), arrangeable desktop icons and shortcuts, keyboard shortcuts, weekly fake update (postpone 3 times), Sleep/Restart/Shut down, power cut by export and event, Windows-style blue screen with a stop code and QR.
- Diagnostics app (any PC): part health, temperature and load, fault codes, IT repair button. Blue screens come from worn or missing parts, overheating, a small random chance and malware, and cost the failing part extra wear.

## 4. New apps
- Paint (up to 1920x1080, layers, undo, select, zoom, saves PNG to Pictures), Photo viewer (slideshow, zoom, rotate, set as wallpaper, print, PNG/JPG/GIF/WebP/phone photos/screenshots) with crop, rotate, brightness, contrast, filters, undo and overwrite option.
- Media player: playlists (10 of 100 tracks), shuffle, repeat, volume, equaliser, background play, files from Explorer, any direct audio or video URL, the phone Music app, nearby players hear it within 10 metres, cast to a placed TV, only the owner mutes it.
- Calendar: personal calendar, reminders as notifications, share an event (added automatically), link to the phone calendar.
- Clock: labelled alarms with snooze and sound choice, timer, stopwatch, world clocks (real world time).
- Settings additions: Sound page, Storage page, Hardware page.
- Antivirus: 3 day trial then 150 per 30 days, scan and quarantine, real-time protection, needs updates, scans disabled when the trial ends, quick scan 20s and full scan 90s using CPU.

## 5. Websites (as-browser)
- Findr (`findr.co.uk`): search for sites, news, marketplace adverts and images; recent searches, suggestions, trending. It becomes the address bar's search.
- Findr account: signs in with the character's phone Mail address (read from sd-phone, no separate username) plus a Findr password; works on any PC or the phone; syncs history (30 days), bookmarks, reading list and saved logins; data is removed from a PC you do not own at sign-out; recovery by a code to the phone Mail; sites offer to fill saved logins.
- LS Marketplace: vehicles, services and wanted adverts with the agreed fields, 7 days and 5 live adverts, fee 100/50/25 removed from the economy, linked image hosts, contact number reveal button, report button (hidden after 3 reports), word filter.
- News: Crime and Courts, Business and Money, Weather, Events and Community; reporters write with a rich editor (draft, then publish), pay per published article, breaking banner on the site and as desktop and phone notifications; automatic generic headlines (names behind a config switch).
- LS Tech Direct (`lstechdirect.co.uk`): categories with specs, compare any number of parts, Postal Prime locker, home delivery, collect at the mining shop, free delivery over 2000, bank payment.
- Five software vendor sites (antivirus, paint extras, utilities, cleaner, benchmark), one per product, with `registerSite` and `registerSoftware` exports.
- Browser: downloads into the Downloads folder (counts to storage), private tabs, tab groups, pinned tabs, tab limit, reading list.

## 6. Admin and jobs
- `/pcadmin`: moderation of adverts and articles (hide, delete, reports, ban a character), per-PC infect/cure/restart buttons, a global blackout toggle, and a hardware and files summary per PC.
- IT job: repair wear with a consumable item, remove malware, read fault codes, build and sell PCs at the tech shop.

## 7. Build order
1. Hardware, towers, boot rules, wipe migration
2. Per-PC accounts and shared data
3. Task Manager, notifications, desktop UX
4. Diagnostics, blue screens, IT job
5. Settings pages, Paint, Photo viewer, media player, Calendar, Clock
6. Findr, accounts, then browser features
7. Marketplace, news, tech shop, software sites, antivirus and malware
8. `/pcadmin` additions
