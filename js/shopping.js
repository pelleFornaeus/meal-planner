// The shopping list: everything the planned meals need over a few days.
// Each batch is bought once, on the day it's cooked, however many days its leftovers last.
// Pure functions, so they can be tested.
import { addDays, daysBetween } from './dates.js';
import {
  dayEntries, findFood, findRecipe, fmtQty, getFood, splitPackSize,
} from './model.js';
import {
  foodSection, guessSection, isMass, isVolume, normUnit, plainGrams, priceFor, toBase,
} from './foods.js';

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\|/g, ' ').replace(/\s+/g, ' ');

// The shopping name of an ingredient: "onion, chopped" -> "onion"
function shopName(name) {
  return String(name || '').replace(/\(.*?\)/g, '').split(',')[0].trim() || String(name || '').trim();
}

// "onions" and "onion" are the same thing on a shopping list.
function singular(name) {
  return name.split(' ').map((w, i, all) => {
    if (i !== all.length - 1 || w.length < 4) return w;
    if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
    if (/oes$/.test(w)) return w.slice(0, -2);
    if (/[^su]s$/.test(w)) return w.slice(0, -1);
    return w;
  }).join(' ');
}

// The shopping-list key for a name (and food, when it's linked to one).
export function itemKey(state, name, foodId) {
  const food = (foodId && getFood(state, foodId)) || findFood(state, name);
  return food ? `f:${food.id}` : `n:${singular(norm(shopName(name)))}`;
}

// The pantry item that covers a shopping list item, if any.
export function pantryFor(state, item) {
  const n = `n:${singular(norm(shopName(item.name)))}`;
  return (state.pantry || []).find((p) => p.key === item.key || itemKey(state, p.name, p.foodId) === item.key || `n:${singular(norm(shopName(p.name)))}` === n) || null;
}

// "1 can + 2 cups", or a single total when the units can be added up.
export function amountText(parts, food) {
  const withQty = parts.filter((p) => p.qty != null && Number.isFinite(p.qty));
  if (!withQty.length) return '';
  const groupOf = (p) => `${normUnit(p.unit)}|${p.size || ''}`;
  const units = [...new Set(withQty.map(groupOf))];
  if (units.length === 1) {
    const sum = withQty.reduce((s, p) => s + p.qty, 0);
    return packText(sum, withQty[0]);
  }
  // Packages of a set size ("2 cans (28 oz each)") are listed as they are.
  if (withQty.some((p) => p.size)) {
    return units.map((u) => {
      const same = withQty.filter((p) => groupOf(p) === u);
      return packText(same.reduce((s, p) => s + p.qty, 0), same[0]);
    }).join(' + ');
  }
  // Different units: add them up by weight (or volume) when we can.
  if (food) {
    const base = withQty.map((p) => toBase(food, p.qty, p.unit));
    if (base.every((b) => b != null) && (!food.base || food.base === 'g')) {
      const allVolume = withQty.every((p) => isVolume(p.unit));
      const total = base.reduce((s, b) => s + b, 0);
      return allVolume ? volumeText(total / (Number(food.density) || 1)) : weightText(total);
    }
  } else if (withQty.every((p) => isMass(p.unit))) {
    return weightText(withQty.reduce((s, p) => s + plainGrams(p.qty, p.unit), 0));
  } else if (withQty.every((p) => isVolume(p.unit))) {
    return volumeText(withQty.reduce((s, p) => s + plainGrams(p.qty, p.unit), 0));
  }
  // Otherwise list each unit's total.
  return units.map((u) => {
    const same = withQty.filter((p) => groupOf(p) === u);
    return [fmtQty(same.reduce((s, p) => s + p.qty, 0)), same[0].unit].filter(Boolean).join(' ');
  }).join(' + ');
}

// "2 cans (28 oz each)", "1 can (15 oz)", "500 g"
function packText(qty, part) {
  let unit = part.unit || '';
  if (part.size && unit) unit = qty > 1 ? plural(unit) : singularWord(unit);
  const base = [fmtQty(qty), unit].filter(Boolean).join(' ');
  return part.size ? `${base} (${part.size}${qty > 1 ? ' each' : ''})` : base;
}
const plural = (w) => (/s$/.test(w) ? w : /(x|ch)$/.test(w) ? `${w}es` : `${w}s`);
const singularWord = (w) => w.replace(/(xes|ches)$/, (m) => m.slice(0, -2)).replace(/([^s])s$/, '$1');

function weightText(g) {
  return g >= 1000 ? `${fmtQty(Math.round(g / 10) / 100)} kg` : `${Math.round(g)} g`;
}
function volumeText(ml) {
  return ml >= 1000 ? `${fmtQty(Math.round(ml / 10) / 100)} l` : `${Math.round(ml)} ml`;
}

// An ingredient with its package size taken out of the name.
function packed(ing) {
  const p = splitPackSize(ing);
  if (!p.size) return { ing, size: '' };
  return { ing: { ...ing, unit: p.unit, name: p.name }, size: p.size };
}

// The batches cooked between from and to, and foods added to those days.
export function shoppingList(state, from, to) {
  const items = new Map();
  const recipes = new Map(); // recipeId -> { recipe, cooks: [{date, scale}] }
  const add = (key, fields, part) => {
    if (!items.has(key)) items.set(key, { key, parts: [], recipes: new Set(), ...fields });
    const it = items.get(key);
    it.parts.push(part);
    if (part.recipeId) it.recipes.add(part.recipeId);
  };

  // Planned meals taken off the list: "<date>|<entryId>" -> true
  const skip = state.shopping?.skip || {};
  const skipped = [];
  const foodRefs = [];
  for (const date of daysBetween(from, to)) {
    for (const e of dayEntries(state, date)) {
      const ref = `${date}|${e.id}`;
      if ((e.type === 'cook' || e.type === 'food') && skip[ref]) { skipped.push(ref); continue; }
      if (e.type === 'cook') {
        const r = findRecipe(state, e.recipeId);
        if (!r) continue;
        const scale = Number(e.scale) || 1;
        if (!recipes.has(r.id)) recipes.set(r.id, { recipe: r, cooks: [] });
        recipes.get(r.id).cooks.push({ date, scale, ref });
        for (const raw of r.ingredients || []) {
          if (!String(raw.name || '').trim()) continue;
          const { ing, size } = packed(raw);
          const food = (ing.foodId && getFood(state, ing.foodId)) || findFood(state, ing.name);
          const key = food ? `f:${food.id}` : `n:${singular(norm(shopName(ing.name)))}`;
          add(key, { name: food ? food.name : shopName(ing.name), food }, {
            qty: ing.qty == null ? null : ing.qty * scale,
            unit: ing.unit || '',
            size,
            recipeId: r.id,
            date,
            text: ing.name,
          });
        }
      } else if (e.type === 'food') {
        foodRefs.push(ref);
        const food = e.foodId ? getFood(state, e.foodId) : findFood(state, e.name);
        const key = food ? `f:${food.id}` : `n:${singular(norm(e.name))}`;
        add(key, { name: food ? food.name : e.name, food }, {
          qty: e.amount ?? null, unit: e.unit || '', recipeId: null, date, text: e.name,
        });
      }
    }
  }

  // Recipes added to the list without planning them. They're on every list until removed.
  const adds = state.shopping?.recipes || [];
  for (const a of adds) {
    const r = findRecipe(state, a.recipeId);
    if (!r) continue;
    const scale = Number(a.scale) || 1;
    if (!recipes.has(r.id)) recipes.set(r.id, { recipe: r, cooks: [] });
    recipes.get(r.id).cooks.push({ date: null, scale, addId: a.id });
    for (const raw of r.ingredients || []) {
      if (!String(raw.name || '').trim()) continue;
      const { ing, size } = packed(raw);
      const food = (ing.foodId && getFood(state, ing.foodId)) || findFood(state, ing.name);
      const key = food ? `f:${food.id}` : `n:${singular(norm(shopName(ing.name)))}`;
      add(key, { name: food ? food.name : shopName(ing.name), food }, {
        qty: ing.qty == null ? null : ing.qty * scale,
        unit: ing.unit || '',
        size,
        recipeId: r.id,
        date: null,
        addId: a.id,
        text: ing.name,
      });
    }
  }
  const addById = new Map(adds.map((a) => [a.id, a]));

  const checked = state.shopping?.checked || {};
  const list = [...items.values()].map((it) => {
    const { food } = it;
    // Ticked off earlier: bought for everything cooked up to `upto`.
    // Meals planned after that still need buying, so only those show.
    // Unplanned recipes remember their own ticks.
    const check = checked[it.key];
    let done = false;
    let boughtSome = false;
    const left = it.parts.filter((p) => (p.addId
      ? !addById.get(p.addId)?.bought?.[it.key]
      : !(check && p.date <= check.upto)));
    if (!left.length) done = true;
    else if (left.length < it.parts.length) { boughtSome = true; it.parts = left; }
    // Cleared from the Bought list: every tick behind it was cleared.
    const ticks = [
      ...(it.parts.some((p) => !p.addId) && check ? [check] : []),
      ...[...new Set(it.parts.filter((p) => p.addId).map((p) => p.addId))].map((id) => addById.get(id)?.bought?.[it.key]),
    ];
    const cleared = done && ticks.length > 0 && ticks.every((t) => t === 'cleared' || t?.cleared);
    let cost = null;
    if (food) {
      let sum = 0;
      let ok = true;
      for (const p of it.parts) {
        const sz = p.size ? p.size.match(/^([\d.]+)\s+(.+)$/) : null;
        const c = p.qty == null ? null : sz ? priceFor(food, p.qty * Number(sz[1]), sz[2]) : priceFor(food, p.qty, p.unit);
        if (c == null) { ok = false; break; }
        sum += c;
      }
      if (ok) cost = Math.round(sum * 100) / 100;
    }
    return {
      key: it.key,
      name: it.name,
      food: food || null,
      section: food ? foodSection(food) : (state.shopping?.sections?.[it.key] || guessSection(it.name)),
      amount: amountText(it.parts, food),
      cost,
      recipes: [...it.recipes],
      hasFoods: it.parts.some((p) => !p.recipeId),
      parts: it.parts,
      done,
      cleared,
      boughtSome,
      atHome: null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Things you already have at home don't need buying.
  for (const it of list) {
    const p = pantryFor(state, it);
    if (p) it.atHome = p;
  }
  const toBuy = list.filter((i) => !i.atHome);
  return {
    items: list,
    recipes: [...recipes.values()].sort((a, b) => a.recipe.name.localeCompare(b.recipe.name)),
    skipped,
    foodRefs,
    cost: toBuy.filter((i) => !i.done).reduce((s, i) => s + (i.cost || 0), 0),
    unpriced: toBuy.filter((i) => !i.done && i.cost == null).length,
  };
}

// Tick an item off (or back on). `to` is the last day of the list it was ticked on.
export function setChecked(state, key, on, to) {
  if (!state.shopping) state.shopping = { checked: {}, extras: [] };
  if (on) state.shopping.checked[key] = { upto: to };
  else delete state.shopping.checked[key];
  for (const a of state.shopping.recipes || []) {
    if (on) a.bought = { ...(a.bought || {}), [key]: true };
    else if (a.bought?.[key]) { a.bought = { ...a.bought }; delete a.bought[key]; }
  }
}

// Take planned meals off the shopping list (the plan stays as it is), or put them back.
export function skipMeals(state, refs, on = true) {
  if (!state.shopping) state.shopping = { checked: {}, extras: [] };
  if (!state.shopping.skip) state.shopping.skip = {};
  for (const ref of refs) {
    if (on) state.shopping.skip[ref] = true;
    else delete state.shopping.skip[ref];
  }
}

// Take one recipe off the list: its planned batches in these days and any unplanned copies.
export function removeRecipeFromShopping(state, recipeId, from, to) {
  const rec = shoppingList(state, from, to).recipes.find((x) => x.recipe.id === recipeId);
  skipMeals(state, (rec?.cooks || []).filter((c) => c.ref).map((c) => c.ref));
  if (state.shopping.recipes) state.shopping.recipes = state.shopping.recipes.filter((a) => a.recipeId !== recipeId);
}

// Empty the list for these days: planned meals are taken off (not deleted from the plan),
// unplanned recipes and extra items are removed.
export function clearShopping(state, from, to) {
  const list = shoppingList(state, from, to);
  skipMeals(state, [...list.recipes.flatMap((x) => x.cooks.filter((c) => c.ref).map((c) => c.ref)), ...list.foodRefs]);
  state.shopping.recipes = [];
  state.shopping.extras = [];
}

// Empty the Bought list. The items stay bought (they don't come back on the list),
// they just aren't shown any more. Ticked extra items are removed.
export function clearBought(state, from, to) {
  const list = shoppingList(state, from, to);
  for (const it of list.items) {
    if (!it.done || it.cleared) continue;
    const check = state.shopping.checked[it.key];
    if (check) state.shopping.checked[it.key] = { ...check, cleared: true };
    for (const a of state.shopping.recipes || []) {
      if (a.bought?.[it.key]) a.bought = { ...a.bought, [it.key]: 'cleared' };
    }
  }
  state.shopping.extras = (state.shopping.extras || []).filter((x) => !x.checked);
}

// Move an item to another aisle. Saved foods remember it themselves.
export function setSection(state, item, section) {
  if (item.food) {
    item.food.section = section;
    item.food.sectionSet = true;
    item.food.updatedAt = Date.now();
    return;
  }
  if (!state.shopping.sections) state.shopping.sections = {};
  if (section === guessSection(item.name)) delete state.shopping.sections[item.key];
  else state.shopping.sections[item.key] = section;
}

// Put a recipe on the shopping list without planning it.
export function addRecipeToList(state, recipeId, scale = 1, id, today = '') {
  if (!state.shopping) state.shopping = { checked: {}, extras: [] };
  if (!state.shopping.recipes) state.shopping.recipes = [];
  const a = { id, recipeId, scale: Math.round((Number(scale) || 1) * 1000) / 1000, addedAt: today, bought: {} };
  state.shopping.recipes.push(a);
  return a;
}

export function removeRecipeFromList(state, addId) {
  if (!state.shopping?.recipes) return;
  state.shopping.recipes = state.shopping.recipes.filter((a) => a.id !== addId);
}

// Ticks for meals that are all in the past are no longer needed.
export function pruneChecks(state, today) {
  const checked = state.shopping?.checked || {};
  for (const [k, v] of Object.entries(checked)) if (!v || v.upto < today) delete checked[k];
  const skip = state.shopping?.skip || {};
  for (const k of Object.keys(skip)) if (k.split('|')[0] < today) delete skip[k];
}

export function defaultRange(today, days = 7) {
  return { from: today, to: addDays(today, days - 1) };
}

// A plain-text copy for Notes, Reminders or a message.
export function listText(groups) {
  return groups.map((g) => [
    g.title,
    ...g.items.map((i) => `- ${i.name}${i.amount ? ` (${i.amount})` : ''}`),
  ].join('\n')).join('\n\n');
}

// Things most kitchens always have, so a new pantry item starts as "always have".
export function guessStaple(name) {
  return /\b(salt|pepper|black pepper|olive oil|vegetable oil|oil|flour|sugar|baking (soda|powder)|vinegar|soy sauce|spices?|cumin|paprika|cinnamon|oregano|thyme|chili powder|curry powder|garlic powder|onion powder|stock cubes?|bouillon|honey|ketchup|mustard|mayo(nnaise)?|rice|pasta|water)\b/i.test(String(name || ''))
    && !/\b(bell|fresh)\b/i.test(String(name || ''));
}
