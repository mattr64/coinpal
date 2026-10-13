let settings = {};
let rates = {};
let mappings = {};
let regexes = null;
const formatters = {};

// Inline wrappers whose neighbours can hold a price's symbol, e.g. <b>393,855</b> KRW
const INLINE_TAGS = ['span', 'b', 'strong', 'em', 'i', 'small', 'sup', 'sub', 'a', 'font', 'label', 'mark', 'u', 's', 'del', 'ins', 'bdi', 'data'];

async function init() {
  const syncData = await chrome.storage.sync.get(['targetCurrency', 'userMappings', 'hiddenMappings', 'domainRules']);
  const localData = await chrome.storage.local.get(['exchangeRates']);

  setSettings(syncData);
  rates = localData.exchangeRates || {};
  applySettings();

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

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.exchangeRates) {
      rates = changes.exchangeRates.newValue || {};
      refreshTooltips();
    } else if (namespace === 'sync') {
      const updated = {};
      for (const [key, change] of Object.entries(changes)) updated[key] = change.newValue;
      setSettings(Object.assign({}, settings, updated));
      applySettings();
      refreshTooltips();
      // Pick up prices that only match the new mappings
      scanDOM(document.body);
    }
  });
}

function setSettings(data) {
  settings = {
    targetCurrency: data.targetCurrency || DEFAULT_TARGET_CURRENCY,
    userMappings: data.userMappings || {},
    hiddenMappings: data.hiddenMappings || [],
    domainRules: data.domainRules || []
  };
}

// Rebuild the mappings and regexes once per settings change rather than per text node
function applySettings() {
  mappings = getEffectiveMappings(settings.userMappings, settings.hiddenMappings);
  applyDomainOverrides();

  const codes = [...Object.values(mappings), ...settings.domainRules.map(rule => rule.code)];
  const indicators = [...new Set([...Object.keys(mappings), ...codes])]
    .sort((a, b) => b.length - a.length) // longest first, so e.g. "HK$" wins over "$"
    .map(escapeRegExp)
    .join('|');

  if (!indicators) {
    regexes = null;
    return;
  }

  // Supports formats like: ¥1,000.00 | 1000 RMB | $ 10.50 | 1.000,00 € | From393,855KRW
  // Group 1: Prefix indicator
  // Group 2: Amount
  // Group 3: Suffix indicator
  // A prefix indicator must not follow a letter/digit; a bare number only must not follow a digit/separator,
  // so text like "From393,855KRW" matches the whole amount rather than "855KRW".
  // 'g' for exact global, 'i' to match codes case insensitively
  regexes = {
    price: new RegExp(`(?:(?<![a-zA-Z0-9])(${indicators})\\s*|(?<![\\d.,]))(\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d{1,3})?|\\d+(?:[.,]\\d{1,3})?)(?:\\s*(${indicators}))?(?![a-zA-Z0-9])`, 'gi'),
    precedingIndicator: new RegExp(`(?:^|\\s)(${indicators})$`, 'i'),
    followingIndicator: new RegExp(`^(${indicators})(?:\\s|$)`, 'i')
  };
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
      // Converted on hover so changed rates and settings apply without a reload
      const converted = getConversion(target);
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

function getConversion(span) {
  const baseCurrencyCode = getBaseCurrency(span.dataset.indicator);
  const targetCurrency = settings.targetCurrency;
  if (baseCurrencyCode === targetCurrency || !rates[baseCurrencyCode] || !rates[targetCurrency]) return '';

  const valInEur = parseFloat(span.dataset.amount) / rates[baseCurrencyCode];
  const finalVal = valInEur * rates[targetCurrency];
  return `${formatCurrency(finalVal, targetCurrency)} (from ${baseCurrencyCode})`;
}

function formatCurrency(value, code) {
  if (!formatters[code]) {
    try {
      // Locale-aware grouping and the currency's own decimals (e.g. none for KRW/JPY)
      formatters[code] = new Intl.NumberFormat(undefined, { style: 'currency', currency: code });
    } catch (e) {
      formatters[code] = { format: v => `${v.toFixed(2)} ${code}` };
    }
  }
  return formatters[code].format(value);
}

// Only show the underline on prices that currently have a conversion to offer
function refreshTooltips() {
  document.querySelectorAll('.coinpal-tooltip').forEach((span) => {
    span.classList.toggle('coinpal-inactive', !getConversion(span));
  });
}

function processTextNode(node) {
  if (!regexes) return;

  // Ignore special elements
  const parent = node.parentElement;
  if (!parent) return;
  const tag = parent.tagName.toLowerCase();
  if (['script', 'style', 'noscript', 'textarea', 'code', 'input', 'select', 'option'].includes(tag)) return;
  if (parent.classList && parent.classList.contains('coinpal-tooltip')) return;
  // Leave text being edited alone (email composers, rich text editors) so we never alter what's typed
  if (parent.isContentEditable || document.designMode === 'on') return;

  const text = node.nodeValue;
  if (!text || !text.trim()) return;

  // Push all matches, including raw numbers. We verify indicator presences next.
  const matches = [...text.matchAll(regexes.price)];

  if (matches.length > 0) {
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let replacedAnything = false;
    const haveRates = Object.keys(rates).length > 0;

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

        // Only look past the parent when it's inline; a neighbouring paragraph or cell is a different price
        const parentIsInline = INLINE_TAGS.includes(tag);

        if (!pText && parentIsInline) {
          let ppNode = node.parentElement.previousSibling;
          while (ppNode && ppNode.nodeType === Node.TEXT_NODE && !ppNode.nodeValue.trim()) ppNode = ppNode.previousSibling;
          if (ppNode) pText = ppNode.textContent.trim();
        }

        if (!nText && parentIsInline) {
          let nnNode = node.parentElement.nextSibling;
          while (nnNode && nnNode.nodeType === Node.TEXT_NODE && !nnNode.nodeValue.trim()) nnNode = nnNode.nextSibling;
          if (nnNode) nText = nnNode.textContent.trim();
        }

        const pMatch = pText.match(regexes.precedingIndicator);
        if (pMatch) {
          indicator = pMatch[1];
        } else {
          const nMatch = nText.match(regexes.followingIndicator);
          if (nMatch) indicator = nMatch[1];
        }
      }

      if (!indicator) return; // Skip if it's just a raw number with no adjacent symbols

      const amount = parseAmount(amountStr);
      if (isNaN(amount)) return;

      // Skip currencies the rates feed doesn't cover (unknown until the first fetch completes)
      if (haveRates && !rates[getBaseCurrency(indicator)]) return;

      if (matchIndex > lastIndex) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchIndex)));
      }

      const span = document.createElement('span');
      span.className = 'coinpal-tooltip';
      span.dataset.amount = String(amount);
      span.dataset.indicator = indicator;
      span.textContent = fullMatchStr;
      span.classList.toggle('coinpal-inactive', !getConversion(span));
      fragment.appendChild(span);

      lastIndex = matchIndex + fullMatchStr.length;
      replacedAnything = true;
    });

    if (replacedAnything) {
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }
      parent.replaceChild(fragment, node);
    }
  }
}

// With both separators, the last one is the decimal point ("1.000,00", "1,000.00").
// A lone separator is for thousands if it repeats or has exactly three digits after it
// ("1.234.567", "1.500", "1,000"); otherwise it is the decimal point ("1,5", "12.50").
function parseAmount(amountStr) {
  let normalizedAmount = amountStr;
  const hasComma = normalizedAmount.includes(',');
  const hasDot = normalizedAmount.includes('.');

  if (hasComma && hasDot) {
    if (normalizedAmount.lastIndexOf(',') > normalizedAmount.lastIndexOf('.')) {
      normalizedAmount = normalizedAmount.replace(/\./g, '').replace(',', '.');
    } else {
      normalizedAmount = normalizedAmount.replace(/,/g, '');
    }
  } else if (hasComma || hasDot) {
    const parts = normalizedAmount.split(hasComma ? ',' : '.');
    const isThousands = parts.length > 2 || parts[1].length === 3;
    normalizedAmount = parts.join(isThousands ? '' : '.');
  }

  return parseFloat(normalizedAmount);
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Applied to a fresh copy of the mappings each time, so removed rules stop applying
function applyDomainOverrides() {
  const hostname = window.location.hostname;

  for (const rule of settings.domainRules) {
    if (hostname.includes(rule.domain)) {
      console.log(`Coiner: Domain rule matched! "${rule.domain}" found in "${hostname}". Overriding "${rule.symbol}" → ${rule.code}`);
      mappings[rule.symbol] = rule.code;
    }
  }
}

function getBaseCurrency(indicator) {
  const lookup = indicator.trim().toUpperCase();
  for (const [sym, code] of Object.entries(mappings)) {
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
