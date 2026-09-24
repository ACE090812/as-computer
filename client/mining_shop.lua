-- The Mining Rig parts/chassis shop (Phase 4 locked spec: "one new dedicated physical shop, ped +
-- blip"). One ped, one blip, one ox_target option opening a menu of everything server/mining.lua's
-- 'mining:buyPart' and server/mining_place.lua's 'miningPlace:buyChassis' can sell - no new purchase
-- logic here, this file is just the in-world front door to those two callbacks.

local SHOP = Config.Mining.Shop or {}
local ped

local function moneyStr(n) return ('$%d'):format(n) end

local function partsMenu()
  local options = {}
  for _, p in ipairs(Config.Mining.Parts) do
    options[#options + 1] = {
      title = p.label, description = p.productName, icon = 'microchip', arrow = true,
      onSelect = function()
        local tierOpts = {}
        for _, t in ipairs(Config.Mining.Tiers) do
          local price = Config.Mining.PriceOf(p.key, t.key)
          tierOpts[#tierOpts + 1] = {
            title = ('%s - %s'):format(t.label, moneyStr(price or 0)), icon = 'cart-shopping',
            onSelect = function()
              MotCallback.Trigger('mining:buyPart', function(r)
                if r and r.success then Bridge.Notify(L('shop_bought', p.label), 'success')
                else Bridge.Notify(L('shop_buy_failed'), 'error') end
              end, p.key, t.key)
            end,
          }
        end
        lib.registerContext({ id = 'asc_shop_part', title = p.label, menu = 'asc_shop', options = tierOpts })
        lib.showContext('asc_shop_part')
      end,
    }
  end
  lib.registerContext({ id = 'asc_shop_parts', title = L('shop_parts'), menu = 'asc_shop', options = options })
  lib.showContext('asc_shop_parts')
end

local function buyChassis(itemName, label)
  MotCallback.Trigger('miningPlace:buyChassis', function(r)
    if r and r.success then Bridge.Notify(L('shop_bought', label), 'success')
    else Bridge.Notify(L('shop_buy_failed'), 'error') end
  end, itemName)
end

local function chassisMenu()
  local options = {
    { title = 'Computer Monitor', description = moneyStr(Config.Mining.ChassisPrices.computer_monitor), icon = 'display',
      onSelect = function() buyChassis('computer_monitor', 'Computer Monitor') end },
  }
  for _, t in ipairs(Config.Mining.TowerProps) do
    local item = 'computer_tower_' .. t.slug
    options[#options + 1] = { title = t.label, description = moneyStr(Config.Mining.ChassisPrices[item] or 0), icon = 'computer',
      onSelect = function() buyChassis(item, t.label) end }
  end
  lib.registerContext({ id = 'asc_shop_towers', title = L('shop_towers'), menu = 'asc_shop', options = options })
  lib.showContext('asc_shop_towers')
end

local function rigsMenu()
  local options = {}
  for size, item in pairs(Config.Mining.RigChassisItems) do
    local sizeCfg = Config.Mining.RigSizes[size]
    options[#options + 1] = {
      title = (sizeCfg and sizeCfg.label or size) .. (' (%d GPU)'):format(sizeCfg and sizeCfg.gpuSlots or 0),
      description = moneyStr(Config.Mining.ChassisPrices[item] or 0), icon = 'server',
      onSelect = function() buyChassis(item, sizeCfg and sizeCfg.label or size) end,
    }
  end
  lib.registerContext({ id = 'asc_shop_rigs', title = L('shop_rigs'), menu = 'asc_shop', options = options })
  lib.showContext('asc_shop_rigs')
end

local function openShop()
  lib.registerContext({
    id = 'asc_shop', title = L('shop_title'),
    options = {
      { title = L('shop_parts'), description = L('shop_parts_desc'), icon = 'microchip', menu = 'asc_shop_parts', onSelect = partsMenu },
      { title = L('shop_towers'), description = L('shop_towers_desc'), icon = 'computer', menu = 'asc_shop_towers', onSelect = chassisMenu },
      { title = L('shop_rigs'), description = L('shop_rigs_desc'), icon = 'server', menu = 'asc_shop_rigs', onSelect = rigsMenu },
    },
  })
  lib.showContext('asc_shop')
end

CreateThread(function()
  if not SHOP.ped or not SHOP.coords then return end
  local model = SHOP.ped
  RequestModel(model)
  local timeout = GetGameTimer() + 10000
  while not HasModelLoaded(model) and GetGameTimer() < timeout do Wait(50) end
  if not HasModelLoaded(model) then
    print(('^1[as-computer] mining shop ped model %s failed to load^0'):format(tostring(model)))
    return
  end

  ped = CreatePed(4, model, SHOP.coords.x, SHOP.coords.y, SHOP.coords.z - 1.0, SHOP.coords.w, false, true)
  SetEntityInvincible(ped, true)
  FreezeEntityPosition(ped, true)
  SetBlockingOfNonTemporaryEvents(ped, true)
  TaskStartScenarioInPlace(ped, 'WORLD_HUMAN_STAND_IMPATIENT', 0, true)
  SetModelAsNoLongerNeeded(model)

  if SHOP.blip then
    local blip = AddBlipForCoord(SHOP.coords.x, SHOP.coords.y, SHOP.coords.z)
    SetBlipSprite(blip, SHOP.blip.sprite or 500)
    SetBlipColour(blip, SHOP.blip.color or 2)
    SetBlipScale(blip, SHOP.blip.scale or 0.8)
    SetBlipAsShortRange(blip, true)
    BeginTextCommandSetBlipName('STRING')
    AddTextComponentSubstringPlayerName(SHOP.blip.label or 'Mining Parts Shop')
    EndTextCommandSetBlipName(blip)
  end

  if GetResourceState('ox_target') == 'started' then
    exports.ox_target:addLocalEntity(ped, {
      { name = 'as_mining_shop', label = L('shop_target'), icon = 'fa-solid fa-microchip', distance = SHOP.interactDistance or 2.5, onSelect = openShop },
    })
  else
    print('^1[as-computer] ox_target not started - mining shop cannot be targeted^0')
  end
end)

AddEventHandler('onResourceStop', function(res)
  if res ~= GetCurrentResourceName() then return end
  if ped and DoesEntityExist(ped) then DeleteEntity(ped) end
end)
