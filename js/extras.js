// Smaller helpers: copying a week, when a recipe was last cooked, "Surprise me",
// and timers found in recipe steps. Pure functions, so they can be tested.
import { addDays, daysBetween } from './dates.js';
import { dayEntries, refOf, uid } from './model.js';

// Copies every meal from the 7 days starting `from` to the 7 days starting `to`,
// on the same weekday and meal. Leftovers point at the copied batches.
export function copyWeek(state, from, to) {
  const shift = (d) => addDays(to, daysBetweenCount(from, d));
  const newRef = {};
  const copies = [];
  let order = 1000;
  for (const date of daysBetween(from, addDays(from, 6))) {
    for (const e of dayEntries(state, date)) {
      const c = { ...JSON.parse(JSON.stringify(e)), id: uid(), order: order++ };
      delete c.rating;
      newRef[refOf(date, e.id)] = refOf(shift(date), c.id);
      copies.push({ date: shift(date), entry: c });
    }
  }
  for (const { date, entry } of copies) {
    if (entry.type === 'leftover') {
      // Leftovers from a batch outside the copied week keep pointing at it.
      if (newRef[entry.from]) entry.from = newRef[entry.from];
    }
    if (!state.plan[date]) state.plan[date] = {};
    state.plan[date][entry.id] = entry;
  }
  return copies.length;
}

function daysBetweenCount(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

// Dates a recipe was cooked (batches), up to and including `upto`.
export function cookDates(state, recipeId, upto) {
  const out = [];
  for (const [date, day] of Object.entries(state.plan)) {
    if (upto && date > upto) continue;
    for (const e of Object.values(day)) if (e.type === 'cook' && e.recipeId === recipeId) out.push(date);
  }
  return out.sort();
}

export function lastCooked(state, recipeId, upto) {
  const d = cookDates(state, recipeId, upto);
  return d.length ? d[d.length - 1] : null;
}

// A random recipe, more likely if it's a favourite, rated well, or not cooked for a while.
export function pickSurprise(recipes, state, today, { exclude = [], random = Math.random } = {}) {
  const pool = recipes.filter((r) => !exclude.includes(r.id));
  const list = pool.length ? pool : recipes;
  if (!list.length) return null;
  const weights = list.map((r) => {
    let w = 1;
    if (r.favorite) w += 1.5;
    if (r.rating) w += (r.rating - 3) * 0.4;
    const last = lastCooked(state, r.id, today);
    const days = last ? daysBetweenCount(last, today) : 60;
    if (days < 4) w *= 0.25;
    else if (days > 21) w *= 1.5;
    return Math.max(0.05, w);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let x = random() * total;
  for (let i = 0; i < list.length; i++) {
    x -= weights[i];
    if (x <= 0) return list[i];
  }
  return list[list.length - 1];
}

// Times in a step: "simmer for 30 minutes", "bake 1 hour 15 min", "rest 10-15 mins".
const TIME_RE = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:[.,]\d+)?))?\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b(?:\s*(?:and\s*)?(\d+)\s*(minutes?|mins?|m)\b)?/gi;

export function stepTimers(text) {
  const out = [];
  for (const m of String(text || '').matchAll(TIME_RE)) {
    const unit = m[3].toLowerCase();
    // "1 m" or "2 s" with a space are too likely to be something else; "5m" is fine.
    if ((unit === 'm' || unit === 's' || unit === 'h') && !/\d[hms]\b/i.test(m[0])) continue;
    const n = Number((m[2] || m[1]).replace(',', '.'));
    let sec = unit.startsWith('h') ? n * 3600 : unit.startsWith('s') ? n : n * 60;
    if (m[4] && unit.startsWith('h')) sec += Number(m[4]) * 60;
    if (sec < 5 || sec > 24 * 3600) continue;
    out.push({ seconds: Math.round(sec), label: m[0].trim() });
  }
  return out;
}

export function clockText(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
