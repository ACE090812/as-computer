-- Computer hardware (Los Santos OS). Every computer is a monitor plus a tower; the tower holds the parts below and
-- the computer only boots when the required ones are fitted. It reuses the existing part items and prices in
-- config/mining.lua (mining_cpu_std ...), and adds network cards. Tiers come from Config.Mining.Tiers (std, adv, elite).
-- Crypto mining no longer uses the tower: it runs on separate mining rigs (GPUs only) and does not slow the desktop.
--
-- Item names (add each to ox_inventory data/items.lua, the same way as the mining parts):
--   mining_wifi_std / _adv / _elite     Wi-Fi card
--   mining_eth_std  / _adv / _elite     Ethernet card

Config.Hardware = {}
local H = Config.Hardware

-- Switch the whole hardware rule off (every computer boots without parts). Meant for testing only.
H.Enforce = true

-- The tower's slots in the order the tower menu shows them. `slot` is the stored name, `part` (or `parts`) the kind of
-- part that fits. `required` slots must be filled to boot. ram2/hdd2 are extra sticks and drives, gpu and nic are optional.
H.Slots = {
  { slot = 'cpu',  part = 'cpu',            label = 'CPU',              required = true },
  { slot = 'ram',  part = 'ram',            label = 'RAM 1',            required = true },
  { slot = 'ram2', part = 'ram',            label = 'RAM 2' },
  { slot = 'psu',  part = 'psu',            label = 'PSU',              required = true },
  { slot = 'hdd',  part = 'hdd',            label = 'HDD/SSD 1',        required = true },
  { slot = 'hdd2', part = 'hdd',            label = 'HDD/SSD 2' },
  { slot = 'gpu',  part = 'gpu',            label = 'GPU' },
  { slot = 'nic',  parts = { 'wifi', 'eth' }, label = 'Network card' },
}

-- Performance of one part by tier, before wear. Used for boot speed and (later) app limits.
H.Perf = { std = 1.0, adv = 1.6, elite = 2.4 }

-- A part at 0% condition still works but runs at this share of its normal performance (it slows down as it wears).
H.WornPerfFloor = 0.4

-- Memory per RAM stick and storage per drive, by tier, in MB. Task Manager and the file system read these.
H.RamMB     = { std = 2048, adv = 4096, elite = 8192 }
H.StorageMB = { std = 4096, adv = 16384, elite = 65536 }

-- Ordinary use wears every fitted part while the computer is on: this many hours of use to go from 100% to 0%.
H.WearHours = 100

-- Network cards: Wi-Fi reaches the network from anywhere, Ethernet is faster and steadier. `speed` is used for downloads.
H.Network = {
  wifi = { label = 'Wi-Fi',    speed = 1.0 },
  eth  = { label = 'Ethernet', speed = 1.5 },
}

-- Boot: seconds at the start, before the CPU and startup apps change it (the boot screen reads this later).
H.Boot = { baseSeconds = 14, minSeconds = 5, perStartupApp = 1.5 }

-- On the very first start with the hardware rule, wipe every computer's accounts and files once so all machines
-- start clean. The wipe runs once (it records itself in computer_hardware_meta) and prints what it removed.
H.WipeOnFirstStart = true

-- Network cards and their prices join the existing part list, so the Mining parts shop and /buypart sell them too.
table.insert(Config.Mining.Parts, { key = 'wifi', label = 'Wi-Fi card',      productName = 'AirLink' })
table.insert(Config.Mining.Parts, { key = 'eth',  label = 'Ethernet card',   productName = 'WireRun' })
Config.Mining.Prices.wifi = { std = 300, adv = 700, elite = 1500 }
Config.Mining.Prices.eth  = { std = 250, adv = 600, elite = 1300 }

--- Slot keys in order, e.g. { 'cpu', 'ram', 'ram2', ... }.
function H.SlotKeys()
  local out = {}
  for _, s in ipairs(H.Slots) do out[#out + 1] = s.slot end
  return out
end

--- The slot definition for a stored slot name, or nil.
function H.SlotDef(slot)
  for _, s in ipairs(H.Slots) do if s.slot == slot then return s end end
  return nil
end

--- Does this slot accept that kind of part ('cpu', 'wifi' ...)?
function H.SlotAccepts(slot, partKey)
  local d = H.SlotDef(slot)
  if not d then return false end
  if d.part then return d.part == partKey end
  for _, p in ipairs(d.parts or {}) do if p == partKey then return true end end
  return false
end

--- The only kind of part a slot takes, or the first when it takes several (the Wi-Fi card for the network slot).
function H.DefaultPart(slot)
  local d = H.SlotDef(slot)
  if not d then return nil end
  return d.part or (d.parts and d.parts[1])
end
