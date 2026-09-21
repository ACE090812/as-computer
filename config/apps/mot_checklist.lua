-- MOT Testing Service app: the checklist.
-- Single source of truth for what's being inspected. Add/remove items here —
-- both the checklist screen and server-side validation read from this.

Config.Checklist = {
  {
    section = 'Brakes and suspension',
    items = {
      { id = 'brakes',     label = 'Braking performance and efficiency' },
      { id = 'suspension', label = 'Suspension and steering' },
    },
  },
  {
    section = 'Tyres and wheels',
    items = {
      { id = 'tyres',  label = 'Tyre tread depth and condition' },
      { id = 'wheels', label = 'Wheel condition and security' },
    },
  },
  {
    section = 'Lights, visibility and electrical',
    items = {
      { id = 'lights',     label = 'Headlights and indicators' },
      { id = 'windscreen', label = 'Windscreen and wipers' },
      { id = 'mirrors',    label = 'Mirrors' },
      { id = 'horn',       label = 'Horn' },
    },
  },
  {
    section = 'Body, structure and identification',
    items = {
      { id = 'seatbelts', label = 'Seatbelts' },
      { id = 'exhaust',   label = 'Exhaust and emissions' },
      { id = 'bodywork',  label = 'Bodywork and structural condition' },
      { id = 'plate',     label = 'Registration plate legibility' },
      { id = 'vin',       label = 'VIN / chassis verification' },
    },
  },
}

-- Flat lookup of item id -> { section, label }, built once at load, used by
-- the server to turn submitted ids back into readable text for certificates.
Config.ChecklistById = {}
for _, section in ipairs(Config.Checklist) do
  for _, item in ipairs(section.items) do
    Config.ChecklistById[item.id] = { section = section.section, label = item.label }
  end
end
