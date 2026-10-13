// Built-in symbol/code → ISO currency mappings. These ship with the extension so new ones reach
// existing installs on update; settings only store the user's additions, overrides and hidden built-ins.
const BUILTIN_MAPPINGS = {
  '¥': 'CNY',
  'RMB': 'CNY',
  '$': 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '₩': 'KRW',
  '￦': 'KRW',
  '원': 'KRW'
};

// The built-ins 1.0 copied into settings on install (used to migrate those settings).
const LEGACY_BUILTIN_SYMBOLS = ['¥', 'RMB', '$', '£', '€'];

const DEFAULT_TARGET_CURRENCY = 'GBP';

function getEffectiveMappings(userMappings, hiddenMappings) {
  const hidden = hiddenMappings || [];
  const mappings = {};
  for (const [symbol, code] of Object.entries(BUILTIN_MAPPINGS)) {
    if (!hidden.includes(symbol)) mappings[symbol] = code;
  }
  return Object.assign(mappings, userMappings || {});
}
