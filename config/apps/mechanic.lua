-- Mechanic app: job cards, quotes and invoices, customers, vehicle history and parts stock.
-- Everything is kept per JOB (a garage's data is only ever shown to that job). Amounts are whole pounds.

Config.Mechanic = {
  -- Reference prefixes. Numbers count up per job: JC-0001, Q-0001, INV-0001.
  prefixes = { job = 'JC-', quote = 'Q-', invoice = 'INV-' },

  vatRate = 0,              -- percent added to quotes and invoices. 0 = no VAT line at all.
  labourRate = 60,          -- pounds per hour offered when a labour line is added
  dueDays = 14,             -- days a customer has to pay after an invoice is issued (overdue after that)

  -- Details printed at the top of quotes and invoices, per job. Anything left out falls back to the job's label.
  business = {
    mechanic = { name = nil, address = 'Los Santos', phone = nil, vatNumber = nil },
  },

  -- Taking payment on an invoice.
  --   card    charges the customer's BANK. The customer must be online and linked to the invoice, and is asked
  --           to accept on their own screen. The money goes to the job's society account.
  --   manual  "paid in person": only records the payment. Nothing is credited unless manualPaysSociety = true.
  allowCard = true,
  allowManual = true,
  manualPaysSociety = false,
  payPromptSeconds = 30,    -- how long the customer has to accept a card payment

  allowNegativeStock = false,   -- false: an invoice cannot be issued if the parts are not in stock

  -- Completed job cards are written to the vehicle's history on the government website (as-browser).
  logToHistory = true,

  -- Email quotes / invoices to the customer's phone (sd-phone Mail). Needs the customer linked to a character.
  mail = {
    enabled = true,
    autoSend = true,        -- send when an invoice is issued or a quote is marked as sent
    resource = 'sd-phone',
    from = { name = nil, email = 'noreply@lsgarages.co.uk' },   -- name defaults to the business name
  },

  playerRange = 15.0,       -- metres: "add the person next to me as a customer" only works this close
  deleteRule = 'boss',      -- who may delete job cards / customers / parts: 'boss' | 'any' | a minimum grade number
  partCategories = { 'Engine', 'Brakes', 'Suspension', 'Tyres', 'Electrical', 'Body', 'Fluids', 'Other' },

  -- Optional hooks for other scripts. The same information is also sent as server events
  -- ('as-computer:mechanic:invoiceIssued', ':invoicePaid', ':jobCompleted').
  -- onInvoiceIssued = function(invoice) end,
  -- onInvoicePaid = function(invoice) end,
  -- onJobCompleted = function(job) end,
}

Config.Apps.mechanic = {
  store     = false,  -- no Store purchase needed - free for the mechanic job
  workOnly  = true,   -- only usable on a /placeprops computer locked to 'mechanic' - never on a home/personal computer
  jobs      = { 'mechanic' },
  manage    = 'boss',
  price     = 0,
  icon      = 'mechanic',
  tint      = '#c2410c',
  category  = 'work',
  publisher = 'Los Santos OS',
  version   = '1.0',
}
