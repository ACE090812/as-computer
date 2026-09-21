-- Mail app: the character's own mailboxes from the phone's Mail app (sd-phone), on the desktop.
-- Read, reply, forward, flag, delete, write and send, sign in to more accounts. Nothing is stored by the computer:
-- it is the same mail as on the phone, so mail read here is read on the phone and the phone still pings.
-- Addresses are created on the phone (Mail app > Sign up); this app can sign in to them.
-- Needs sd-phone and ox_lib to be running; without sd-phone the app is not shown.

Config.Mail = {
  enabled  = true,
  resource = 'sd-phone',
}

-- Built in by default: everyone who may use the computer has it. Set store = true (and jobs / price if you like) to make
-- the Store hand it out instead. Mail is personal (it belongs to the character, not the job).
Config.Apps.mail = {
  store     = false,
  jobs      = nil,
  price     = 0,
  icon      = 'mail',
  tint      = '#0f6cbd',
  category  = 'work',
  publisher = 'Los Santos OS',
  version   = '1.0',
}
