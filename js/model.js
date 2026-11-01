// The app's data and the rules for working with it. No browser code here, so it can be tested.
import { addDays, daysBetween } from './dates.js';

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
    settings: { currency: '$', weekStart: 1, slots: defaultSlots(), goals: {} },
  };
}

export function migrate(s) {
  const d = defaultState();
  const out = { ...d, ...s };
  out.recipes = Array.isArray(s.recipes) ? s.recipes : [];
  out.categories = Array.isArray(s.categories) ? s.categories : d.categories;
  out.foods = Array.isArray(s.foods) ? s.foods : [];
  out.plan = s.plan && typeof s.plan === 'object' ? s.plan : {};
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
export function parseIngredient(line) {
  const text = String(line || '').replace(/^[-•*\s]+/, '').trim();
  if (!text) return null;
  const m = text.match(new RegExp(`^${QTY_RE}\\s*(?:(${UNIT_RE})\\.?\\b)?\\s*(?:of\\s+)?(.*)$`, 'i'));
  if (!m) return { qty: null, unit: '', name: text };
  const qty = parseQty(m[1]);
  const name = (m[3] || '').trim();
  if (!name && !m[2]) return { qty: null, unit: '', name: text };
  return { qty, unit: (m[2] || '').toLowerCase().replace(/\s+/, ' '), name: name || text };
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
export function filterRecipes(state, { search = '', filter = {}, sort = 'name' } = {}) {
  const q = search.trim().toLowerCase();
  let list = state.recipes.filter((r) => {
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

// ---------- Saved foods (for quick-add) ----------

const norm = (s) => String(s || '').trim().toLowerCase();

export function findFood(state, name) {
  return state.foods.find((f) => norm(f.name) === norm(name)) || null;
}

// Scales a saved food to the amount asked for, when the units match.
export function foodFor(state, { name, amount, unit }) {
  const saved = findFood(state, name);
  const item = { name: name.trim(), amount, unit: unit || '', nutrition: {}, cost: null };
  if (!saved) return { item, matched: false };
  item.name = saved.name;
  let factor = 1;
  if (amount == null) {
    item.amount = saved.amount;
    item.unit = saved.unit;
  } else if (saved.amount && norm(saved.unit) === norm(unit)) {
    factor = amount / saved.amount;
  } else if (saved.amount && !unit && !saved.unit) {
    factor = amount / saved.amount;
  } else {
    // Different units: keep what was typed, but we can't scale the numbers.
    return { item, matched: false, saved };
  }
  for (const n of NUTRIENTS) {
    const v = saved.nutrition?.[n.key];
    if (v != null && v !== '') item.nutrition[n.key] = Math.round(Number(v) * factor * 10) / 10;
  }
  if (saved.cost != null && saved.cost !== '') item.cost = Math.round(Number(saved.cost) * factor * 100) / 100;
  return { item, matched: true };
}

export function rememberFood(state, item) {
  const existing = findFood(state, item.name);
  const fields = {
    name: item.name.trim(),
    amount: item.amount ?? null,
    unit: item.unit || '',
    nutrition: { ...(item.nutrition || {}) },
    cost: item.cost ?? null,
    updatedAt: Date.now(),
  };
  if (existing) Object.assign(existing, fields);
  else state.foods.push({ id: uid(), ...fields });
}

export function recentFoods(state, limit = 12) {
  return state.foods.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, limit);
}
