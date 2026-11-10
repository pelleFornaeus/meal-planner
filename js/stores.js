// Sending the shopping list to Amazon or Instacart, and comparing the two.
// Pure functions, so they can be tested.
//
// Each shopping item can remember a store link, kept in state.shopping.links[itemKey]:
//   amazon:    { asin, title, price, qty, host }  the Amazon product you picked, its price and how many to add
//   instacart: { name, price }                    what to search Instacart for, and the price you saw there
import { normUnit } from './foods.js';
import { parseQty } from './model.js';

const ASIN = /^[A-Z0-9]{10}$/;

// Reads an Amazon link (or a shared "Check out this…" text, or a bare ASIN).
// Returns { asin, host, url } or { short } for a.co / amzn.to links that need following, or null.
export function parseAmazonLink(text) {
  const raw = String(text || '').trim();
  if (ASIN.test(raw.toUpperCase()) && /\d/.test(raw)) return { asin: raw.toUpperCase(), host: '', url: '' };
  const m = raw.match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  let u;
  try { u = new URL(m[0]); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (/(^|\.)(a\.co|amzn\.to|amzn\.eu|amzn\.asia)$/.test(host)) return { short: u.href };
  if (!/(^|\.)amazon\.[a-z.]+$/.test(host)) return null;
  const path = decodeURIComponent(u.pathname);
  const asin = path.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin|o\/asin)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]
    || u.searchParams.get('asin') || u.searchParams.get('ASIN');
  if (!asin || !ASIN.test(asin.toUpperCase())) return null;
  return { asin: asin.toUpperCase(), host: host.startsWith('www.') ? host : `www.${host.replace(/^(smile|m)\./, '')}`, url: u.href };
}

// Amazon product links usually start with the product name: /King-Arthur-Flour-5lb/dp/B0…
export function titleFromAmazonUrl(url) {
  try {
    const parts = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean);
    const i = parts.findIndex((p) => p === 'dp' || p === 'gp');
    const slug = i > 0 ? parts[i - 1] : '';
    if (!slug || /^(dp|gp|product|s)$/i.test(slug)) return '';
    return slug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

// "$4.99", "4,99 €", "1.234,50" -> number, or null
export function parsePrice(text) {
  const t = String(text ?? '').replace(/[^\d.,]/g, '');
  if (!t) return null;
  let s = t;
  if (/,\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// One link that adds every product to the Amazon cart (Amazon asks you to confirm).
export function amazonCartUrl(host, items) {
  const h = /^(www\.)?amazon\.[a-z.]+$/.test(host || '') ? host.replace(/^(?!www\.)/, 'www.') : 'www.amazon.com';
  const q = items.filter((i) => i.asin).map((i, n) => `ASIN.${n + 1}=${encodeURIComponent(i.asin)}&Quantity.${n + 1}=${Math.max(1, Math.round(Number(i.qty) || 1))}`);
  return `https://${h}/gp/aws/cart/add.html?${q.join('&')}`;
}

// Units Instacart understands, from ours.
const INSTACART_UNITS = {
  g: 'gram', kg: 'kilogram', oz: 'ounce', lb: 'pound', ml: 'milliliter', l: 'liter',
  tsp: 'teaspoon', tbsp: 'tablespoon', cup: 'cup', 'fl oz': 'fl oz', pint: 'pint', quart: 'quart', gal: 'gallon',
  '': 'each', piece: 'each', can: 'can', bunch: 'bunch', head: 'head', pack: 'package',
};

// "500 g" -> { quantity: 500, unit: 'gram' }; null when it can't be said simply ("1 can + 2 cups").
export function instacartMeasure(amount) {
  const t = String(amount || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (!t || t.includes('+')) return null;
  const m = t.match(/^([\d.,/½⅓⅔¼¾⅛⅕ ]+?)\s*([a-z. ]*)$/i);
  if (!m) return null;
  const qty = parseQty(m[1]);
  const unit = INSTACART_UNITS[normUnit(m[2])];
  if (qty == null || !(qty > 0) || !unit) return null;
  return { quantity: Math.round(qty * 100) / 100, unit };
}

// The line items for Instacart's shopping list page.
export function instacartItems(rows) {
  return rows.map((r) => {
    const name = (r.instacart?.name || r.name).trim();
    const m = instacartMeasure(r.amount);
    return {
      name,
      display_text: r.amount ? `${r.name} (${r.amount})` : r.name,
      ...(m ? { line_item_measurements: [m] } : {}),
    };
  });
}

// The key a store link is saved under. Extra items are linked by name, so the link
// is still there the next time you add the same thing.
export function linkKey(item, keyFor) {
  return item.extra ? keyFor(item.name) : item.key;
}

export function getLink(state, key) {
  return state.shopping?.links?.[key] || null;
}

// Merge changes into a store link ({ amazon: null } removes the Amazon product).
export function setLink(state, key, patch) {
  if (!state.shopping) state.shopping = { checked: {}, extras: [], links: {} };
  if (!state.shopping.links) state.shopping.links = {};
  const next = { ...(state.shopping.links[key] || {}) };
  for (const [store, v] of Object.entries(patch)) {
    if (v == null) delete next[store];
    else next[store] = { ...(next[store] || {}), ...v };
  }
  if (Object.keys(next).length) state.shopping.links[key] = next;
  else delete state.shopping.links[key];
  return next;
}

const round = (n) => Math.round(n * 100) / 100;

// One row per item to buy, with what each store would cost and which store it goes to.
// `picks` are choices made on the compare page: { [key]: 'amazon' | 'instacart' | 'skip' }.
export function compareRows(state, items, { picks = {}, keyFor = (n) => `n:${n}` } = {}) {
  return items.map((i) => {
    const key = linkKey(i, keyFor);
    const link = getLink(state, key) || {};
    const amazon = link.amazon?.asin ? link.amazon : null;
    const qty = Math.max(1, Math.round(Number(amazon?.qty) || 1));
    const amazonCost = amazon && Number(amazon.price) > 0 ? round(Number(amazon.price) * qty) : null;
    const instacart = link.instacart || null;
    const instacartCost = Number(instacart?.price) > 0 ? round(Number(instacart.price)) : null;
    let cheaper = '';
    if (amazonCost != null && instacartCost != null && amazonCost !== instacartCost) {
      cheaper = amazonCost < instacartCost ? 'amazon' : 'instacart';
    }
    let pick = picks[i.key];
    if (pick === 'amazon' && !amazon) pick = '';
    if (!pick) pick = cheaper || (amazon ? 'amazon' : 'instacart');
    return {
      key: i.key, linkKey: key, name: i.name, amount: i.amount || '', estimate: i.cost ?? null,
      amazon, qty, amazonCost, instacart, instacartCost, cheaper, pick,
    };
  });
}

// Totals for the compare page.
export function compareTotals(rows) {
  const sum = (list, f) => round(list.reduce((s, r) => s + (r[f] || 0), 0));
  const linked = rows.filter((r) => r.amazon);
  const priced = rows.filter((r) => r.instacartCost != null);
  const both = rows.filter((r) => r.amazonCost != null && r.instacartCost != null);
  const toAmazon = rows.filter((r) => r.pick === 'amazon');
  const toInstacart = rows.filter((r) => r.pick === 'instacart');
  return {
    amazon: { linked: linked.length, missing: rows.length - linked.length, cost: sum(linked, 'amazonCost'), unpriced: linked.filter((r) => r.amazonCost == null).length },
    instacart: { priced: priced.length, cost: sum(priced, 'instacartCost') },
    both: { count: both.length, amazon: sum(both, 'amazonCost'), instacart: sum(both, 'instacartCost') },
    toAmazon: { count: toAmazon.length, cost: sum(toAmazon, 'amazonCost') },
    toInstacart: { count: toInstacart.length, cost: sum(toInstacart, 'instacartCost') },
  };
}
