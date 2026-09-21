Locales = Locales or {}

function L(key, ...)
  local lang = Locales[Config.Locale or 'en'] or {}
  local str = lang[key] or (Locales.en and Locales.en[key]) or key
  if select('#', ...) > 0 then return str:format(...) end
  return str
end

-- Full string table (active language over English) — sent to the UI.
function LocaleTable(lang)
  local out = {}
  for k, v in pairs(Locales.en or {}) do out[k] = v end
  for k, v in pairs(Locales[lang or Config.Locale or 'en'] or {}) do out[k] = v end
  return out
end
