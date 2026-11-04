import test from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, defaultState } from '../js/model.js';
import { autoPlan, planTotals, useItUp, useSoon } from '../js/planner.js';

function kitchen() {
  const s = defaultState();
  const r = (id, name, servings, ings, extra = {}) => s.recipes.push({ id, name, servings, tags: [], steps: [], nutrition: { cal: 600 }, cost: 12, ingredients: ings.map((n) => ({ name: n, qty: 1, unit: '' })), ...extra });
  r('chili', 'Chili', 4, ['ground beef', 'beans', 'onion']);
  r('tacos', 'Tacos', 2, ['ground beef', 'tortillas', 'onion']);
  r('soup', 'Spinach soup', 2, ['spinach', 'onion', 'stock']);
  r('pasta', 'Pasta', 2, ['pasta', 'tomato']);
  return s;
}
const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
const fits = () => true;

test('auto plan fills empty meals, with leftovers and variety', () => {
  const s = kitchen();
  addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'pasta' });
  const plan = autoPlan(s, { days, slots: ['dinner'], today: '2026-11-02', fits, random: () => 0.5 });
  assert.equal(plan.length, 3, 'Monday already has dinner');
  assert.equal(plan[0].type, 'cook');
  const leftovers = plan.filter((p) => p.type === 'leftover');
  assert.ok(leftovers.length >= 1);
  assert.equal(plan[leftovers[0].from].recipeId, leftovers[0].recipeId);
  const cooks = plan.filter((p) => p.type === 'cook').map((p) => p.recipeId);
  assert.equal(new Set(cooks).size, cooks.length, 'no repeats');
  assert.ok(planTotals(s, plan).cost > 0);
});

test('without leftovers every meal is cooked', () => {
  const s = kitchen();
  const plan = autoPlan(s, { days, slots: ['dinner'], today: '2026-11-02', fits, leftovers: false, random: () => 0.5 });
  assert.equal(plan.length, 4);
  assert.ok(plan.every((p) => p.type === 'cook'));
});

test('use it up suggests recipes for things that expire soon', () => {
  const s = kitchen();
  s.pantry.push({ id: 'p1', name: 'Spinach', staple: false, until: '2026-11-03' });
  s.pantry.push({ id: 'p2', name: 'Onion', staple: true });
  assert.deepEqual(useSoon(s, '2026-11-02').map((p) => p.name), ['Spinach']);
  const ideas = useItUp(s, '2026-11-02');
  assert.equal(ideas[0].recipe.id, 'soup');
  assert.equal(ideas.length, 1, 'staples do not count');
  const plan = autoPlan(s, { days: days.slice(0, 1), slots: ['dinner'], today: '2026-11-02', fits, random: () => 0.5 });
  assert.equal(plan[0].recipeId, 'soup', 'the plan uses up the spinach');
});
