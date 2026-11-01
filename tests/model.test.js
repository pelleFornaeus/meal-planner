import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addEntry, batchLeft, batchSize, dayTotals, defaultState, filterRecipes, foodFor, leftoversOf,
  moveEntry, openBatches, parseFoods, parseIngredient, parseQty, parseSteps, rangeTotals,
  rememberFood, removeEntry, refOf, getEntry, fmtQty, migrate,
} from '../js/model.js';
import { startOfWeek } from '../js/dates.js';

function withChili() {
  const s = defaultState();
  s.recipes.push({
    id: 'chili', name: 'Chili', servings: 4, tags: [], ingredients: [], steps: [],
    nutrition: { cal: 500, protein: 35 }, cost: 12,
  });
  return s;
}

test('quantities and ingredient lines', () => {
  assert.equal(parseQty('1 1/2'), 1.5);
  assert.equal(parseQty('½'), 0.5);
  assert.equal(parseQty('1½'), 1.5);
  assert.equal(parseQty('2,5'), 2.5);
  assert.equal(parseQty(''), null);
  assert.deepEqual(parseIngredient('2 1/2 cups flour'), { qty: 2.5, unit: 'cups', name: 'flour' });
  assert.deepEqual(parseIngredient('500g ground beef'), { qty: 500, unit: 'g', name: 'ground beef' });
  assert.deepEqual(parseIngredient('1 can kidney beans'), { qty: 1, unit: 'can', name: 'kidney beans' });
  assert.deepEqual(parseIngredient('3 eggs'), { qty: 3, unit: '', name: 'eggs' });
  assert.deepEqual(parseIngredient('- Salt to taste'), { qty: null, unit: '', name: 'Salt to taste' });
  assert.deepEqual(parseIngredient('2 large onions'), { qty: 2, unit: '', name: 'large onions' });
  assert.equal(fmtQty(0.5), '½');
  assert.equal(fmtQty(1.25), '1¼');
  assert.equal(fmtQty(3), '3');
});

test('quick-add foods and steps', () => {
  assert.deepEqual(parseFoods('100 g cheerios, 200ml milk'), [
    { name: 'cheerios', amount: 100, unit: 'g' },
    { name: 'milk', amount: 200, unit: 'ml' },
  ]);
  assert.deepEqual(parseFoods('banana'), [{ name: 'banana', amount: null, unit: '' }]);
  assert.deepEqual(parseSteps('1. Brown the beef\n\nStep 2: Add beans\n3) Simmer'), ['Brown the beef', 'Add beans', 'Simmer']);
});

test('saved foods scale to the amount typed', () => {
  const s = defaultState();
  rememberFood(s, { name: 'Cheerios', amount: 100, unit: 'g', nutrition: { cal: 380, protein: 12 }, cost: 0.8 });
  const { item, matched } = foodFor(s, { name: 'cheerios', amount: 50, unit: 'g' });
  assert.equal(matched, true);
  assert.equal(item.name, 'Cheerios');
  assert.equal(item.nutrition.cal, 190);
  assert.equal(item.cost, 0.4);
  // No amount: use the saved one.
  assert.equal(foodFor(s, { name: 'Cheerios', amount: null, unit: '' }).item.amount, 100);
  // Different unit can't be scaled.
  assert.equal(foodFor(s, { name: 'Cheerios', amount: 1, unit: 'cup' }).matched, false);
});

test('a batch is cooked once and eaten over several days', () => {
  const s = withChili();
  const cook = addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'chili' });
  assert.equal(batchSize(s, cook), 4);
  assert.equal(batchLeft(s, '2026-11-02', cook), 3);
  const open = openBatches(s, 'chili', '2026-11-04');
  assert.equal(open.length, 1);
  assert.equal(open[0].left, 3);
  addEntry(s, '2026-11-04', { type: 'leftover', slot: 'dinner', recipeId: 'chili', from: refOf('2026-11-02', cook.id) });
  addEntry(s, '2026-11-05', { type: 'leftover', slot: 'lunch', recipeId: 'chili', from: refOf('2026-11-02', cook.id), portions: 2 });
  assert.equal(batchLeft(s, '2026-11-02', cook), 0);
  assert.equal(openBatches(s, 'chili', '2026-11-06').length, 0);
  // Doubling the batch makes more room.
  cook.scale = 2;
  assert.equal(batchLeft(s, '2026-11-02', cook), 4);
  // A batch planned later doesn't count as available earlier.
  assert.equal(openBatches(s, 'chili', '2026-11-01').length, 0);
});

test('day and week totals count portions eaten, not batches cooked', () => {
  const s = withChili();
  const cook = addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'chili' });
  addEntry(s, '2026-11-04', { type: 'leftover', slot: 'dinner', recipeId: 'chili', from: refOf('2026-11-02', cook.id) });
  addEntry(s, '2026-11-02', { type: 'food', slot: 'breakfast', name: 'Cheerios', amount: 100, unit: 'g', nutrition: { cal: 380 }, cost: 0.8 });
  addEntry(s, '2026-11-02', { type: 'food', slot: 'snacks', name: 'Apple', nutrition: {} });
  const mon = dayTotals(s, '2026-11-02');
  assert.equal(mon.cal, 880);
  assert.equal(mon.cost, 3.8);
  assert.equal(mon.missingNutrition, 1);
  assert.equal(mon.missingCost, 1);
  const week = rangeTotals(s, '2026-11-02', '2026-11-08');
  assert.equal(week.total.cal, 1380);
  assert.equal(week.total.cost, 6.8);
  assert.equal(week.plannedDays, 2);
  assert.equal(week.cooks, 1);
});

test('removing a batch can keep its leftovers', () => {
  const s = withChili();
  const cook = addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'chili', scale: 1 });
  const a = addEntry(s, '2026-11-03', { type: 'leftover', slot: 'lunch', recipeId: 'chili', from: refOf('2026-11-02', cook.id) });
  const b = addEntry(s, '2026-11-04', { type: 'leftover', slot: 'lunch', recipeId: 'chili', from: refOf('2026-11-02', cook.id) });
  removeEntry(s, '2026-11-02', cook.id, { withLeftovers: false });
  assert.equal(getEntry(s, '2026-11-03', a.id).type, 'cook');
  assert.equal(getEntry(s, '2026-11-04', b.id).from, refOf('2026-11-03', a.id));
  assert.equal(s.plan['2026-11-02'], undefined);
  removeEntry(s, '2026-11-03', a.id, { withLeftovers: true });
  assert.deepEqual(s.plan, {});
});

test('moving a batch keeps its leftovers attached', () => {
  const s = withChili();
  const cook = addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'chili' });
  addEntry(s, '2026-11-04', { type: 'leftover', slot: 'dinner', recipeId: 'chili', from: refOf('2026-11-02', cook.id) });
  moveEntry(s, '2026-11-02', cook.id, '2026-11-03', 'lunch');
  assert.equal(leftoversOf(s, '2026-11-03', cook.id).length, 1);
  assert.equal(getEntry(s, '2026-11-03', cook.id).slot, 'lunch');
});

test('recipes filter by categories and sort', () => {
  const s = defaultState();
  const [meal, diff] = s.categories;
  const dinner = meal.options.find((o) => o.name === 'Dinner').id;
  const lunch = meal.options.find((o) => o.name === 'Lunch').id;
  const easy = diff.options.find((o) => o.name === 'Easy').id;
  s.recipes.push(
    { id: 'a', name: 'Chili', tags: [dinner, easy], servings: 4, cost: 12, nutrition: { protein: 30 } },
    { id: 'b', name: 'Salad', tags: [lunch, easy], servings: 2, cost: 8, nutrition: { protein: 10 } },
    { id: 'c', name: 'Roast', tags: [dinner], servings: 6, cost: 30, nutrition: {} },
  );
  const names = (opts) => filterRecipes(s, opts).map((r) => r.name);
  assert.deepEqual(names({ filter: { [meal.id]: new Set([dinner]) } }), ['Chili', 'Roast']);
  assert.deepEqual(names({ filter: { [meal.id]: new Set([dinner, lunch]), [diff.id]: new Set([easy]) } }), ['Chili', 'Salad']);
  assert.deepEqual(names({ sort: 'cost' }), ['Chili', 'Salad', 'Roast']);
  assert.deepEqual(names({ sort: 'protein' }), ['Chili', 'Salad', 'Roast']);
  assert.deepEqual(names({ search: 'sal' }), ['Salad']);
});

test('weeks and old saves', () => {
  assert.equal(startOfWeek('2026-11-04', 1), '2026-11-02');
  assert.equal(startOfWeek('2026-11-04', 0), '2026-11-01');
  assert.equal(startOfWeek('2026-11-02', 1), '2026-11-02');
  const m = migrate({ recipes: [{ id: 'x' }] });
  assert.equal(m.settings.currency, '$');
  assert.equal(m.settings.slots.length, 4);
});
