-- Store app: where a job gets its apps. A boss installs an app once and everyone on that job has it.
-- Which apps are in the Store, which jobs may install them and what they cost is set in each app's own
-- file (config/apps/<app>.lua, Config.Apps.<id>). This file is only the Store itself.

Config.Store = {
  -- false = no Store. Every app with store = true is simply available to the jobs listed for it.
  enabled = true,

  currency = '£',

  -- Who may install and uninstall apps for their job (the default; an app can set its own `manage` in its Config.Apps entry):
  --   'boss'  the job's boss grade only
  --   'any'   every employee
  --   number  this grade level and above (e.g. 3)
  manage = 'boss',

  -- Paid apps are charged to the job's society account. Name of the account for a job:
  accountFor = function(job) return job end,

  -- Which society bank to use:
  --   'auto'          the first supported one that is started
  --   'renewed'       Renewed-Banking       
  --   'qb-banking'    qb-banking
  --   'qb-management' qb-management         
  --   'okokbanking'   okokBanking
  --   'fd_banking'    fd_banking            
  --   'esx_society'   esx_addonaccount / esx_society
  --   'custom'        fill in the three functions below
  -- Only used when an app has a price above 0.
  bank = 'renewed',
  logTransactions = true,   -- record the purchase on the society's transaction list when the bank supports it
  custom = {
    -- balance(account) -> number
    -- remove(account, amount, reason) -> true when the money was taken
    -- add(account, amount, reason)
    balance = function(account) return 0 end,
    remove  = function(account, amount, reason) return false end,
    add     = function(account, amount, reason) end,
  },
}

-- The Store itself is always on the desktop.
Config.Apps.store = { store = false, icon = 'store', tint = '#0f6cbd', publisher = 'Los Santos OS' }
