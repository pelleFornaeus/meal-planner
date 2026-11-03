// "Auto-plan my week" and "Use it up". Pure functions, so they can be tested.
import { addDays } from './dates.js';
import { costPerServing, dayEntries, perServing, servingsOf } from './model.js';
import { itemKey, pantryFor } from './shopping.js';
import { lastCooked } from './extras.js';

const DAY = 86400000;
const daysApart = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

// Ingredient keys of a recipe, the same way the shopping list adds them up.
function ingredientKeys(state, r) {
  return new Set((r.ingredients || []).filter((i) => String(i.name || '').trim()).map((i) => itemKey(state, i.name, i.foodId)));
}

// Pantry items that need using soon (or have no date but aren't staples).
export function useSoon(state, today, withinDays = 4) {
  return (state.pantry || [])
    .filter((p) => !p.staple && p.until && daysApart(today, p.until) <= withinDays)
    .sort((a, b) => a.until.localeCompare(b.until));
}

// Recipes that use things from the pantry, best first. Expiring things count more.
export function useItUp(state, today, { limit = 6 } = {}) {
  const soon = new Set(useSoon(state, today).map((p) => p.id));
  const out = [];
  for (const r of state.recipes) {
    const uses = [];
    for (const ing of r.ingredients || []) {
      if (!String(ing.name || '').trim()) continue;
      const p = pantryFor(state, { key: itemKey(state, ing.name, ing.foodId), name: ing.name });
      if (p && !p.staple && !uses.includes(p)) uses.push(p);
    }
    if (!uses.length) continue;
    const urgent = uses.filter((p) => soon.has(p.id));
    out.push({ recipe: r, uses, urgent, score: urgent.length * 3 + uses.length });
  }
  return out.sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name)).slice(0, limit);
}

// Plans the empty meals on `days` for the meals in `slots`.
//   fits(recipe, slotId) -> whether a recipe suits that meal
//   options: leftovers (cook once, eat again), budget (for the whole plan), random
export function autoPlan(state, { days, slots, today, fits, leftovers = true, budget = null, random = Math.random }) {
  const cells = [];
  for (const date of days) {
    for (const slot of slots) {
      if (!dayEntries(state, date, slot).length) cells.push({ date, slot });
    }
  }
  const recipes = state.recipes.filter((r) => (r.ingredients || []).length || (r.nutrition && r.nutrition.cal != null));
  const pool = recipes.length ? recipes : state.recipes;
  const goals = state.settings.goals || {};
  const perMealCal = goals.cal ? Number(goals.cal) / Math.max(1, slots.length) : null;
  const perMealBudget = budget ? budget / Math.max(1, cells.length) : null;
  const soonIds = new Set(useSoon(state, today).map((p) => p.id));
  const keysOf = new Map(pool.map((r) => [r.id, ingredientKeys(state, r)]));
  const pantryUse = new Map(pool.map((r) => {
    let n = 0;
    for (const ing of r.ingredients || []) {
      const p = String(ing.name || '').trim() && pantryFor(state, { key: itemKey(state, ing.name, ing.foodId), name: ing.name });
      if (p && !p.staple) n += soonIds.has(p.id) ? 2 : 0.5;
    }
    return [r.id, n];
  }));

  const plan = [];
  const chosen = new Map(); // recipeId -> times cooked in this plan
  const usedKeys = new Set();
  const batches = []; // { index, recipeId, date, slot, left }

  for (const cell of cells) {
    // Leftovers first: a batch cooked in the last 3 days with portions left.
    if (leftovers) {
      const b = batches.find((x) => x.left >= 1 && x.date < cell.date && daysApart(x.date, cell.date) <= 3
        && (x.slot === cell.slot || fits(findById(pool, x.recipeId), cell.slot)));
      if (b) {
        b.left -= 1;
        plan.push({ ...cell, type: 'leftover', recipeId: b.recipeId, from: b.index });
        continue;
      }
    }
    const options = pool.filter((r) => fits(r, cell.slot));
    const list = options.length ? options : pool;
    if (!list.length) break;
    let best = null;
    let bestScore = -Infinity;
    for (const r of list) {
      let score = 1 + random() * 0.8;
      if (r.favorite) score += 0.8;
      if (r.rating) score += (r.rating - 3) * 0.3;
      const last = lastCooked(state, r.id, today);
      if (last && daysApart(last, today) < 7) score -= 0.8;
      score -= (chosen.get(r.id) || 0) * 3; // variety
      // Shares ingredients with what's already planned: less waste.
      let shared = 0;
      for (const k of keysOf.get(r.id) || []) if (usedKeys.has(k)) shared += 1;
      score += Math.min(shared, 4) * 0.3;
      score += pantryUse.get(r.id) || 0;
      const cps = costPerServing(r);
      if (perMealBudget && cps != null) score -= Math.max(0, cps / perMealBudget - 1) * 1.5;
      const cal = perServing(r).cal;
      if (perMealCal && cal != null && cal !== '') score -= Math.min(1.5, Math.abs(Number(cal) - perMealCal) / perMealCal);
      if (score > bestScore) { best = r; bestScore = score; }
    }
    chosen.set(best.id, (chosen.get(best.id) || 0) + 1);
    for (const k of keysOf.get(best.id) || []) usedKeys.add(k);
    const index = plan.length;
    plan.push({ ...cell, type: 'cook', recipeId: best.id });
    const portions = servingsOf(best);
    if (leftovers && portions > 1) batches.push({ index, recipeId: best.id, date: cell.date, slot: cell.slot, left: Math.min(portions - 1, 3) });
  }
  return plan;
}

function findById(list, id) { return list.find((r) => r.id === id); }

// Cost and calories of a suggested plan, for the preview.
export function planTotals(state, plan) {
  let cost = 0;
  let cal = 0;
  let unpriced = 0;
  const days = new Set();
  for (const p of plan) {
    const r = state.recipes.find((x) => x.id === p.recipeId);
    if (!r) continue;
    days.add(p.date);
    const cps = costPerServing(r);
    if (cps != null) cost += cps; else unpriced += 1;
    const c = perServing(r).cal;
    if (c != null && c !== '') cal += Number(c);
  }
  return { cost, cal, days: days.size, unpriced };
}

export function weekDays(from, today) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    if (d >= today) out.push(d);
  }
  return out;
}
