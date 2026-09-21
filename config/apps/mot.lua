-- MOT Testing Service app.

-- Days a passed MOT stays valid.
Config.MOTExpiryDays = 30

-- Testers can add a note to any advisory / failed item (shown on the certificate).
-- true = a note is compulsory for every advisory and fail. MaxNoteLength = most characters per note.
Config.RequireNotes = true
Config.MaxNoteLength = 200

-- Printing certificates (not built yet): name of a CLIENT event that receives the
-- certificate table { testNumber, plate, model, passed, issuedAt, expiresAt, mileage,
-- mileageUnit, testerName, locationLabel, failedItems, advisoryItems } when the tester
-- presses Print. Leave nil and the Print button stays disabled.
Config.PrintEvent = nil

-- Store listing. Every app has one of these entries in Config.Apps (this is the template for a new app).
Config.Apps.mot = {
  store     = true,                 -- true: a boss installs it from the Store, then the whole job has it.
                                    -- false: always on the desktop (built in).
  jobs      = { 'mechanic' },       -- jobs allowed to install and use it. nil / {} = any job.
  manage    = 'boss',               -- who may install / remove it for the job: 'boss' | 'any' | a minimum grade number.
                                    -- Leave out to use Config.Store.manage. Every app can set its own.
  price     = 0,                    -- pounds, paid from the job's society account when installed. 0 = free.
                                    -- A job that has paid once can reinstall for free.
  icon      = 'mot',                -- tile / desktop icon (a name from ICONS in ui/app.js)
  tint      = '#1d70b8',            -- tile colour in the Store
  category  = 'work',               -- locale key store_cat_<category>
  publisher = 'Los Santos Government',
  version   = '1.0',
  -- label = 'MOT Testing Service',  -- optional. Names and descriptions normally come from the locale
  -- desc  = '...',                  -- (store_mot_name, store_mot_desc, store_mot_f1 .. f4).
}
