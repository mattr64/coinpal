const API_URL = 'https://api.frankfurter.dev/v2/rates?base=EUR';
const REFRESH_MINUTES = 240;

async function fetchRates() {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) throw new Error('Unexpected response format');

    // v2 returns one entry per currency; flatten to { CODE: rate } against the EUR base
    const rates = { EUR: 1.0 };
    for (const entry of data) {
      if (entry && typeof entry.quote === 'string' && typeof entry.rate === 'number') {
        rates[entry.quote] = entry.rate;
      }
    }
    await chrome.storage.local.set({
      exchangeRates: rates,
      lastFetch: Date.now()
    });
    console.log('Exchange rates updated successfully.');
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);
  }
}

async function fetchRatesIfStale() {
  const { lastFetch } = await chrome.storage.local.get('lastFetch');
  if (!lastFetch || Date.now() - lastFetch > REFRESH_MINUTES * 60 * 1000) {
    await fetchRates();
  }
}

// 1.0 stored a full copy of the built-in mappings; keep only what the user changed
async function migrateLegacySettings() {
  const { symbolMappings } = await chrome.storage.sync.get('symbolMappings');
  if (!symbolMappings) return;

  const userMappings = {};
  for (const [symbol, code] of Object.entries(symbolMappings)) {
    if (BUILTIN_MAPPINGS[symbol] !== code) userMappings[symbol] = code;
  }
  const hiddenMappings = LEGACY_BUILTIN_SYMBOLS.filter(symbol => !(symbol in symbolMappings));

  await chrome.storage.sync.set({ userMappings, hiddenMappings });
  await chrome.storage.sync.remove(['symbolMappings', 'textCodes']);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Settings may already exist via Firefox Sync from another device
    const { targetCurrency } = await chrome.storage.sync.get('targetCurrency');
    if (!targetCurrency) {
      await chrome.storage.sync.set({ targetCurrency: DEFAULT_TARGET_CURRENCY });
    }
  } else if (details.reason === 'update') {
    await migrateLegacySettings();
  }
  fetchRates();
});

chrome.runtime.onStartup.addListener(fetchRatesIfStale);

// Re-creating an existing alarm restarts its countdown, so only create it when missing
chrome.alarms.get('fetchRates').then((alarm) => {
  if (!alarm) chrome.alarms.create('fetchRates', { periodInMinutes: REFRESH_MINUTES });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetchRates') {
    fetchRates();
  }
});
