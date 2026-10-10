let userMappings = {};
let hiddenMappings = [];
let currentDomainRules = [];
let availableRates = {};

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);
document.getElementById('addMappingBtn').addEventListener('click', addMapping);
document.getElementById('addDomainBtn').addEventListener('click', addDomainRule);
document.getElementById('restoreBuiltinsBtn').addEventListener('click', function () {
  hiddenMappings = [];
  renderMappings();
});

function restoreOptions() {
  chrome.storage.sync.get(['targetCurrency', 'userMappings', 'hiddenMappings', 'domainRules'], (items) => {
    chrome.storage.local.get(['exchangeRates'], (localItems) => {
      availableRates = localItems.exchangeRates || {};
      populateCurrencyOptions(items.targetCurrency || DEFAULT_TARGET_CURRENCY);
      userMappings = items.userMappings || {};
      hiddenMappings = items.hiddenMappings || [];
      currentDomainRules = items.domainRules || [];
      renderMappings();
      renderDomainRules();
    });
  });
}

// Offer every currency the rates feed covers; the static list in the HTML is the fallback
function populateCurrencyOptions(selected) {
  const select = document.getElementById('targetCurrency');
  const codes = Object.keys(availableRates).sort();

  if (codes.length) {
    const names = new Intl.DisplayNames(undefined, { type: 'currency' });
    select.textContent = '';
    for (const code of codes) {
      let name = code;
      try {
        name = names.of(code);
      } catch (e) {
        // Not a code Intl knows; show the code alone
      }
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name === code ? code : `${code} - ${name}`;
      select.appendChild(option);
    }
  }

  // Keep the saved choice selectable even if the feed no longer has it
  if (![...select.options].some(option => option.value === selected)) {
    const option = document.createElement('option');
    option.value = selected;
    option.textContent = selected;
    select.appendChild(option);
  }
  select.value = selected;
}

function renderMappings() {
  const list = document.getElementById('mappingList');
  list.textContent = ''; // Safer than innerHTML = ''

  for (const [symbol, code] of Object.entries(getEffectiveMappings(userMappings, hiddenMappings))) {
    const div = document.createElement('div');
    div.className = 'mapping-item';

    // Create the text container
    const span = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = symbol;
    span.appendChild(b);
    span.append(` → ${code} `);

    if (!(symbol in userMappings)) {
      const tag = document.createElement('span');
      tag.className = 'builtin-tag';
      tag.textContent = 'built-in';
      span.appendChild(tag);
    }

    // Create the button
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.setAttribute('data-symbol', symbol);
    btn.addEventListener('click', function () {
      // Removing an override also hides the built-in underneath it
      delete userMappings[symbol];
      if (symbol in BUILTIN_MAPPINGS && !hiddenMappings.includes(symbol)) {
        hiddenMappings.push(symbol);
      }
      renderMappings();
    });

    div.appendChild(span);
    div.appendChild(btn);
    list.appendChild(div);
  }

  document.getElementById('restoreBuiltinsBtn').hidden = hiddenMappings.length === 0;
}

function renderDomainRules() {
  const list = document.getElementById('domainList');
  list.textContent = '';

  currentDomainRules.forEach((rule, index) => {
    const div = document.createElement('div');
    div.className = 'mapping-item';

    const span = document.createElement('span');
    span.textContent = '[';
    const bDomain = document.createElement('b');
    bDomain.textContent = rule.domain;
    span.appendChild(bDomain);
    span.append('] ');

    const bSymbol = document.createElement('b');
    bSymbol.textContent = rule.symbol;
    span.appendChild(bSymbol);
    span.append(` → ${rule.code}`);

    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.setAttribute('data-index', index);
    btn.addEventListener('click', function () {
      currentDomainRules.splice(index, 1);
      renderDomainRules();
    });

    div.appendChild(span);
    div.appendChild(btn);
    list.appendChild(div);
  });
}

// Returns an error message, or '' if the code can be converted
function validateCode(code) {
  if (!/^[A-Z]{3}$/.test(code)) return 'Currency code must be 3 letters (e.g. HKD).';
  if (Object.keys(availableRates).length && !availableRates[code]) {
    return `No exchange rate is available for ${code}, so it can't be converted.`;
  }
  return '';
}

function addMapping() {
  const sym = document.getElementById('newSymbol').value.trim();
  const code = document.getElementById('newCode').value.trim().toUpperCase();
  if (sym && code) {
    const error = validateCode(code);
    if (error) {
      showStatus(error, true);
      return;
    }
    userMappings[sym] = code;
    hiddenMappings = hiddenMappings.filter(s => s !== sym);
    document.getElementById('newSymbol').value = '';
    document.getElementById('newCode').value = '';
    renderMappings();
  }
}

function addDomainRule() {
  const domain = document.getElementById('newDomain').value.trim();
  const sym = document.getElementById('newDomainSymbol').value.trim();
  const code = document.getElementById('newDomainCode').value.trim().toUpperCase();

  if (domain && sym && code) {
    const error = validateCode(code);
    if (error) {
      showStatus(error, true);
      return;
    }
    currentDomainRules.push({ domain, symbol: sym, code });
    document.getElementById('newDomain').value = '';
    document.getElementById('newDomainSymbol').value = '';
    document.getElementById('newDomainCode').value = '';
    renderDomainRules();
  }
}

function showStatus(message, isError) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.classList.toggle('error', !!isError);
  setTimeout(() => {
    status.textContent = '';
  }, isError ? 4000 : 2000);
}

function saveOptions() {
  chrome.storage.sync.set({
    targetCurrency: document.getElementById('targetCurrency').value,
    userMappings: userMappings,
    hiddenMappings: hiddenMappings,
    domainRules: currentDomainRules
  }, () => {
    showStatus('Settings saved successfully!');
  });
}
