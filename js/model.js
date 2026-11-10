// The app's data and the rules for working with it. No browser code here, so it can be tested.
import { addDays, daysBetween } from './dates.js';
import {
  defaultAmount, foodFromAmount, nutritionFor, priceFor, upgradeFood,
} from './foods.js';

export const NUTRIENTS = [
  { key: 'cal', label: 'Calories', short: 'kcal', unit: 'kcal' },
  { key: 'protein', label: 'Protein', short: 'protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', short: 'carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', short: 'fat', unit: 'g' },
  { key: 'sugar', label: 'Sugar', short: 'sugar', unit: 'g' },
  { key: 'fiber', label: 'Fiber', short: 'fiber', unit: 'g' },
];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Fixed ids, so two devices that start fresh end up with the same groups instead of two copies.
function group(name, options) {
  const id = name.toLowerCase();
  return { id, name, options: options.map((o) => ({ id: `${id}-${o.toLowerCase()}`, name: o })) };
}

export function defaultCategories() {
  return [
    group('Meal', ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack']),
    group('Difficulty', ['Easy', 'Medium', 'Hard']),
    group('Cost', ['Cheap', 'Normal', 'Pricey']),
    group('Time', ['Fast', 'Medium', 'Slow']),
  ];
}

export function defaultSlots() {
  return [
    { id: 'breakfast', name: 'Breakfast' },
    { id: 'lunch', name: 'Lunch' },
    { id: 'dinner', name: 'Dinner' },
    { id: 'snacks', name: 'Snacks' },
  ];
}

export function defaultState() {
  return {
    version: 1,
    recipes: [],
    categories: defaultCategories(),
    foods: [],
    plan: {},
    pantry: [],
    shopping: { checked: {}, extras: [], links: {}, recipes: [], skip: {}, sections: {} },
    settings: { currency: '$', weekStart: 1, slots: defaultSlots(), goals: {}, usdaKey: '', shopDays: 7 },
  };
}

export function migrate(s) {
  const d = defaultState();
  const out = { ...d, ...s };
  out.recipes = Array.isArray(s.recipes) ? s.recipes : [];
  out.categories = Array.isArray(s.categories) ? s.categories : d.categories;
  out.foods = Array.isArray(s.foods) ? s.foods.map(upgradeFood) : [];
  out.plan = s.plan && typeof s.plan === 'object' ? s.plan : {};
  out.pantry = Array.isArray(s.pantry) ? s.pantry : [];
  const shop = s.shopping && typeof s.shopping === 'object' ? s.shopping : {};
  out.shopping = {
    checked: shop.checked && typeof shop.checked === 'object' ? shop.checked : {},
    extras: Array.isArray(shop.extras) ? shop.extras : [],
    links: shop.links && typeof shop.links === 'object' ? shop.links : {},
    recipes: Array.isArray(shop.recipes) ? shop.recipes : [],
    skip: shop.skip && typeof shop.skip === 'object' ? shop.skip : {},
    sections: shop.sections && typeof shop.sections === 'object' ? shop.sections : {},
  };
  out.settings = { ...d.settings, ...(s.settings || {}) };
  if (!Array.isArray(out.settings.slots) || !out.settings.slots.length) out.settings.slots = d.settings.slots;
  if (!out.settings.goals) out.settings.goals = {};
  return out;
}

// ---------- Numbers ----------

const FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅕': 0.2 };

// "2", "1.5", "1,5", "1/2", "1 1/2", "1½", "½" -> number (or null)
export function parseQty(text) {
  let t = String(text ?? '').trim();
  if (!t) return null;
  for (const [f, v] of Object.entries(FRACTIONS)) {
    if (t.includes(f)) {
      const rest = t.replace(f, '').trim();
      return (rest ? Number(rest.replace(',', '.')) || 0 : 0) + v;
    }
  }
  t = t.replace(',', '.');
  let m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = t.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function fmtNum(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '';
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return String(r);
}

// Friendly quantities for ingredients: 0.5 -> "½", 1.25 -> "1¼"
export function fmtQty(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  const nice = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];
  if (frac < 0.02) return String(whole);
  for (const [v, s] of nice) if (Math.abs(frac - v) < 0.02) return `${whole || ''}${s}`;
  return fmtNum(n, n < 10 ? 2 : 1);
}

export function fmtMoney(n, currency = '$') {
  if (n == null || !Number.isFinite(n)) return '';
  return `${currency}${n.toFixed(2)}`;
}

// ---------- Ingredients and quick-add parsing ----------

const UNITS = [
  'g', 'gram', 'grams', 'kg', 'mg', 'ml', 'milliliter', 'milliliters', 'l', 'liter', 'liters', 'litre', 'litres', 'dl', 'cl',
  'tsp', 'teaspoon', 'teaspoons', 'tbsp', 'tablespoon', 'tablespoons', 'cup', 'cups', 'oz', 'ounce', 'ounces',
  'lb', 'lbs', 'pound', 'pounds', 'pinch', 'pinches', 'dash', 'clove', 'cloves', 'can', 'cans', 'jar', 'jars',
  'piece', 'pieces', 'pc', 'pcs', 'slice', 'slices', 'pack', 'packs', 'package', 'packages', 'bunch', 'bunches',
  'stick', 'sticks', 'handful', 'handfuls', 'head', 'heads', 'fl oz', 'qt', 'quart', 'quarts', 'pint', 'pints',
];
const UNIT_RE = UNITS.slice().sort((a, b) => b.length - a.length).map((u) => u.replace(' ', '\\s')).join('|');
const QTY_RE = '(\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+[.,]?\\d*\\s*[½⅓⅔¼¾⅛⅕]?|[½⅓⅔¼¾⅛⅕])';

// "2 1/2 cups flour" -> { qty: 2.5, unit: 'cups', name: 'flour' }
function parseIngredientRaw(text) {
  const m = text.match(new RegExp(`^${QTY_RE}\\s*(?:(${UNIT_RE})\\.?\\b)?\\s*(?:of\\s+)?(.*)$`, 'i'));
  if (!m) return { qty: null, unit: '', name: text };
  const qty = parseQty(m[1]);
  const name = (m[3] || '').trim();
  if (!name && !m[2]) return { qty: null, unit: '', name: text };
  return { qty, unit: (m[2] || '').toLowerCase().replace(/\s+/, ' '), name: name || text };
}

export function parseIngredient(line) {
  const text = String(line || '').replace(/^[-•*\s]+/, '').trim();
  if (!text) return null;
  const ing = parseIngredientRaw(text);
  // "2 (28 ounce) cans diced tomatoes" -> 2 cans, "diced tomatoes (28 oz)"
  const p = splitPackSize(ing);
  if (!p.size) return ing;
  const comma = p.name.indexOf(',');
  const name = comma > 0 ? `${p.name.slice(0, comma)} (${p.size})${p.name.slice(comma)}` : `${p.name} (${p.size})`;
  return { qty: ing.qty, unit: p.unit, name };
}

// Package sizes: "(28 ounce)", "(15 oz.)", "(14.5-ounce)".
const SIZE_RE = /\(\s*(\d[\d.,/]*(?:\s*-\s*\d[\d.,/]*)?)\s*-?\s*(fluid ounces?|fl\.? ?oz|ounces?|oz|pounds?|lbs?|lb|grams?|g|kilograms?|kg|milliliters?|millilitres?|ml|liters?|litres?|l|count|ct)\.?\s*(?:each)?\s*\)/i;
const PACK_RE = /^(cans?|tins?|jars?|packages?|pkgs?|packs?|bottles?|box(?:es)?|bags?|cartons?|containers?|tubs?|envelopes?|packets?|pouch(?:es)?)\b\.?\s*/i;
const SIZE_UNITS = {
  'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz', 'fl oz': 'fl oz', 'fl. oz': 'fl oz', floz: 'fl oz',
  ounce: 'oz', ounces: 'oz', oz: 'oz', pound: 'lb', pounds: 'lb', lbs: 'lb', lb: 'lb',
  gram: 'g', grams: 'g', g: 'g', kilogram: 'kg', kilograms: 'kg', kg: 'kg',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', ml: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', l: 'l', count: 'count', ct: 'count',
};

// Pulls a package size out of an ingredient: { unit: 'cans', size: '28 oz', name: 'diced tomatoes' }.
// Works for "(28 ounce) cans diced tomatoes" with no unit and for "diced tomatoes (28 oz)" with unit "cans".
export function splitPackSize(ing) {
  let name = String(ing?.name || '').trim();
  let unit = ing?.unit || '';
  const m = name.match(SIZE_RE);
  if (!m) return { unit, size: '', name };
  const size = `${m[1].replace(/\s+/g, '')} ${SIZE_UNITS[m[2].toLowerCase().replace(/\s+/g, ' ')] || m[2].toLowerCase()}`;
  name = `${name.slice(0, m.index)} ${name.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').trim();
  if (!unit) {
    const p = name.match(PACK_RE);
    if (p) { unit = p[1].toLowerCase(); name = name.slice(p[0].length).trim(); }
  }
  return { unit, size, name: name.replace(/^of\s+/i, '') };
}

export function ingredientText(ing, factor = 1) {
  const q = ing.qty != null ? fmtQty(ing.qty * factor) : '';
  return [q, ing.unit, ing.name].filter(Boolean).join(' ');
}

// Splits pasted text into steps: one per line, without "1." or "Step 1:" in front.
export function parseSteps(text) {
  return String(text || '')
    .split(/\n+/)
    .map((s) => s.replace(/^\s*(step\s*)?\d+[.):]?\s*/i, '').trim())
    .filter(Boolean);
}

// "100 g cheerios, 200ml milk" -> two foods
export function parseFoods(text) {
  return String(text || '')
    .split(/[,;\n]+|\s+and\s+|\s+\+\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const p = parseIngredient(part);
      return { name: p.name, amount: p.qty, unit: p.unit };
    });
}

// ---------- Recipes ----------

export const findRecipe = (state, id) => state.recipes.find((r) => r.id === id);

export function servingsOf(recipe) {
  return Math.max(1, Number(recipe?.servings) || 1);
}

// Nutrition for one portion.
export function perServing(recipe) {
  return recipe?.nutrition || {};
}

export function costPerServing(recipe) {
  if (recipe?.cost == null || recipe.cost === '') return null;
  return Number(recipe.cost) / servingsOf(recipe);
}

export function blankRecipe() {
  return {
    id: null,
    name: '',
    servings: 4,
    minutes: null,
    photo: null,
    tags: [],
    ingredients: [],
    steps: [],
    nutrition: {},
    cost: null,
    source: '',
    notes: '',
  };
}

export function deleteRecipe(state, id) {
  state.recipes = state.recipes.filter((r) => r.id !== id);
  for (const day of Object.values(state.plan)) {
    for (const [eid, e] of Object.entries(day)) if (e.recipeId === id) delete day[eid];
  }
}

// Category options a recipe has, with their group, skipping deleted ones.
export function recipeTags(state, recipe) {
  const out = [];
  for (const g of state.categories) {
    for (const o of g.options) if ((recipe.tags || []).includes(o.id)) out.push({ group: g, option: o });
  }
  return out;
}

// Filter: { [groupId]: Set(optionIds) } — a recipe must match every group that has a choice.
function lastCookedOf(state, id) {
  let last = '';
  for (const [date, day] of Object.entries(state.plan)) {
    if (date > last && Object.values(day).some((e) => e.type === 'cook' && e.recipeId === id)) last = date;
  }
  return last;
}

export function filterRecipes(state, { search = '', filter = {}, sort = 'name', favorites = false } = {}) {
  const q = search.trim().toLowerCase();
  let list = state.recipes.filter((r) => {
    if (favorites && !r.favorite) return false;
    if (q) {
      const hay = `${r.name} ${(r.ingredients || []).map((i) => i.name).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    for (const opts of Object.values(filter)) {
      if (!opts || !opts.size) continue;
      if (!(r.tags || []).some((t) => opts.has(t))) return false;
    }
    return true;
  });
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? Infinity : Number(v));
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    newest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    cost: (a, b) => num(costPerServing(a)) - num(costPerServing(b)),
    cal: (a, b) => num(perServing(a).cal) - num(perServing(b).cal),
    // Most protein first; recipes without a number go last.
    protein: (a, b) => {
      const pa = num(perServing(a).protein);
      const pb = num(perServing(b).protein);
      return (pb === Infinity ? -1 : pb) - (pa === Infinity ? -1 : pa);
    },
    time: (a, b) => num(a.minutes) - num(b.minutes),
    favorite: (a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.rating || 0) - (a.rating || 0),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    // Longest since it was last cooked first; never cooked comes first of all.
    stale: (a, b) => (lastCookedOf(state, a.id) || '').localeCompare(lastCookedOf(state, b.id) || ''),
  }[sort] || ((a, b) => a.name.localeCompare(b.name));
  list = list.slice().sort((a, b) => by(a, b) || a.name.localeCompare(b.name));
  return list;
}

// ---------- The plan ----------
// plan[date][entryId] = entry. An entry is one of:
//   { type: 'cook', recipeId, scale, portions }     cooks a batch (scale = how many times the recipe)
//   { type: 'leftover', recipeId, from, portions }  eats from a batch cooked earlier (from = "date|entryId")
//   { type: 'food', name, amount, unit, nutrition, cost }  anything without a recipe
// Every entry also has id, slot and order.

export function dayEntries(state, date, slot) {
  const list = Object.values(state.plan[date] || {});
  return list.filter((e) => slot == null || e.slot === slot).sort((a, b) => (a.order || 0) - (b.order || 0));
}

function nextEntryOrder(state, date) {
  return Math.max(0, ...Object.values(state.plan[date] || {}).map((e) => e.order || 0)) + 1;
}

export function addEntry(state, date, fields) {
  if (!state.plan[date]) state.plan[date] = {};
  const entry = { id: uid(), order: nextEntryOrder(state, date), portions: 1, ...fields };
  if (entry.type === 'cook' && !entry.scale) entry.scale = 1;
  state.plan[date][entry.id] = entry;
  return entry;
}

export function getEntry(state, date, id) {
  return state.plan[date]?.[id] || null;
}

export function removeEntryRaw(state, date, id) {
  if (state.plan[date]) {
    delete state.plan[date][id];
    if (!Object.keys(state.plan[date]).length) delete state.plan[date];
  }
}

export const refOf = (date, id) => `${date}|${id}`;

export function leftoversOf(state, date, id) {
  const ref = refOf(date, id);
  const out = [];
  for (const [d, day] of Object.entries(state.plan)) {
    for (const e of Object.values(day)) if (e.type === 'leftover' && e.from === ref) out.push({ date: d, entry: e });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function batchSize(state, cook) {
  return servingsOf(findRecipe(state, cook.recipeId)) * (Number(cook.scale) || 1);
}

export function batchUsed(state, date, cook) {
  return (Number(cook.portions) || 0)
    + leftoversOf(state, date, cook.id).reduce((s, l) => s + (Number(l.entry.portions) || 0), 0);
}

export function batchLeft(state, date, cook) {
  return batchSize(state, cook) - batchUsed(state, date, cook);
}

// Batches of this recipe cooked on or before `date` (within two weeks) that still have portions.
export function openBatches(state, recipeId, date, days = 14) {
  const out = [];
  for (let k = addDays(date, -days); k <= date; k = addDays(k, 1)) {
    for (const e of dayEntries(state, k)) {
      if (e.type === 'cook' && e.recipeId === recipeId) {
        const left = batchLeft(state, k, e);
        if (left > 0) out.push({ date: k, entry: e, left });
      }
    }
  }
  return out.reverse();
}

// Where a leftover's batch was cooked, or null if it's gone.
export function sourceOf(state, leftover) {
  const [date, id] = String(leftover.from || '').split('|');
  const e = getEntry(state, date, id);
  return e && e.type === 'cook' ? { date, entry: e } : null;
}

// Removing a batch: either take its leftovers with it, or let the first leftover
// become the day it's cooked (so the shopping list still buys it).
export function removeEntry(state, date, id, { withLeftovers = true } = {}) {
  const e = getEntry(state, date, id);
  if (!e) return;
  if (e.type === 'cook') {
    const lefts = leftoversOf(state, date, id);
    if (withLeftovers) {
      for (const l of lefts) removeEntryRaw(state, l.date, l.entry.id);
    } else if (lefts.length) {
      const [first, ...rest] = lefts;
      first.entry.type = 'cook';
      first.entry.scale = e.scale || 1;
      delete first.entry.from;
      const ref = refOf(first.date, first.entry.id);
      for (const l of rest) l.entry.from = ref;
    }
  }
  removeEntryRaw(state, date, id);
}

export function moveEntry(state, date, id, toDate, toSlot) {
  const e = getEntry(state, date, id);
  if (!e) return null;
  if (e.type === 'cook' && toDate !== date) {
    // Keep leftovers pointing at the batch.
    const lefts = leftoversOf(state, date, id);
    removeEntryRaw(state, date, id);
    if (!state.plan[toDate]) state.plan[toDate] = {};
    e.slot = toSlot;
    e.order = nextEntryOrder(state, toDate);
    state.plan[toDate][e.id] = e;
    for (const l of lefts) l.entry.from = refOf(toDate, e.id);
    return e;
  }
  removeEntryRaw(state, date, id);
  if (!state.plan[toDate]) state.plan[toDate] = {};
  e.slot = toSlot;
  e.order = nextEntryOrder(state, toDate);
  state.plan[toDate][e.id] = e;
  return e;
}

// ---------- Totals ----------

export function entryName(state, e) {
  if (e.type === 'food') return e.name || 'Food';
  return findRecipe(state, e.recipeId)?.name || 'Deleted recipe';
}

// Nutrition and cost of what's eaten in one entry, plus what's missing.
export function entryTotals(state, e) {
  const out = { cost: null, missingNutrition: false, missingCost: false };
  for (const n of NUTRIENTS) out[n.key] = null;
  if (e.type === 'food') {
    // Linked to your food list: use the food's current numbers and price.
    const food = e.foodId ? getFood(state, e.foodId) : null;
    const live = food ? nutritionFor(food, e.amount, e.unit) : null;
    if (live) {
      for (const n of NUTRIENTS) if (live[n.key] != null) out[n.key] = live[n.key];
      out.cost = priceFor(food, e.amount, e.unit);
      out.missingNutrition = out.cal == null;
      out.missingCost = out.cost == null;
      return out;
    }
    for (const n of NUTRIENTS) {
      const v = e.nutrition?.[n.key];
      if (v != null && v !== '') out[n.key] = Number(v);
    }
    out.cost = e.cost == null || e.cost === '' ? null : Number(e.cost);
  } else {
    const r = findRecipe(state, e.recipeId);
    const p = Number(e.portions) || 0;
    const ps = perServing(r);
    for (const n of NUTRIENTS) {
      const v = ps[n.key];
      if (v != null && v !== '') out[n.key] = Number(v) * p;
    }
    const c = costPerServing(r);
    out.cost = c == null ? null : c * p;
  }
  out.missingNutrition = out.cal == null;
  out.missingCost = out.cost == null;
  return out;
}

export function sumTotals(list) {
  const out = { cost: 0, items: 0, missingNutrition: 0, missingCost: 0 };
  for (const n of NUTRIENTS) out[n.key] = 0;
  for (const t of list) {
    out.items += 1;
    for (const n of NUTRIENTS) out[n.key] += t[n.key] || 0;
    out.cost += t.cost || 0;
    if (t.missingNutrition) out.missingNutrition += 1;
    if (t.missingCost) out.missingCost += 1;
  }
  return out;
}

export function dayTotals(state, date) {
  return sumTotals(dayEntries(state, date).map((e) => entryTotals(state, e)));
}

// Totals over a range of days, with one row per day.
export function rangeTotals(state, from, to) {
  const days = daysBetween(from, to).map((date) => ({ date, ...dayTotals(state, date) }));
  const total = sumTotals([]);
  let planned = 0;
  let cooks = 0;
  for (const d of days) {
    for (const k of Object.keys(total)) total[k] += d[k] || 0;
    if (d.items) planned += 1;
    cooks += dayEntries(state, d.date).filter((e) => e.type === 'cook').length;
  }
  return { days, total, plannedDays: planned, cooks };
}

// ---------- Your food list ----------

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
// "Onions, chopped (optional)" -> "onion"
function simple(s) {
  let t = norm(s).replace(/\(.*?\)/g, '').split(',')[0].trim();
  t = t.replace(/^(fresh|large|small|medium|chopped|diced|minced|sliced|dried|raw|cooked)\s+/g, '');
  if (t.endsWith('ies')) t = `${t.slice(0, -3)}y`;
  else if (t.endsWith('oes')) t = t.slice(0, -2);
  else if (t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  return t;
}

export const getFood = (state, id) => state.foods.find((f) => f.id === id) || null;

// The food in your list with this name (or a name you linked to it before).
export function findFood(state, name) {
  const n = norm(name);
  if (!n) return null;
  const names = (f) => [f.name, ...(f.aliases || [])];
  let hit = state.foods.find((f) => names(f).some((x) => norm(x) === n));
  if (hit) return hit;
  const sn = simple(name);
  hit = state.foods.find((f) => names(f).some((x) => simple(x) === sn));
  return hit || null;
}

// Remember that "ground beef" means this food, so it's found next time.
export function linkName(food, name) {
  const n = String(name || '').trim();
  if (!n || norm(n) === norm(food.name)) return;
  food.aliases = [...new Set([...(food.aliases || []), n])];
}

// A food for a day, from what was typed: { name, amount, unit } -> entry fields.
export function foodFor(state, { name, amount, unit }, food = findFood(state, name)) {
  const item = { name: String(name || '').trim(), amount, unit: unit || '', nutrition: {}, cost: null };
  if (!food) return { item, matched: false };
  return { item: entryFromFood(food, amount, unit), matched: true, food };
}

export function entryFromFood(food, amount, unit) {
  let qty = amount;
  let u = unit || '';
  if (qty == null) ({ qty, unit: u } = defaultAmount(food));
  const nutrition = nutritionFor(food, qty, u);
  return {
    name: food.name,
    amount: qty,
    unit: u,
    foodId: food.id,
    nutrition: nutrition || {},
    cost: nutrition ? priceFor(food, qty, u) : null,
    unconverted: !nutrition || undefined,
  };
}

// Adds a food from a lookup to your list (or refreshes the one you already have).
export function addFood(state, food) {
  const same = state.foods.find((f) => (food.sourceId && f.source === food.source && f.sourceId === food.sourceId));
  if (same) {
    // Keep your price, sizes and section; refresh the numbers.
    same.nutrition = { ...food.nutrition };
    same.updatedAt = Date.now();
    return same;
  }
  const f = { id: uid(), price: null, portions: [], aliases: [], ...food, updatedAt: Date.now() };
  state.foods.push(f);
  return f;
}

// Saves numbers typed for a food on a day into your food list.
export function rememberFood(state, item) {
  const fresh = foodFromAmount(item);
  const existing = item.foodId ? getFood(state, item.foodId) : findFood(state, item.name);
  if (existing && existing.source === 'manual') {
    Object.assign(existing, { ...fresh, id: existing.id, aliases: existing.aliases, section: existing.section, updatedAt: Date.now() });
    return existing;
  }
  if (existing) return existing; // looked-up foods keep their numbers
  const f = { ...fresh, id: uid(), aliases: [], updatedAt: Date.now() };
  state.foods.push(f);
  return f;
}

export function recentFoods(state, limit = 12) {
  return state.foods.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, limit);
}

export function deleteFood(state, id) {
  state.foods = state.foods.filter((f) => f.id !== id);
  for (const r of state.recipes) for (const i of r.ingredients || []) if (i.foodId === id) delete i.foodId;
}

// ---------- Recipe totals from its ingredients ----------

// Nutrition and price per portion, worked out from the ingredients that are in your food list.
export function recipeFromIngredients(state, recipe) {
  const servings = Math.max(1, Number(recipe.servings) || 1);
  const total = {};
  for (const n of NUTRIENTS) total[n.key] = 0;
  let cost = 0;
  let priced = 0;
  const rows = [];
  for (const ing of recipe.ingredients || []) {
    if (!String(ing.name || '').trim()) continue;
    const food = (ing.foodId && getFood(state, ing.foodId)) || findFood(state, ing.name);
    const qty = ing.qty;
    const row = { ing, food, nutrition: null, cost: null, problem: '' };
    if (!food) row.problem = 'not in your food list';
    else if (qty == null) row.problem = 'no amount';
    else {
      row.nutrition = nutritionFor(food, qty, ing.unit);
      if (!row.nutrition) row.problem = `can't tell how much “${ing.unit || 'one'}” weighs`;
      else {
        for (const n of NUTRIENTS) total[n.key] += row.nutrition[n.key] || 0;
        row.cost = priceFor(food, qty, ing.unit);
        if (row.cost != null) { cost += row.cost; priced += 1; }
      }
    }
    rows.push(row);
  }
  const counted = rows.filter((r) => r.nutrition).length;
  const perPortion = {};
  for (const n of NUTRIENTS) perPortion[n.key] = Math.round((total[n.key] / servings) * 10) / 10;
  return {
    rows,
    counted,
    priced,
    perPortion,
    totalCost: priced ? Math.round(cost * 100) / 100 : null,
  };
}
