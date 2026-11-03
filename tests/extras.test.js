import test from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, defaultState, filterRecipes, refOf, dayEntries } from '../js/model.js';
import { clockText, copyWeek, lastCooked, pickSurprise, stepTimers } from '../js/extras.js';
import { shoppingList } from '../js/shopping.js';

function kitchen() {
  const s = defaultState();
  s.recipes.push({ id: 'chili', name: 'Chili', servings: 4, tags: [], steps: [], nutrition: {}, ingredients: [{ name: 'ground beef', qty: 500, unit: 'g' }, { name: 'salt', qty: null, unit: '' }] });
  s.recipes.push({ id: 'soup', name: 'Soup', servings: 2, tags: [], steps: [], nutrition: {}, ingredients: [], favorite: true, rating: 5 });
  return s;
}

test('copy a week keeps leftovers linked to the copied batch', () => {
  const s = kitchen();
  const cook = addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'chili' });
  addEntry(s, '2026-11-04', { type: 'leftover', slot: 'lunch', recipeId: 'chili', from: refOf('2026-11-02', cook.id) });
  assert.equal(copyWeek(s, '2026-11-02', '2026-11-09'), 2);
  const [c] = dayEntries(s, '2026-11-09');
  const [l] = dayEntries(s, '2026-11-11');
  assert.equal(c.type, 'cook');
  assert.equal(l.from, refOf('2026-11-09', c.id));
  assert.equal(l.slot, 'lunch');
});

test('last cooked and sorting by it', () => {
  const s = kitchen();
  addEntry(s, '2026-10-01', { type: 'cook', slot: 'dinner', recipeId: 'chili' });
  addEntry(s, '2026-10-20', { type: 'cook', slot: 'dinner', recipeId: 'soup' });
  assert.equal(lastCooked(s, 'chili', '2026-11-01'), '2026-10-01');
  assert.deepEqual(filterRecipes(s, { sort: 'stale' }).map((r) => r.id), ['chili', 'soup']);
  assert.deepEqual(filterRecipes(s, { sort: 'favorite' }).map((r) => r.id), ['soup', 'chili']);
  assert.deepEqual(filterRecipes(s, { favorites: true }).map((r) => r.id), ['soup']);
});

test('surprise picks from the list and can skip one', () => {
  const s = kitchen();
  assert.equal(pickSurprise(s.recipes, s, '2026-11-01', { exclude: ['soup'] }).id, 'chili');
  assert.equal(pickSurprise(s.recipes, s, '2026-11-01', { random: () => 0 }).id, 'chili');
  assert.equal(pickSurprise([], s, '2026-11-01'), null);
});

test('timers in steps', () => {
  assert.deepEqual(stepTimers('Simmer for 30 minutes, then rest 5 mins.').map((t) => t.seconds), [1800, 300]);
  assert.deepEqual(stepTimers('Bake 1 hour 15 minutes').map((t) => t.seconds), [4500]);
  assert.deepEqual(stepTimers('Cook 10-15 min').map((t) => t.seconds), [900]);
  assert.deepEqual(stepTimers('Add 2 tbsp oil and 1 m of string'), []);
  assert.deepEqual(stepTimers('Bake for 1.5 hours').map((t) => t.seconds), [5400]);
  assert.equal(clockText(65), '1:05');
  assert.equal(clockText(3725), '1:02:05');
});

test('things in the pantry are not on the shopping list cost', () => {
  const s = kitchen();
  addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'chili' });
  s.pantry.push({ id: 'p1', name: 'Salt', staple: true });
  const list = shoppingList(s, '2026-11-01', '2026-11-07');
  assert.equal(list.items.find((i) => i.name === 'salt').atHome.id, 'p1');
  assert.equal(list.items.find((i) => i.name === 'ground beef').atHome, null);
});
