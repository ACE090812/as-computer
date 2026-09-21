-- MOT bookings made on the government website (as-browser, lsgov.co.uk > "Book an MOT test").
-- Players pick a garage, a day and a time slot and pay the fee. The booking then shows up in the Calendar
-- app of the garage's job (read-only, in the colour below) and on the MOT app when the plate is looked up.
--
-- Garages: every entry in Config.Locations (config/config.lua) that has a `booking = { ... }` table is a
-- garage players can choose. Nothing else is needed to add another garage: add a location with `booking`.
--
-- The fee is held until the test happens: it is paid into the garage job's society account when a tester
-- records the MOT for that plate, or when the slot has passed unused. Cancelling in time gives it back.

Config.Booking = {
  enabled = true,

  fee = 40,                 -- pounds, charged from the player's bank when they book (0 = free). A garage can set its own `fee`.

  daysAhead = 7,            -- how many days (today included) can be booked
  closedWeekdays = {},      -- days garages are shut: 0 = Sunday .. 6 = Saturday, e.g. { 0 }

  -- Time slots each day, in real server time. Either a range ...
  slots = { from = '09:00', to = '17:00', every = 30 },
  -- ... or an explicit list:  slots = { '09:00', '10:30', '14:00' }
  duration = nil,           -- minutes a booking takes in the Calendar (default: the `every` value, else 30)

  bays = 1,                 -- bookings allowed at the same time per garage. A garage can set its own `bays`.

  minNoticeMinutes = 30,    -- earliest a slot can be booked, from now
  cancelMinutes = 60,       -- a booking can be cancelled or changed until this many minutes before it
  maxActivePerPlayer = 3,   -- most upcoming bookings one character can hold
  noShowGraceMinutes = 30,  -- after the slot ends, an unused booking is closed and the fee goes to the garage

  remindMinutes = 30,       -- email reminder this long before the slot (0 = off)
  colour = 'orange',        -- Calendar colour: blue | green | red | orange | purple | grey
}
