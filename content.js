let settings = {};
let rates = {};

async function init() {
  const syncData = await chrome.storage.sync.get(['targetCurrency', 'symbolMappings', 'textCodes', 'domainRules']);
  const localData = await chrome.storage.local.get(['exchangeRates']);

  settings = syncData;
  settings.domainRules = settings.domainRules || [];
  rates = localData.exchangeRates || {};

  if (!settings.targetCurrency || !rates.EUR || !settings.symbolMappings) {
    console.warn('Coiner: Missing settings or exchange rates. Extension might not be initialized yet.');
    return;
  }

  // Apply domain-specific overrides
  applyDomainOverrides();

  scanDOM(document.body);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          scanDOM(node);
        } else if (node.nodeType === Node.TEXT_NODE) {
          processTextNode(node);
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setupGlobalTooltip();
}

function setupGlobalTooltip() {
  let tooltip = document.getElementById('coinpal-global-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'coinpal-global-tooltip';
    document.body.appendChild(tooltip);
  }

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('.coinpal-tooltip');
    if (target) {
      const converted = target.getAttribute('data-converted');
      if (converted) {
        tooltip.textContent = converted;
        const rect = target.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${rect.top}px`;
        tooltip.classList.add('visible');
      }
    }
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('.coinpal-tooltip');
    if (target) {
      tooltip.classList.remove('visible');
    }
  });

  document.addEventListener('scroll', () => {
    tooltip.classList.remove('visible');
  }, { capture: true, passive: true });
}

function processTextNode(node) {
  // Ignore special elements
  const parent = node.parentElement;
  if (!parent) return;
  const tag = parent.tagName.toLowerCase();
  if (['script', 'style', 'noscript', 'textarea', 'code', 'input', 'select', 'option'].includes(tag)) return;
  if (parent.classList && parent.classList.contains('coinpal-tooltip')) return;

  const text = node.nodeValue;
  if (!text || !text.trim()) return;

  // Build dynamic regex string from settings
  const symbols = Object.keys(settings.symbolMappings).map(s => escapeRegExp(s));
  const codes = settings.textCodes ? settings.textCodes.map(c => escapeRegExp(c)) : [];
  const indicators = [...symbols, ...codes].join('|');

  if (!indicators) return;

  // Supports formats like: ¥1,000.00 | 1000 RMB | $ 10.50 | 1.000,00 €
  // Group 1: Prefix indicator
  // Group 2: Amount
  // Group 3: Suffix indicator
  const regexStr = `(?<![a-zA-Z0-9])(?:(${indicators})\\s*)?(\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d{1,3})?|\\d+(?:[.,]\\d{1,3})?)(?:\\s*(${indicators}))?(?![a-zA-Z0-9])`;
  const regex = new RegExp(regexStr, 'gi');
  // 'g' for exact global, 'i' to match codes case insensitively

  let match;
  let matches = [];
  while ((match = regex.exec(text)) !== null) {
    matches.push(match); // Push all matches, including raw numbers. We verify indicator presences next.
  }

  if (matches.length > 0) {
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let replacedAnything = false;

    matches.forEach(m => {
      // With lookbehinds (?<!...) and lookaheads (?!...), the m[0] string is EXACTLY the currency string! No space padding!
      const fullMatchStr = m[0];
      const matchIndex = m.index;
      const prefix = m[1];
      const amountStr = m[2];
      const suffix = m[3];

      let indicator = prefix || suffix;

      // If the number was found without a symbol in this specific text node, check adjacent nodes
      if (!indicator) {
        let pNode = node.previousSibling;
        while (pNode && pNode.nodeType === Node.TEXT_NODE && !pNode.nodeValue.trim()) pNode = pNode.previousSibling;
        let pText = pNode ? pNode.textContent.trim() : '';

        let nNode = node.nextSibling;
        while (nNode && nNode.nodeType === Node.TEXT_NODE && !nNode.nodeValue.trim()) nNode = nNode.nextSibling;
        let nText = nNode ? nNode.textContent.trim() : '';

        if (!pText && node.parentElement) {
          let ppNode = node.parentElement.previousSibling;
          while (ppNode && ppNode.nodeType === Node.TEXT_NODE && !ppNode.nodeValue.trim()) ppNode = ppNode.previousSibling;
          if (ppNode) pText = ppNode.textContent.trim();
        }

        if (!nText && node.parentElement) {
          let nnNode = node.parentElement.nextSibling;
          while (nnNode && nnNode.nodeType === Node.TEXT_NODE && !nnNode.nodeValue.trim()) nnNode = nnNode.nextSibling;
          if (nnNode) nText = nnNode.textContent.trim();
        }

        const pMatch = pText.match(new RegExp(`(?:^|\\s)(${indicators})$`, 'i'));
        if (pMatch) {
          indicator = pMatch[1];
        } else {
          const nMatch = nText.match(new RegExp(`^(${indicators})(?:\\s|$)`, 'i'));
          if (nMatch) indicator = nMatch[1];
        }
      }

      if (!indicator) return; // Skip if it's just a raw number with no adjacent symbols

      let normalizedAmount = amountStr;

      if (normalizedAmount.includes(',') && normalizedAmount.includes('.')) {
        const lastComma = normalizedAmount.lastIndexOf(',');
        const lastDot = normalizedAmount.lastIndexOf('.');
        if (lastComma > lastDot) {
          normalizedAmount = normalizedAmount.replace(/\./g, '').replace(',', '.');
        } else {
          normalizedAmount = normalizedAmount.replace(/,/g, '');
        }
      } else if (normalizedAmount.includes(',')) {
        if (normalizedAmount.match(/,\d{2}$/)) {
          normalizedAmount = normalizedAmount.replace(',', '.');
        } else {
          normalizedAmount = normalizedAmount.replace(/,/g, '');
        }
      }

      const amount = parseFloat(normalizedAmount);
      if (isNaN(amount)) return;

      const baseCurrencyCode = getBaseCurrency(indicator);

      let convertedValueStr = '';
      if (baseCurrencyCode && rates[baseCurrencyCode] && rates[settings.targetCurrency]) {
        if (baseCurrencyCode !== settings.targetCurrency) {
          const valInEur = amount / rates[baseCurrencyCode];
          const finalVal = valInEur * rates[settings.targetCurrency];
          convertedValueStr = `${finalVal.toFixed(2)} ${settings.targetCurrency} (from ${baseCurrencyCode})`;
        }
      }

      if (convertedValueStr) {
        if (matchIndex > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchIndex)));
        }

        const span = document.createElement('span');
        span.className = 'coinpal-tooltip';
        span.setAttribute('data-converted', convertedValueStr);
        span.textContent = fullMatchStr;
        fragment.appendChild(span);

        lastIndex = matchIndex + fullMatchStr.length;
        replacedAnything = true;
      }
    });

    if (replacedAnything) {
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }
      parent.replaceChild(fragment, node);
    }
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyDomainOverrides() {
  const hostname = window.location.hostname;
  if (!settings.domainRules || !settings.domainRules.length) return;

  // Create a working copy so we don't permanently mutate the saved mappings
  const overriddenMappings = Object.assign({}, settings.symbolMappings);

  for (const rule of settings.domainRules) {
    if (hostname.includes(rule.domain)) {
      console.log(`Coiner: Domain rule matched! "${rule.domain}" found in "${hostname}". Overriding "${rule.symbol}" → ${rule.code}`);
      overriddenMappings[rule.symbol] = rule.code;
    }
  }

  settings.symbolMappings = overriddenMappings;
}

function getBaseCurrency(indicator) {
  const lookup = indicator.trim().toUpperCase();
  for (const [sym, code] of Object.entries(settings.symbolMappings)) {
    if (sym.toUpperCase() === lookup || code.toUpperCase() === lookup) {
      return code.toUpperCase();
    }
  }
  return lookup; // Fallback
}

function scanDOM(root) {
  const treeWalker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  const nodes = [];
  let currentNode = treeWalker.nextNode();
  while (currentNode) {
    nodes.push(currentNode);
    currentNode = treeWalker.nextNode();
  }

  // processing detached array avoids DOM mutation issues during traversal
  nodes.forEach(node => processTextNode(node));
}

init();

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    if (changes.targetCurrency) settings.targetCurrency = changes.targetCurrency.newValue;
    if (changes.symbolMappings) settings.symbolMappings = changes.symbolMappings.newValue;
    if (changes.textCodes) settings.textCodes = changes.textCodes.newValue;
    if (changes.domainRules) settings.domainRules = changes.domainRules.newValue;
    // Re-apply domain overrides after any settings change
    applyDomainOverrides();
  }
});
