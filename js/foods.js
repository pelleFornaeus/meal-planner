// Foods in your food list: nutrition, sizes and prices, and turning
// "200 ml milk" into calories and dollars. Pure functions, so they can be tested.
//
// A food stores its nutrition for `per` of its `base` unit:
//   base 'g' and per 100  -> numbers per 100 g (most foods; ml count as g unless a density is set)
//   base 'egg' and per 1  -> numbers per egg (foods counted in pieces)
// portions: [{ unit: 'cup', grams: 240 }] says how much a cup, slice, piece… weighs.
// price: { amount: 3.49, qty: 1, unit: 'gal' } is what you pay for how much.
// serving: { qty, unit } is the usual amount, used when you don't type one.

import { NUTRIENTS, uid } from './model.js';

const MASS = { g: 1, kg: 1000, mg: 0.001, oz: 28.3495, lb: 453.592 };
const VOLUME = {
  ml: 1, l: 1000, dl: 100, cl: 10, tsp: 4.929, tbsp: 14.787, cup: 236.6,
  'fl oz': 29.574, pint: 473.2, quart: 946.4, gal: 3785.4,
};
const ALIASES = {
  gram: 'g', grams: 'g', gr: 'g', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  ounce: 'oz', ounces: 'oz', lbs: 'lb', pound: 'lb', pounds: 'lb',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', mls: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp',
  cups: 'cup', c: 'cup', floz: 'fl oz', 'fl. oz': 'fl oz', pints: 'pint', pt: 'pint', quarts: 'quart', qt: 'quart',
  gallon: 'gal', gallons: 'gal',
  pieces: 'piece', pc: 'piece', pcs: 'piece', whole: 'piece', each: 'piece', ea: 'piece', unit: 'piece', units: 'piece',
  slices: 'slice', cloves: 'clove', cans: 'can', jars: 'jar', packs: 'pack', package: 'pack', packages: 'pack',
  sticks: 'stick', bunches: 'bunch', heads: 'head', handfuls: 'handful', pinches: 'pinch',
  servings: 'serving', portion: 'serving', portions: 'serving',
};

export function normUnit(u) {
  let s = String(u || '').trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ');
  if (ALIASES[s]) s = ALIASES[s];
  return s;
}

export const isMass = (u) => normUnit(u) in MASS;
export const isVolume = (u) => normUnit(u) in VOLUME;

// Grams for an amount when it's a weight or volume (volume as if it were water), else null.
export function plainGrams(qty, unit, density = 1) {
  const u = normUnit(unit);
  if (u in MASS) return qty * MASS[u];
  if (u in VOLUME) return qty * VOLUME[u] * (density || 1);
  return null;
}

const PIECE = new Set(['', 'piece']);

// How much of the food's base unit an amount is (grams for most foods), or null if we can't tell.
export function toBase(food, qty, unit) {
  if (qty == null || !Number.isFinite(Number(qty))) return null;
  const q = Number(qty);
  const u = normUnit(unit);
  const portion = (food.portions || []).find((p) => normUnit(p.unit) === u && Number(p.grams) > 0);
  if (food.base === 'g' || !food.base) {
    if (u in MASS) return q * MASS[u];
    if (portion) return q * Number(portion.grams);
    if (u === 'serving' && food.serving) return q * (toBase(food, food.serving.qty, food.serving.unit) ?? NaN) || null;
    if (u in VOLUME) return q * VOLUME[u] * (Number(food.density) || 1);
    if (PIECE.has(u)) {
      const piece = (food.portions || []).find((p) => PIECE.has(normUnit(p.unit)) && Number(p.grams) > 0);
      if (piece) return q * Number(piece.grams);
    }
    return null;
  }
  // Counted foods (per egg, per banana…)
  const base = normUnit(food.base);
  const sing = (x) => x.replace(/(es|s)$/, '');
  if (u === base || sing(u) === sing(base) || PIECE.has(u) || (PIECE.has(base) && !(u in MASS) && !(u in VOLUME) && !portion)) return q;
  if (portion) return q * Number(portion.grams); // portion.grams here means "how many base units"
  return null;
}

export function nutritionFor(food, qty, unit) {
  const b = toBase(food, qty, unit);
  if (b == null) return null;
  const f = b / (Number(food.per) || 100);
  const out = {};
  for (const n of NUTRIENTS) {
    const v = food.nutrition?.[n.key];
    if (v != null && v !== '' && Number.isFinite(Number(v))) out[n.key] = Math.round(Number(v) * f * 10) / 10;
  }
  return out;
}

export function priceFor(food, qty, unit) {
  const p = food.price;
  if (!p || p.amount == null || p.amount === '') return null;
  const paid = toBase(food, p.qty ?? 1, p.unit);
  const want = toBase(food, qty, unit);
  if (!paid || want == null) return null;
  return Math.round((Number(p.amount) * want / paid) * 100) / 100;
}

// The amount to use when none was typed.
export function defaultAmount(food) {
  if (food.serving?.qty) return { qty: Number(food.serving.qty), unit: food.serving.unit || '' };
  if (food.base && food.base !== 'g') return { qty: 1, unit: food.base === 'piece' ? '' : food.base };
  return { qty: 100, unit: 'g' };
}

// A friendly label like "per 100 g" or "per egg".
export function perLabel(food) {
  if (!food.base || food.base === 'g') return `per ${food.per || 100} g`;
  return `per ${Number(food.per) === 1 ? '' : `${food.per} `}${food.base === 'piece' ? 'piece' : food.base}`;
}

// ---------- Store sections (for the shopping list) ----------

export const SECTIONS = [
  'Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Pantry', 'Spices', 'Frozen', 'Drinks', 'Snacks', 'Household', 'Other',
];

// Words that point to an aisle. The word that comes last in a name usually says
// what the thing is ("garlic powder" is a powder, "chicken stock" is stock),
// so the latest match wins, not the first.
const SECTION_WORDS = [
  ['Household', /\b(paper towels?|toilet paper|tissues|napkins|soap|detergent|dish ?washer|sponges?|trash bags?|bin bags?|garbage bags?|foil|cling film|plastic wrap|baking paper|parchment|shampoo|toothpaste|batteries)\b/g],
  ['Spices', /\b(salt|pepper ?corns?|cumin|paprika|cinnamon|oregano|thyme|curry|turmeric|nutmeg|spices?|seasoning|bay lea(f|ves)|vanilla|cayenne|powder|flakes|coriander|cardamom|allspice|cloves|garam masala|chipotle)\b/g],
  ['Frozen', /\bfrozen\b/g],
  ['Dairy & eggs', /\b(milk|cheeses?|cheddar|mozzarella|parmesan|feta|yog(h)?urts?|butter|cream|eggs?)\b/g],
  ['Meat & fish', /\b(chicken|beef|pork|turkey|lamb|bacon|sausages?|ham|steaks?|mince|meat|fish|salmon|tuna|cod|shrimps?|prawns?|chorizo|thighs?|breasts?|drumsticks?)\b/g],
  ['Bakery', /\b(bread|bagels?|tortillas?|buns?|rolls?|croissants?|pitas?|naan)\b/g],
  ['Drinks', /\b(juice|soda|coffee|tea|water|beer|wine)\b/g],
  ['Snacks', /\b(chips|crisps|cookies?|chocolate|candy|crackers?|popcorn)\b/g],
  ['Produce', /\b(apples?|bananas?|onions?|garlic|tomato(es)?|potato(es)?|carrots?|lettuce|spinach|kale|peppers?|lemons?|limes?|oranges?|berries|berry|strawberr(y|ies)|blueberr(y|ies)|avocados?|cucumbers?|broccoli|cauliflower|zucchinis?|courgettes?|mushrooms?|celery|cilantro|coriander leaves|parsley|basil|mint|ginger|grapes?|pears?|peach(es)?|cabbage|corn|scallions?|green onions?|leeks?|squash|jalape(n|ñ)os?|chil(e|i)s|shallots?|herbs?)\b/g],
  ['Pantry', /\b(rice|pasta|spaghetti|noodles?|flour|sugar|oil|vinegar|beans|lentils|chickpeas?|cans?|canned|sauce|paste|stock|broth|bouillon|cereal|oats|oatmeal|cheerios|honey|syrup|jam|nuts|almonds?|ketchup|mustard|mayo|mayonnaise|salsa|masa|cornmeal|cornstarch|baking soda|baking powder|cocoa)\b/g],
];

// Names that the last-word rule gets wrong.
const SECTION_PHRASES = [
  ['Spices', /\b((cayenne|black|white|ground|lemon) pepper|red pepper flakes|crushed red pepper|chil(i|li|e) powder|chil(i|li|e) flakes|italian seasoning|sea salt|kosher salt)\b/],
  ['Pantry', /\b((diced|crushed|canned|stewed|fire[- ]roasted|sun[- ]dried) tomato(es)?|tomato (paste|sauce|puree|purée)|(coconut|condensed|evaporated) milk|peanut butter|(beef|chicken|vegetable|fish) (stock|broth|bouillon)|stock cubes?|baking (soda|powder)|corn ?(starch|meal|flour)|cocoa (powder)?|(soy|hot|fish|worcestershire|bbq|barbecue) sauce|(olive|vegetable|canola|sesame|coconut) oil|chil(i|li|e) beans|refried beans|tortilla chips|chipotles? in adobo)\b/],
  ['Produce', /\b((lemon|lime) (juice|zest))\b/],
  ['Dairy & eggs', /\b(sour cream|cream cheese|heavy cream|whipping cream|half and half|greek yog(h)?urt)\b/],
  ['Produce', /\b(bell peppers?|chil(i|li|e) peppers?|green chil(e|i)s?|red chil(e|i)s?|garlic cloves?|cloves? (of )?garlic|fresh (herbs|thyme|rosemary|oregano|dill|sage|coriander))\b/],
];

// "minced garlic" is garlic: describing words don't count.
const PREP_WORDS = /\b(minced|chopped|diced|sliced|grated|shredded|crushed|dried|large|small|medium|finely|roughly|thinly|freshly|peeled|organic|boneless|skinless|raw|cooked|lean|extra|virgin)\b/g;

function guessOne(text) {
  const s = String(text || '').toLowerCase().replace(/[()]/g, ' ');
  for (const [section, re] of SECTION_PHRASES) if (re.test(s)) return section;
  const plain = s.replace(PREP_WORDS, ' ');
  let best = null;
  for (const [section, re] of SECTION_WORDS) {
    re.lastIndex = 0;
    for (const m of plain.matchAll(re)) {
      if (!best || m.index >= best.at) best = { section, at: m.index };
    }
  }
  return best ? best.section : 'Other';
}

// The store aisle for a name. "Beef, ground, raw" (food database style) goes by the part before the comma.
export function guessSection(name) {
  const s = String(name || '');
  if (s.includes(',')) {
    const first = guessOne(s.split(',')[0]);
    if (first !== 'Other') return first;
  }
  return guessOne(s);
}

// A saved food's aisle: the one you picked, else today's best guess from its name.
export function foodSection(food) {
  if (food.sectionSet && food.section) return food.section;
  const g = guessSection(food.name);
  return g !== 'Other' ? g : (food.section || 'Other');
}

// ---------- Foods from the online databases ----------

const round1 = (v) => (v == null || !Number.isFinite(Number(v)) ? undefined : Math.round(Number(v) * 10) / 10);

// Open Food Facts product -> food
export function fromOpenFoodFacts(p) {
  const n = p.nutriments || {};
  let cal = n['energy-kcal_100g'];
  if (cal == null && n.energy_100g != null) cal = Number(n.energy_100g) / 4.184; // kJ
  const nutrition = {
    cal: round1(cal), protein: round1(n.proteins_100g), carbs: round1(n.carbohydrates_100g),
    fat: round1(n.fat_100g), sugar: round1(n.sugars_100g), fiber: round1(n.fiber_100g),
  };
  for (const k of Object.keys(nutrition)) if (nutrition[k] === undefined) delete nutrition[k];
  const name = (p.product_name || p.generic_name || '').trim() || `Product ${p.code}`;
  const food = {
    name,
    brand: String(p.brands || '').split(',')[0].trim(),
    source: 'off',
    sourceId: String(p.code || ''),
    barcode: String(p.code || ''),
    base: 'g',
    per: 100,
    nutrition,
    portions: [],
    section: guessSection(name) !== 'Other' ? guessSection(name) : guessSection(p.categories || ''),
  };
  const sq = Number(p.serving_quantity);
  if (sq > 0) {
    food.serving = { qty: sq, unit: 'g' };
    food.portions.push({ unit: 'serving', grams: sq });
  }
  return food;
}

const USDA_KEYS = {
  cal: { numbers: ['208', '957', '958'], names: [/^energy/i], unit: 'KCAL' },
  protein: { numbers: ['203'], names: [/^protein/i] },
  carbs: { numbers: ['205'], names: [/^carbohydrate, by difference/i, /^carbohydrate/i] },
  fat: { numbers: ['204'], names: [/^total lipid/i, /^total fat/i] },
  sugar: { numbers: ['269', '269.3'], names: [/^sugars, total/i, /^total sugars/i, /^sugars/i] },
  fiber: { numbers: ['291'], names: [/^fiber, total dietary/i, /^fiber/i] },
};

function usdaValue(list, spec) {
  const ok = (x) => !spec.unit || String(x.unitName || x.nutrient?.unitName || '').toUpperCase() === spec.unit;
  const num = (x) => String(x.nutrientNumber ?? x.nutrient?.number ?? '');
  const name = (x) => String(x.nutrientName ?? x.nutrient?.name ?? '');
  const val = (x) => x.value ?? x.amount;
  for (const n of spec.numbers) {
    const hit = list.find((x) => num(x) === n && ok(x) && val(x) != null);
    if (hit) return val(hit);
  }
  for (const re of spec.names) {
    const hit = list.find((x) => re.test(name(x)) && ok(x) && val(x) != null);
    if (hit) return val(hit);
  }
  return undefined;
}

// USDA FoodData Central result -> food (USDA numbers are per 100 g)
export function fromUsda(f) {
  const list = f.foodNutrients || [];
  const nutrition = {};
  for (const [k, spec] of Object.entries(USDA_KEYS)) {
    const v = round1(usdaValue(list, spec));
    if (v !== undefined) nutrition[k] = v;
  }
  const portions = [];
  for (const m of f.foodMeasures || f.foodPortions || []) {
    const grams = Number(m.gramWeight);
    let text = String(m.disseminationText || m.portionDescription || m.modifier || '').trim();
    if (!(grams > 0) || !text || /quantity not specified/i.test(text)) continue;
    // "1 cup, chopped" -> unit "cup"; "1 large" -> "large"
    const mm = text.match(/^([\d./\s]+)?\s*(.*)$/);
    const amount = Number(eval_fraction(mm[1])) || 1;
    text = (mm[2] || '').split(',')[0].trim();
    if (!text) continue;
    const unit = normUnit(text);
    if (!portions.some((p) => p.unit === unit)) portions.push({ unit, grams: Math.round((grams / amount) * 10) / 10 });
  }
  const name = titleCase(String(f.description || '').trim());
  return {
    name,
    brand: String(f.brandOwner || f.brandName || '').trim(),
    source: 'usda',
    sourceId: String(f.fdcId || ''),
    barcode: String(f.gtinUpc || ''),
    base: 'g',
    per: 100,
    nutrition,
    portions: portions.slice(0, 8),
    section: guessSection(name),
  };
}

function eval_fraction(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  const f = t.match(/^(\d+)\/(\d+)$/);
  if (f) return Number(f[1]) / Number(f[2]);
  return Number(t);
}

// "CHICKEN, THIGH, RAW" -> "Chicken, thigh, raw"
function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  const low = s.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}

// ---------- Older saved foods ----------

// Foods saved before the food list existed stored numbers for one amount
// ("100 g Cheerios = 380 kcal"). Turn them into numbers per 100 g, or per piece.
export function upgradeFood(f) {
  if (f.base) return f;
  const out = {
    id: f.id || uid(), name: f.name, brand: '', source: 'manual', sourceId: '',
    portions: [], section: guessSection(f.name), updatedAt: f.updatedAt || Date.now(),
  };
  const qty = f.amount ?? 1;
  const grams = plainGrams(qty, f.unit);
  const scale = (factor) => {
    const n = {};
    for (const k of Object.keys(f.nutrition || {})) {
      const v = f.nutrition[k];
      if (v != null && v !== '') n[k] = Math.round(Number(v) * factor * 10) / 10;
    }
    return n;
  };
  if (grams) {
    out.base = 'g';
    out.per = 100;
    out.nutrition = scale(100 / grams);
  } else {
    out.base = normUnit(f.unit) || 'piece';
    out.per = 1;
    out.nutrition = scale(1 / (qty || 1));
  }
  out.serving = { qty, unit: f.unit || '' };
  out.price = f.cost != null && f.cost !== '' ? { amount: Number(f.cost), qty, unit: f.unit || '' } : null;
  return out;
}

// A food typed by hand on a day ("2 cookies = 160 kcal, $1") -> a food for the list.
export function foodFromAmount({ name, amount, unit, nutrition, cost }) {
  return upgradeFood({ name, amount, unit, nutrition, cost });
}
