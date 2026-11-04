import test from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, defaultState, migrate, refOf } from '../js/model.js';
import { addRecipeToList, amountText, listText, pruneChecks, removeRecipeFromList, setChecked, shoppingList } from '../js/shopping.js';
import { applyRecord, flatten } from '../js/records.js';

function kitchen() {
  const s = defaultState();
  s.foods.push({
    id: 'milk', name: 'Milk', base: 'g', per: 100, density: 1.03, nutrition: { cal: 60 },
    price: { amount: 1.5, qty: 1, unit: 'l' }, section: 'Dairy & eggs', portions: [], aliases: [],
  });
  s.recipes.push({
    id: 'chili', name: 'Chili', servings: 4, tags: [], steps: [], nutrition: {},
    ingredients: [
      { name: 'ground beef', qty: 500, unit: 'g' },
      { name: 'onion, chopped', qty: 1, unit: '' },
      { name: 'salt', qty: null, unit: '' },
    ],
  });
  s.recipes.push({
    id: 'pancakes', name: 'Pancakes', servings: 2, tags: [], steps: [], nutrition: {},
    ingredients: [
      { name: 'milk', qty: 300, unit: 'ml' },
      { name: 'onions', qty: 2, unit: '' },
    ],
  });
  return s;
}

test('each batch is bought once and leftovers are not bought again', () => {
  const s = kitchen();
  const cook = addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'chili', scale: 1 });
  addEntry(s, '2026-11-04', { type: 'leftover', slot: 'dinner', recipeId: 'chili', from: refOf('2026-11-02', cook.id) });
  const list = shoppingList(s, '2026-11-01', '2026-11-07');
  const beef = list.items.find((i) => i.name === 'ground beef');
  assert.equal(beef.amount, '500 g');
  assert.equal(beef.section, 'Meat & fish');
  assert.equal(list.recipes.length, 1);
  assert.equal(list.recipes[0].cooks.length, 1);
});

test('the same food from different recipes and days is added up', () => {
  const s = kitchen();
  addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'chili', scale: 2 });
  addEntry(s, '2026-11-03', { type: 'cook', slot: 'breakfast', recipeId: 'pancakes', scale: 1 });
  addEntry(s, '2026-11-03', { type: 'food', slot: 'breakfast', name: 'milk', amount: 200, unit: 'ml', foodId: 'milk' });
  const list = shoppingList(s, '2026-11-01', '2026-11-07');
  const onions = list.items.filter((i) => /onion/.test(i.name));
  assert.equal(onions.length, 1, '"onion, chopped" and "onions" are one item');
  assert.equal(onions[0].amount, '4');
  assert.deepEqual(onions[0].recipes.sort(), ['chili', 'pancakes']);
  const milk = list.items.find((i) => i.key === 'f:milk');
  assert.equal(milk.amount, '500 ml');
  assert.deepEqual(milk.recipes, ['pancakes']);
  assert.equal(milk.hasFoods, true);
  assert.equal(milk.cost, 0.75);
  assert.equal(list.unpriced, list.items.length - 1);
});

test('outside the range is left out', () => {
  const s = kitchen();
  addEntry(s, '2026-11-10', { type: 'cook', slot: 'dinner', recipeId: 'chili', scale: 1 });
  assert.equal(shoppingList(s, '2026-11-01', '2026-11-07').items.length, 0);
});

test('ticked items come back only for meals after they were bought', () => {
  const s = kitchen();
  addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'chili', scale: 1 });
  setChecked(s, 'n:ground beef', true, '2026-11-07');
  let beef = shoppingList(s, '2026-11-01', '2026-11-07').items.find((i) => i.key === 'n:ground beef');
  assert.equal(beef.done, true);
  addEntry(s, '2026-11-09', { type: 'cook', slot: 'dinner', recipeId: 'chili', scale: 1 });
  beef = shoppingList(s, '2026-11-01', '2026-11-09').items.find((i) => i.key === 'n:ground beef');
  assert.equal(beef.done, false);
  assert.equal(beef.boughtSome, true);
  assert.equal(beef.amount, '500 g');
  pruneChecks(s, '2026-11-08');
  assert.deepEqual(s.shopping.checked, {});
});

test('amounts in different units', () => {
  assert.equal(amountText([{ qty: 500, unit: 'g' }, { qty: 1, unit: 'kg' }], null), '1½ kg');
  assert.equal(amountText([{ qty: 1, unit: 'can' }, { qty: 2, unit: 'cups' }], null), '1 can + 2 cups');
  assert.equal(amountText([{ qty: null, unit: '' }], null), '');
});

test('ticks and extra items sync as their own records', () => {
  const s = kitchen();
  setChecked(s, 'f:milk', true, '2026-11-07');
  s.shopping.extras.push({ id: 'x1', name: 'Paper towels', checked: false });
  const flat = flatten(s);
  assert.deepEqual(flat['k|f:milk'], { upto: '2026-11-07' });
  assert.equal(flat['x|x1'].name, 'Paper towels');
  const other = migrate({});
  for (const [k, v] of Object.entries(flat)) applyRecord(other, k, v);
  assert.deepEqual(other.shopping, s.shopping);
  applyRecord(other, 'k|f:milk', undefined);
  applyRecord(other, 'x|x1', undefined);
  assert.deepEqual(other.shopping, { checked: {}, extras: [], links: {}, recipes: [] });
});

test('plain text copy', () => {
  assert.equal(listText([{ title: 'Dairy', items: [{ name: 'Milk', amount: '1 l' }, { name: 'Eggs', amount: '' }] }]),
    'Dairy\n- Milk (1 l)\n- Eggs');
});

test('a recipe can go on the list without a plan', () => {
  const s = kitchen();
  addEntry(s, '2026-11-02', { type: 'cook', slot: 'breakfast', recipeId: 'pancakes', scale: 1 });
  const a = addRecipeToList(s, 'pancakes', 2, 'q1', '2026-11-01');
  addRecipeToList(s, 'chili', 1, 'q2', '2026-11-01');
  let list = shoppingList(s, '2026-11-01', '2026-11-07');
  assert.equal(list.items.find((i) => i.name === 'Milk').amount, '900 ml');
  assert.equal(list.items.find((i) => i.name === 'ground beef').amount, '500 g');
  assert.deepEqual(list.recipes.find((r) => r.recipe.id === 'pancakes').cooks.map((c) => c.date), ['2026-11-02', null]);
  // It's on any days' list, even with nothing planned.
  assert.ok(shoppingList(s, '2026-12-01', '2026-12-07').items.some((i) => i.name === 'ground beef'));
  // Ticks stick, even after the planned meals are in the past.
  setChecked(s, 'f:milk', true, '2026-11-07');
  setChecked(s, 'n:ground beef', true, '2026-11-07');
  pruneChecks(s, '2026-11-20');
  list = shoppingList(s, '2026-11-20', '2026-11-26');
  assert.equal(list.items.find((i) => i.name === 'ground beef').done, true);
  setChecked(s, 'n:ground beef', false, '2026-11-26');
  assert.equal(shoppingList(s, '2026-11-20', '2026-11-26').items.find((i) => i.name === 'ground beef').done, false);
  // Synced as its own record.
  const other = defaultState();
  for (const [k, v] of Object.entries(flatten(s))) applyRecord(other, k, v);
  assert.deepEqual(other.shopping.recipes, s.shopping.recipes);
  removeRecipeFromList(s, a.id);
  removeRecipeFromList(s, 'q2');
  assert.equal(shoppingList(s, '2026-12-01', '2026-12-07').items.length, 0);
});
