const defaultMappings = {
  '¥': 'CNY',
  'RMB': 'CNY',
  '$': 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '₩': 'KRW',
  '￦': 'KRW',
  '원': 'KRW'
};

let currentMappings = {};
let currentDomainRules = [];

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);
document.getElementById('addMappingBtn').addEventListener('click', addMapping);
document.getElementById('addDomainBtn').addEventListener('click', addDomainRule);

function restoreOptions() {
  chrome.storage.sync.get(['targetCurrency', 'symbolMappings', 'domainRules'], (items) => {
    document.getElementById('targetCurrency').value = items.targetCurrency || 'GBP';
    currentMappings = items.symbolMappings || defaultMappings;
    currentDomainRules = items.domainRules || [];
    renderMappings();
    renderDomainRules();
  });
}

function renderMappings() {
  const list = document.getElementById('mappingList');
  list.textContent = ''; // Safer than innerHTML = ''

  for (const [symbol, code] of Object.entries(currentMappings)) {
    const div = document.createElement('div');
    div.className = 'mapping-item';

    // Create the text container
    const span = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = symbol;
    span.appendChild(b);
    span.append(` → ${code} `);

    // Create the button
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.setAttribute('data-symbol', symbol);
    btn.addEventListener('click', function () {
      delete currentMappings[symbol];
      renderMappings();
    });

    div.appendChild(span);
    div.appendChild(btn);
    list.appendChild(div);
  }
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

function addMapping() {
  const sym = document.getElementById('newSymbol').value.trim();
  const code = document.getElementById('newCode').value.trim().toUpperCase();
  if (sym && code) {
    currentMappings[sym] = code;
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
    currentDomainRules.push({ domain, symbol: sym, code });
    document.getElementById('newDomain').value = '';
    document.getElementById('newDomainSymbol').value = '';
    document.getElementById('newDomainCode').value = '';
    renderDomainRules();
  }
}

function saveOptions() {
  const targetCurrency = document.getElementById('targetCurrency').value;
  const codesSet = new Set(['CNY', 'USD', 'EUR', 'GBP', 'KRW']);

  for (const val of Object.values(currentMappings)) {
    codesSet.add(val);
  }
  for (const rule of currentDomainRules) {
    codesSet.add(rule.code);
  }

  chrome.storage.sync.set({
    targetCurrency: targetCurrency,
    symbolMappings: currentMappings,
    domainRules: currentDomainRules,
    textCodes: Array.from(codesSet)
  }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Settings saved successfully!';
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
  });
}
