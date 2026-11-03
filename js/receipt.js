// Prices over time, and reading grocery receipts. Pure functions, so they can be tested.
import { toBase } from './foods.js';

// ---------- Price history ----------

// What one base unit costs (per 100 g, or per 1 piece/cup/etc. for counted foods).
export function unitPrice(food, price = food.price) {
  if (!price || price.amount == null || price.amount === '') return null;
  const paid = toBase(food, Number(price.qty ?? 1) || 1, price.unit || '');
  if (!paid) return null;
  const per = !food.base || food.base === 'g' ? 100 : 1;
  return (Number(price.amount) * per) / paid;
}

export function unitLabel(food) {
  return !food.base || food.base === 'g' ? 'per 100 g' : `per ${food.base === 'piece' ? 'item' : food.base}`;
}

// Saves a new price, keeping the old one in the history. Same-day changes replace each other.
export function setPrice(food, price, date, store = '') {
  const clean = { amount: Number(price.amount), qty: Number(price.qty ?? 1) || 1, unit: price.unit || '' };
  const old = food.price;
  const same = old && Number(old.amount) === clean.amount && Number(old.qty ?? 1) === clean.qty && (old.unit || '') === clean.unit;
  food.price = clean;
  if (!food.priceHistory) food.priceHistory = [];
  const h = food.priceHistory;
  // Start the history with the price it had before, if it has none yet.
  if (!h.length && old && old.amount != null && old.amount !== '' && !same) {
    h.push({ date: food.priceDate || '', amount: Number(old.amount), qty: Number(old.qty ?? 1) || 1, unit: old.unit || '' });
  }
  const last = h[h.length - 1];
  if (last && last.date === date) h[h.length - 1] = { date, ...clean, ...(store ? { store } : {}) };
  else if (!same || !h.length) h.push({ date, ...clean, ...(store ? { store } : {}) });
  food.priceDate = date;
  return food;
}

// The change between the first and the latest price, as a fraction (0.12 = 12% more).
export function priceTrend(food) {
  const h = (food.priceHistory || []).map((p) => ({ date: p.date, unit: unitPrice(food, p) })).filter((p) => p.unit != null);
  if (h.length < 2) return null;
  const first = h[0];
  const last = h[h.length - 1];
  if (!first.unit) return null;
  return { change: last.unit / first.unit - 1, from: first.date, to: last.date, points: h };
}

// ---------- Receipts ----------

const SKIP = /\b(sub-?total|total|tax|vat|change|cash|card|visa|master ?card|amex|debit|credit|balance|tender|payment|paid|savings?|you saved|discount|coupon|points|rewards?|member|loyalty|thank|receipt|store|cashier|register|transaction|auth|approval|ref|tel|phone|www|http|items? sold|number of items|bag fee|bottle deposit)\b/i;
const PRICE_END = /(-?)\$?\s?(\d{1,4}[.,]\d{2})\s*(?:[A-Z]{1,2}|\*)?\s*$/;

// Turns receipt text (from the camera, or copied from a photo) into lines with a price.
export function parseReceipt(text) {
  const raw = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = [];
  let pending = ''; // a name on a line of its own, waiting for its price below
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    const m = line.match(PRICE_END);
    if (!m) {
      pending = !SKIP.test(line) && /[a-z]{3}/i.test(line) ? line : '';
      continue;
    }
    if (SKIP.test(line)) { pending = ''; continue; }
    if (m[1] === '-') continue; // a discount
    const price = Number(m[2].replace(',', '.'));
    let name = line.slice(0, m.index).trim();
    let qty = null;
    let unit = '';
    // "1.23 lb @ 2.99 /lb" or "2 @ 1.99" on this line or the one before.
    const w = (name.match(/(\d+(?:[.,]\d+)?)\s*(lb|lbs|kg|g|oz)\b\s*@/i) || []);
    const n = (name.match(/^(\d+)\s*(?:x|@)\s*/i) || name.match(/\b(\d+)\s*@\s*\$?\d/) || []);
    if (w[1]) { qty = Number(w[1].replace(',', '.')); unit = w[2].toLowerCase().replace(/^lbs$/, 'lb'); }
    else if (n[1]) qty = Number(n[1]);
    name = name.replace(/\d+(?:[.,]\d+)?\s*(lb|lbs|kg|g|oz)?\s*@\s*\$?\d+[.,]\d{2}\s*(\/\s*\w+)?/gi, '').replace(/^\d+\s*(x|@)\s*/i, '').trim();
    // A weight or count line on its own belongs to the item above it.
    if (!/[a-z]{2}/i.test(name)) {
      if (pending) {
        name = pending.replace(/\s+\d{5,}.*$/, '').replace(/\s+[A-Z]{1,2}$/, '').trim();
        pending = '';
      } else {
        continue;
      }
    }
    pending = '';
    // Leading product codes: "012345678 BANANAS"
    name = name.replace(/^\d{4,}\s+/, '').replace(/\s+\d{5,}$/, '').trim();
    if (!/[a-z]{2}/i.test(name) || price <= 0) continue;
    out.push({ text: line, name, price, qty, unit });
  }
  return out;
}

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 1);

// The food a receipt line most likely is: one you used before for this text, or the best word match.
export function matchFood(foods, name) {
  const key = String(name).toLowerCase().trim();
  const remembered = foods.find((f) => (f.receiptNames || []).includes(key));
  if (remembered) return remembered;
  const lw = words(name);
  let best = null;
  let bestScore = 0;
  for (const f of foods) {
    const fw = words(`${f.name} ${(f.aliases || []).join(' ')} ${f.brand || ''}`);
    let score = 0;
    for (const w of lw) {
      if (fw.includes(w)) score += 2;
      // Receipts shorten words: "MLK" for milk, "CHKN" for chicken.
      else if (fw.some((x) => x.startsWith(w) || (w.length >= 3 && consonants(x).startsWith(consonants(w))))) score += 1;
    }
    const norm = score / Math.max(2, fw.length);
    if (score >= 1 && norm > bestScore) { best = f; bestScore = norm; }
  }
  return best;
}

const consonants = (w) => w[0] + w.slice(1).replace(/[aeiou]/g, '');

export function rememberReceiptName(food, name) {
  const key = String(name).toLowerCase().trim();
  if (!key) return;
  food.receiptNames = [...new Set([...(food.receiptNames || []), key])].slice(-10);
}
