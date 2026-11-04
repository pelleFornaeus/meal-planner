import test from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, defaultState, refOf } from '../js/model.js';
import { recapYears, yearRecap } from '../js/recap.js';

test('year in food', () => {
  const s = defaultState();
  s.recipes.push({ id: 'chili', name: 'Chili', servings: 4, cost: 12, nutrition: { cal: 500 }, tags: [], steps: [], ingredients: [{ name: 'ground beef', qty: 1, unit: 'lb' }, { name: 'onion, chopped', qty: 1, unit: '' }, { name: 'salt', qty: null, unit: '' }], rating: 5 });
  s.recipes.push({ id: 'tacos', name: 'Tacos', servings: 2, cost: 8, nutrition: { cal: 400 }, tags: [], steps: [], ingredients: [{ name: 'ground beef', qty: 1, unit: 'lb' }] });
  addEntry(s, '2025-12-30', { type: 'cook', slot: 'dinner', recipeId: 'tacos' });
  const c = addEntry(s, '2026-01-05', { type: 'cook', slot: 'dinner', recipeId: 'chili' });
  addEntry(s, '2026-01-06', { type: 'leftover', slot: 'lunch', recipeId: 'chili', from: refOf('2026-01-05', c.id) });
  addEntry(s, '2026-03-02', { type: 'cook', slot: 'dinner', recipeId: 'chili' });
  addEntry(s, '2026-03-04', { type: 'cook', slot: 'dinner', recipeId: 'tacos' });
  addEntry(s, '2026-12-20', { type: 'cook', slot: 'dinner', recipeId: 'tacos' }); // in the future
  const r = yearRecap(s, '2026', '2026-11-03');
  assert.equal(r.meals, 4);
  assert.equal(r.batches, 3);
  assert.equal(r.topRecipes[0].recipe.id, 'chili');
  assert.equal(r.topRecipes[0].count, 2);
  assert.equal(r.topRecipes[0].portions, 3);
  assert.equal(r.topIngredients[0].name, 'ground beef');
  assert.equal(r.topIngredients[0].count, 3);
  assert.ok(!r.topIngredients.some((i) => i.name === 'salt'));
  assert.deepEqual(r.newRecipes.map((x) => x.id), ['chili'], 'tacos were cooked last year');
  assert.equal(r.busiestMonth, 0);
  assert.equal(r.topRated.id, 'chili');
  assert.ok(Math.abs(r.cost - (3 + 3 + 3 + 4)) < 0.01);
  assert.deepEqual(recapYears(s, '2026-11-03'), ['2026', '2025']);
});
