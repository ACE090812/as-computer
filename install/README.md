# Install: inventory items

Every item as-computer uses. Paste the file for your inventory into its item list, add images named `<item>.png`, then restart the inventory.

- `ox_inventory_items.lua` -> ox_inventory/data/items.lua
- `qb_inventory_items.lua` -> qb-core/shared/items.lua (qb-inventory, ps-inventory, lj-inventory)
- `sql/install.sql` is the database setup.

Whenever a feature adds an item, it is added to both files. Towers, monitors and rigs are placed by using the item; parts are fitted at the tower.
