// The shopping list: everything the planned meals need over a few days.
// Each batch is bought once, on the day it's cooked, however many days its leftovers last.
// Pure functions, so they can be tested.
import { addDays, daysBetween } from './dates.js';
import {
  dayEntries, findFood, findRecipe, fmtQty, getFood,
} from './model.js';
import {
  guessSection, isMass, isVolume, normUnit, plainGrams, priceFor, toBase,
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

// "1 can + 2 cups", or a single total when the units can be added up.
export function amountText(parts, food) {
  const withQty = parts.filter((p) => p.qty != null && Number.isFinite(p.qty));
  if (!withQty.length) return '';
  const units = [...new Set(withQty.map((p) => normUnit(p.unit)))];
  if (units.length === 1) {
    const sum = withQty.reduce((s, p) => s + p.qty, 0);
    return [fmtQty(sum), withQty[0].unit].filter(Boolean).join(' ');
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
    const same = withQty.filter((p) => normUnit(p.unit) === u);
    return [fmtQty(same.reduce((s, p) => s + p.qty, 0)), same[0].unit].filter(Boolean).join(' ');
  }).join(' + ');
}

function weightText(g) {
  return g >= 1000 ? `${fmtQty(Math.round(g / 10) / 100)} kg` : `${Math.round(g)} g`;
}
function volumeText(ml) {
  return ml >= 1000 ? `${fmtQty(Math.round(ml / 10) / 100)} l` : `${Math.round(ml)} ml`;
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

  for (const date of daysBetween(from, to)) {
    for (const e of dayEntries(state, date)) {
      if (e.type === 'cook') {
        const r = findRecipe(state, e.recipeId);
        if (!r) continue;
        const scale = Number(e.scale) || 1;
        if (!recipes.has(r.id)) recipes.set(r.id, { recipe: r, cooks: [] });
        recipes.get(r.id).cooks.push({ date, scale });
        for (const ing of r.ingredients || []) {
          if (!String(ing.name || '').trim()) continue;
          const food = (ing.foodId && getFood(state, ing.foodId)) || findFood(state, ing.name);
          const key = food ? `f:${food.id}` : `n:${singular(norm(shopName(ing.name)))}`;
          add(key, { name: food ? food.name : shopName(ing.name), food }, {
            qty: ing.qty == null ? null : ing.qty * scale,
            unit: ing.unit || '',
            recipeId: r.id,
            date,
            text: ing.name,
          });
        }
      } else if (e.type === 'food') {
        const food = e.foodId ? getFood(state, e.foodId) : findFood(state, e.name);
        const key = food ? `f:${food.id}` : `n:${singular(norm(e.name))}`;
        add(key, { name: food ? food.name : e.name, food }, {
          qty: e.amount ?? null, unit: e.unit || '', recipeId: null, date, text: e.name,
        });
      }
    }
  }

  const checked = state.shopping?.checked || {};
  const list = [...items.values()].map((it) => {
    const { food } = it;
    // Ticked off earlier: bought for everything cooked up to `upto`.
    // Meals planned after that still need buying, so only those show.
    const check = checked[it.key];
    let done = false;
    let boughtSome = false;
    if (check) {
      const later = it.parts.filter((p) => p.date > check.upto);
      if (!later.length) done = true;
      else if (later.length < it.parts.length) { boughtSome = true; it.parts = later; }
    }
    let cost = null;
    if (food) {
      let sum = 0;
      let ok = true;
      for (const p of it.parts) {
        const c = p.qty == null ? null : priceFor(food, p.qty, p.unit);
        if (c == null) { ok = false; break; }
        sum += c;
      }
      if (ok) cost = Math.round(sum * 100) / 100;
    }
    return {
      key: it.key,
      name: it.name,
      food: food || null,
      section: food?.section || guessSection(it.name),
      amount: amountText(it.parts, food),
      cost,
      recipes: [...it.recipes],
      hasFoods: it.parts.some((p) => !p.recipeId),
      parts: it.parts,
      done,
      boughtSome,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    items: list,
    recipes: [...recipes.values()].sort((a, b) => a.recipe.name.localeCompare(b.recipe.name)),
    cost: list.filter((i) => !i.done).reduce((s, i) => s + (i.cost || 0), 0),
    unpriced: list.filter((i) => !i.done && i.cost == null).length,
  };
}

// Tick an item off (or back on). `to` is the last day of the list it was ticked on.
export function setChecked(state, key, on, to) {
  if (!state.shopping) state.shopping = { checked: {}, extras: [] };
  if (on) state.shopping.checked[key] = { upto: to };
  else delete state.shopping.checked[key];
}

// Ticks for meals that are all in the past are no longer needed.
export function pruneChecks(state, today) {
  const checked = state.shopping?.checked || {};
  for (const [k, v] of Object.entries(checked)) if (!v || v.upto < today) delete checked[k];
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
