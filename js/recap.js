// "Year in food": what you cooked, ate and spent in a year. Pure functions, so they can be tested.
import { dayEntries, entryTotals, findRecipe } from './model.js';
import { itemKey } from './shopping.js';
import { addDays, daysBetween } from './dates.js';

export function yearRecap(state, year, today) {
  const from = `${year}-01-01`;
  const end = `${year}-12-31`;
  const to = end < today ? end : today;
  const months = Array.from({ length: 12 }, () => ({ cost: 0, meals: 0, cal: 0 }));
  const cooks = new Map(); // recipeId -> count
  const portions = new Map(); // recipeId -> portions eaten
  const ingredients = new Map(); // key -> { name, count }
  const firstCook = new Map();
  let meals = 0;
  let cost = 0;
  let cal = 0;
  let foods = 0;
  const days = new Set();
  if (from > to) return empty(year);
  for (const date of daysBetween(from, to)) {
    const list = dayEntries(state, date);
    if (!list.length) continue;
    days.add(date);
    const m = Number(date.slice(5, 7)) - 1;
    for (const e of list) {
      const t = entryTotals(state, e);
      meals += 1;
      months[m].meals += 1;
      if (t.cost != null) { cost += t.cost; months[m].cost += t.cost; }
      if (t.cal != null) { cal += t.cal; months[m].cal += t.cal; }
      if (e.type === 'food') { foods += 1; continue; }
      const r = findRecipe(state, e.recipeId);
      if (!r) continue;
      portions.set(r.id, (portions.get(r.id) || 0) + (Number(e.portions) || 1));
      if (e.type !== 'cook') continue;
      cooks.set(r.id, (cooks.get(r.id) || 0) + 1);
      if (!firstCook.has(r.id)) firstCook.set(r.id, date);
      for (const ing of r.ingredients || []) {
        if (!String(ing.name || '').trim() || /\b(salt|pepper|water|oil)\b/i.test(ing.name)) continue;
        const k = itemKey(state, ing.name, ing.foodId);
        const cur = ingredients.get(k) || { name: String(ing.name).split(',')[0].replace(/\(.*?\)/g, '').trim(), count: 0 };
        cur.count += 1;
        ingredients.set(k, cur);
      }
    }
  }
  // Recipes first cooked this year (never before it).
  const before = new Set();
  for (const [date, day] of Object.entries(state.plan)) {
    if (date >= from) continue;
    for (const e of Object.values(day)) if (e.type === 'cook') before.add(e.recipeId);
  }
  const top = [...cooks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, count]) => ({ recipe: findRecipe(state, id), count, portions: portions.get(id) || 0 }));
  const busiest = months.reduce((b, x, i) => (x.meals > months[b].meals ? i : b), 0);
  return {
    year,
    from,
    to,
    days: days.size,
    meals,
    batches: [...cooks.values()].reduce((s, n) => s + n, 0),
    cost,
    cal,
    foods,
    months,
    busiestMonth: meals ? busiest : null,
    topRecipes: top,
    topIngredients: [...ingredients.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    newRecipes: [...firstCook.keys()].filter((id) => !before.has(id)).map((id) => findRecipe(state, id)),
    topRated: state.recipes.filter((r) => r.rating && cooks.has(r.id)).sort((a, b) => b.rating - a.rating || (cooks.get(b.id) - cooks.get(a.id)))[0] || null,
  };
}

function empty(year) {
  return { year, days: 0, meals: 0, batches: 0, cost: 0, cal: 0, foods: 0, months: Array.from({ length: 12 }, () => ({ cost: 0, meals: 0, cal: 0 })), busiestMonth: null, topRecipes: [], topIngredients: [], newRecipes: [], topRated: null };
}

// Years that have anything planned, newest first (always includes this year).
export function recapYears(state, today) {
  const ys = new Set([today.slice(0, 4)]);
  for (const d of Object.keys(state.plan)) if (d <= today) ys.add(d.slice(0, 4));
  return [...ys].sort().reverse();
}

