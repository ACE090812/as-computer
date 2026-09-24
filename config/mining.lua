-- Crypto Mining Rig, Phase 1: parts, tiers and prices. Single source of truth for the shop, the
-- crafting/assembly logic (server/mining.lua) and the future Mining Rig app (Phase 3) - the ox_inventory
-- item names below MUST match data/items.lua in ox_inventory exactly, or the shop/assembly code will
-- silently fail to find the item.
--
-- Phase 1 scope only: item definitions + prices. NOT included here (later phases): the physical
-- shop ped/blip and its payment flow, the tower prop's special inventory slots that these parts get
-- slotted into, and the Mining Rig app itself - see the plan doc's phased build table.

Config.Mining = {}

-- Part types, in the order they're shown in any UI/shop list. `key` is used to build each item name
-- as 'mining_<key>_<tier>' (see Items below) - never renamed once players own parts with that name.
Config.Mining.Parts = {
  { key = 'cpu', label = 'CPU',            productName = 'Zancudo Core' },
  { key = 'gpu', label = 'GPU',            productName = 'Prime Vector' },
  { key = 'ram', label = 'RAM',            productName = 'FlashBank'    },
  { key = 'psu', label = 'PSU',            productName = 'VoltCore'     },
  { key = 'hdd', label = 'HDD/SSD',        productName = 'DataVault'    },
}

-- Tiers, in ascending order. `mult` is this tier's contribution multiplier toward a rig's hash rate
-- (Phase 2's server core reads this - a full Elite build should mine noticeably faster than a full
-- Standard one). Kept here rather than hardcoded in Phase 2 so tuning never touches item data.
Config.Mining.Tiers = {
  { key = 'std',   label = 'Standard', mult = 1.0 },
  { key = 'adv',   label = 'Advanced', mult = 2.4 },
  { key = 'elite', label = 'Elite',    mult = 5.0 },
}

-- Price per (part, tier), in whichever currency Bridge.RemoveMoney/AddMoney already uses (bank/card,
-- matching the plan doc's "paid by bank/card" decision - cash is not accepted for mining parts).
-- [partKey][tierKey] = price.
Config.Mining.Prices = {
  cpu = { std = 1200, adv = 3500,  elite = 8000  },
  gpu = { std = 2000, adv = 6000,  elite = 14000 },
  ram = { std = 450,  adv = 1100,  elite = 2600  },
  psu = { std = 500,  adv = 1200,  elite = 2800  },
  hdd = { std = 600,  adv = 1500,  elite = 3400  },
}

-- Every part starts at full health; wear/degradation (Phase 2) reduces this over time and rare random
-- failures can drop it further, but never below 0. A part at 0 still occupies its slot - it just
-- contributes nothing until repaired/replaced (repair mechanic TBD, not in Phase 1 or 2).
Config.Mining.StartingWear = 100

-- ---------------------------------------------------------------------------------------------
-- Phase 2: tick / accrual / hash-rate tuning. A tower only mines while ALL 5 slots are filled and
-- it's switched on (the locked spec: all 5 parts required, equal contribution before tier weighting).

Config.Mining.TickSeconds = 60          -- how often every running tower/rig accrues currency
Config.Mining.CoinPerHashPerSecond = 0.00015  -- base payout rate; a part's tier `mult` (above) scales this
Config.Mining.DefaultCoin = 'SDC'       -- which sd-phone crypto symbol a NEW tower defaults to mining
                                        -- (locked spec: "coin TBD" - SDC is sd-phone's own native coin;
                                        -- Phase 3's app lets the owner change this per tower)
Config.Mining.Coins = {                -- sd-phone's own configured crypto symbols (configs/stocks.lua) -
  'SDC', 'BTL', 'ETD', 'SPC', 'MZC', 'FLC', 'WZC', 'POG', 'VWC', 'KIF'  -- not fetched live, so a coin
}                                       -- added there later needs adding here too (Phase 8: the Wallet
                                        -- screen's "every coin's balance" view reads this same list).
Config.Mining.OfflineAccrualCapHours = 12  -- a tower/server restart never pays out for more than this
                                            -- many hours of missed ticks, however long it was actually down

-- Wear lost per tick while running (percentage points, e.g. 0.02 = loses 0.02% per tick - roughly a
-- full CPU-to-corroded-out for an AFK rig left running non-stop for a couple of weeks of ticks).
Config.Mining.WearPerTick = 0.02
-- Chance (0-1) per part per tick of a "rare random failure": an instant, larger wear hit on top of the
-- steady per-tick loss (locked spec: "reduces rate rather than stopping the rig outright" - a failed
-- part keeps mining at its now-lower wear, it just doesn't stop mining altogether).
Config.Mining.FailureChancePerTick = 0.003
Config.Mining.FailureWearLoss = 15

-- ---------------------------------------------------------------------------------------------
-- Phase 5: anti-abuse tuning. See server/mining.lua's Mining.Throttled/Mining.Audit for how these
-- are used - no economy caps here (the locked spec explicitly says "no payout cap"), just guards
-- against a macro/spam-clicker and a plain console audit trail for staff.
Config.Mining.RateLimitSeconds = 0.75   -- minimum gap between one player's mutating mining actions
Config.Mining.AuditLog = true           -- false disables the '^6[as-computer:mining:audit]^0' prints
Config.Mining.Notifications = true      -- false disables the part-failure push notification

--- The ox_inventory item name for a given part+tier, e.g. ('cpu', 'elite') -> 'mining_cpu_elite'.
--- Every caller (the shop, assembly logic, the future Mining Rig app) goes through this instead of
--- building the string itself, so a naming change only ever needs to happen here.
---@param partKey string one of Config.Mining.Parts[].key
---@param tierKey string one of Config.Mining.Tiers[].key
---@return string|nil itemName nil if either key is unrecognised
function Config.Mining.ItemName(partKey, tierKey)
  for _, p in ipairs(Config.Mining.Parts) do
    if p.key == partKey then
      for _, t in ipairs(Config.Mining.Tiers) do
        if t.key == tierKey then return ('mining_%s_%s'):format(partKey, tierKey) end
      end
    end
  end
  return nil
end

--- Price for a given part+tier, or nil if either key is unrecognised.
---@param partKey string
---@param tierKey string
---@return number|nil price
function Config.Mining.PriceOf(partKey, tierKey)
  local row = Config.Mining.Prices[partKey]
  return row and row[tierKey] or nil
end

--- This tier's hash-rate multiplier, or nil if unrecognised.
---@param tierKey string
---@return number|nil mult
function Config.Mining.MultOf(tierKey)
  for _, t in ipairs(Config.Mining.Tiers) do
    if t.key == tierKey then return t.mult end
  end
  return nil
end

--- Every (partKey, itemName) pair, for building a shop menu or validating "does the player have one
--- of each part" - returns e.g. { {key='cpu', items={'mining_cpu_std','mining_cpu_adv','mining_cpu_elite'}}, ... }
---@return table[] parts
function Config.Mining.AllPartItems()
  local out = {}
  for _, p in ipairs(Config.Mining.Parts) do
    local items = {}
    for _, t in ipairs(Config.Mining.Tiers) do
      items[#items + 1] = Config.Mining.ItemName(p.key, t.key)
    end
    out[#out + 1] = { key = p.key, label = p.label, items = items }
  end
  return out
end

-- ---------------------------------------------------------------------------------------------
-- Mining rig props (Phase 4: placement/interaction). Placed by the player themselves from a chassis
-- item (mining_rig_small/medium/large in ox_inventory) via object_gizmo, same tool /placeprops uses -
-- see client/mining_place.lua + server/mining_place.lua. A rig only ever takes GPUs, one per slot
-- (see the plan doc's "Physical setup & rig linking" section) - the 3 locked sizes are Small/Medium/
-- Large = 2/4/6 GPU slots, mapped onto the 5 real prop models below.
Config.Mining.RigSizes = {
  small  = { label = 'Small',  gpuSlots = 2 },
  medium = { label = 'Medium', gpuSlots = 4 },
  large  = { label = 'Large',  gpuSlots = 6 },
}

-- hash is the prop model's joaat as a string (kept as a string since it's how it was supplied -
-- Config.Mining.RigProps[n].hashNum below converts it to a number for GetHashKey-style comparisons).
Config.Mining.RigProps = {
  { label = 'Server 1', hash = '1030147405', itemType = 'miner', propName = 'hei_prop_mini_sever_01', size = 'small'  },
  { label = 'Server 2', hash = '1806543322', itemType = 'miner', propName = 'hei_prop_mini_sever_02', size = 'small'  },
  { label = 'Server 3', hash = '412812214',  itemType = 'miner', propName = 'hei_prop_mini_sever_03', size = 'medium' },
  { label = 'Server 4', hash = '1365277628', itemType = 'miner', propName = 'xm_base_cia_server_01',  size = 'medium' },
  { label = 'Server 5', hash = '3592488263', itemType = 'miner', propName = 'xm_base_cia_server_02',  size = 'large'  },
}

--- A rig prop's config entry by its model hash (string or number, either works) - nil if unrecognised.
---@param hash string|number
---@return table|nil entry one row of Config.Mining.RigProps, with size/gpuSlots resolved
function Config.Mining.RigPropByHash(hash)
  hash = tostring(hash)
  for _, r in ipairs(Config.Mining.RigProps) do
    if r.hash == hash then
      local sz = Config.Mining.RigSizes[r.size]
      return { label = r.label, hash = r.hash, propName = r.propName, size = r.size, gpuSlots = sz and sz.gpuSlots or 0 }
    end
  end
  return nil
end

--- Every Config.Mining.RigProps entry for one size, e.g. ('small') -> the Server 1/2 rows. Used by
--- client/mining_place.lua to offer only the props that match the chassis item the player just used.
---@param size string one of Config.Mining.RigSizes' keys
---@return table[] entries
function Config.Mining.RigPropsBySize(size)
  local out = {}
  for _, r in ipairs(Config.Mining.RigProps) do
    if r.size == size then out[#out + 1] = r end
  end
  return out
end

-- ox_inventory chassis item -> rig size, and back. Kept here (not hardcoded in mining_place.lua) for
-- the same reason as everything else in this file: one source of truth if an item is ever renamed.
Config.Mining.RigChassisItems = {
  small  = 'mining_rig_small',
  medium = 'mining_rig_medium',
  large  = 'mining_rig_large',
}

--- The rig size a chassis item name corresponds to, or nil if it isn't one.
---@param itemName string
---@return string|nil size
function Config.Mining.RigSizeOfItem(itemName)
  for size, item in pairs(Config.Mining.RigChassisItems) do
    if item == itemName then return size end
  end
  return nil
end

-- Tower CASE prop model choices (Phase 4: placement/interaction). Per the plan doc's original "tower +
-- monitor as separate props" decision: the tower is JUST the CPU/GPU/RAM/PSU/HDD box - purely decorative
-- plus its 5 part slots, no screen of its own. Each model is its OWN ox_inventory item (one per row
-- below, item name = 'computer_tower_' .. slug) so the player picks a look by picking an item, not a
-- placement-time menu. `slug` must stay stable once players own one of these items.
Config.Mining.TowerProps = {
  { label = 'Desktop PC (dynamic)',       model = 'prop_dyn_pc',               slug = 'dyn'   },
  { label = 'Résidence PC Tower',         model = 'v_res_pctower',             slug = 'res'   },
  { label = 'X17 Résidence PC Tower',     model = 'xm_prop_x17_res_pctower',   slug = 'x17'   },
  { label = 'Desktop PC (A)',             model = 'prop_pc_02a',               slug = 'pca'   },
  { label = 'Apartment PC Tower',         model = 'm23_2_int4_m232_pc',        slug = 'apt'   },
  { label = 'Heist PC',                   model = 'hei_prop_heist_pc_01',      slug = 'heist' },
  { label = 'Desktop PC (B)',             model = 'prop_pc_01a',               slug = 'pcb'   },
}

--- A tower case's config entry by its model name - nil if unrecognised. Case-insensitive, same
--- reasoning as every other ByModel/ByHash lookup in this file.
---@param model string
---@return table|nil entry one row of Config.Mining.TowerProps
function Config.Mining.TowerPropByModel(model)
  model = tostring(model or ''):lower()
  for _, t in ipairs(Config.Mining.TowerProps) do
    if t.model:lower() == model then return t end
  end
  return nil
end

--- The ox_inventory item name for a tower case model, e.g. 'prop_dyn_pc' -> 'computer_tower_dyn'.
---@param model string
---@return string|nil itemName
function Config.Mining.TowerItemName(model)
  local t = Config.Mining.TowerPropByModel(model)
  return t and ('computer_tower_' .. t.slug) or nil
end

--- The Config.Mining.TowerProps row for a 'computer_tower_<slug>' item name, or nil if it isn't one.
---@param itemName string
---@return table|nil entry
function Config.Mining.TowerPropByItem(itemName)
  itemName = tostring(itemName or '')
  for _, t in ipairs(Config.Mining.TowerProps) do
    if itemName == 'computer_tower_' .. t.slug then return t end
  end
  return nil
end

-- ---------------------------------------------------------------------------------------------
-- The MONITOR is its own separate placeable item/prop (the plan doc's "tower + monitor as separate
-- props" decision) and is the thing that actually carries the login screen/Los Santos OS session -
-- the tower case above only holds parts. Reuses the SAME model + already-tuned screen rect as the
-- existing "Vinewood Auto Centre — MOT Bay" terminal in config/config.lua's Config.Locations, so there
-- is no unknown txd/txn to guess here (unlike the tower cases, nobody needs to open OpenIV for this one).
Config.Mining.MonitorProp = {
  model = 'lgmods_sinner_monitor',
  txd = { 'lgmods_sinner_monitor', 'lgmods_sinnertextures' },
  txn = 'securitymonitor',
  screen = {
    offset = vector3(0.0, -0.07, 0.396), size = vector2(0.79, 0.483), bleed = 0.02, front = -1,
    cam = { dist = 0.85, fov = 35.0 },
  },
  target = { size = vector3(1.3, 1.3, 1.0), offset = vector3(0.0, -0.02, 0.33) },
}
Config.Mining.MonitorItem = 'computer_monitor'

-- How close a tower case must be placed to an existing monitor to link to it (and how close the player
-- must stand to re-link/unlink later). Kept generous since a desk setup is rarely millimetre-precise.
Config.Mining.TowerLinkRange = 8.0

-- Chassis prices (starting numbers, tune freely - same status as Config.Mining.Prices above). Sold
-- from the same shop as parts. [itemName] = price, paid the same way as parts (bank/card).
Config.Mining.ChassisPrices = {
  computer_monitor      = 800,
  computer_tower_dyn    = 1500,
  computer_tower_res    = 1500,
  computer_tower_x17    = 1500,
  computer_tower_pca    = 1500,
  computer_tower_apt    = 1500,
  computer_tower_heist  = 1500,
  computer_tower_pcb    = 1500,
  mining_rig_small      = 4000,
  mining_rig_medium     = 9000,
  mining_rig_large      = 18000,
}

-- ---------------------------------------------------------------------------------------------
-- The physical parts shop (locked spec: "one new dedicated physical shop, ped + blip", bank/card only).
-- Placeholder location (Los Santos Customs-adjacent industrial spot) - move freely, it's just data.
Config.Mining.Shop = {
  ped = 'a_m_m_indian_01',
  coords = vector4(732.9, -972.0, 30.4, 250.0),
  blip = { sprite = 500, color = 2, scale = 0.8, label = 'Mining Parts Shop' },
  interactDistance = 2.5,
}
