const API_URL = 'https://api.frankfurter.app/latest';

async function fetchRates() {
  try {
    const response = await fetch(API_URL);
    const data = await response.json();
    if (data && data.rates) {
      // Add EUR to the rates since it's the base for Frankfurter
      data.rates.EUR = 1.0;
      await chrome.storage.local.set({
        exchangeRates: data.rates,
        lastFetch: Date.now()
      });
      console.log('Exchange rates updated successfully.');
    }
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Set default settings
    await chrome.storage.sync.set({
      targetCurrency: 'GBP',
      symbolMappings: {
        '¥': 'CNY',
        'RMB': 'CNY',
        '$': 'USD',
        '£': 'GBP',
        '€': 'EUR',
        '₩': 'KRW',
        '￦': 'KRW',
        '원': 'KRW'
      },
      textCodes: ['CNY', 'USD', 'EUR', 'GBP', 'RMB', 'KRW']
    });
  }
  // Initial fetch
  fetchRates();
});

// Alarm to fetch rates every 4 hours
chrome.alarms.create('fetchRates', { periodInMinutes: 240 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetchRates') {
    fetchRates();
  }
});
