Locales = Locales or {}
LocaleExtras = LocaleExtras or {}

--- Lets a separate file add strings to a language without touching locales/<code>.lua
--- (used by the Mechanic app: locales/mechanic_en.lua). They never show up as an extra language.
function LocaleExtra(lang, strings)
  LocaleExtras[lang] = LocaleExtras[lang] or {}
  for k, v in pairs(strings) do LocaleExtras[lang][k] = v end
end

function L(key, ...)
  local code = Config.Locale or 'en'
  local str = (Locales[code] and Locales[code][key]) or (LocaleExtras[code] and LocaleExtras[code][key])
    or (Locales.en and Locales.en[key]) or (LocaleExtras.en and LocaleExtras.en[key]) or key
  if select('#', ...) > 0 then return str:format(...) end
  return str
end

-- Full string table (active language over English) — sent to the UI.
function LocaleTable(lang)
  local out = {}
  for _, t in ipairs({ LocaleExtras.en or {}, Locales.en or {} }) do
    for k, v in pairs(t) do out[k] = v end
  end
  lang = lang or Config.Locale or 'en'
  for _, t in ipairs({ LocaleExtras[lang] or {}, Locales[lang] or {} }) do
    for k, v in pairs(t) do out[k] = v end
  end
  return out
end
