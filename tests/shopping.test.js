import test from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, defaultState, migrate, refOf } from '../js/model.js';
import { addRecipeToList, amountText, clearShopping, listText, pruneChecks, removeRecipeFromList, removeRecipeFromShopping, setChecked, shoppingList, skipMeals } from '../js/shopping.js';
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
  assert.deepEqual(other.shopping, { checked: {}, extras: [], links: {}, recipes: [], skip: {}, sections: {} });
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

test('take a recipe off the list, clear the list, and put meals back', () => {
  const s = kitchen();
  addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'chili', scale: 1 });
  addEntry(s, '2026-11-03', { type: 'cook', slot: 'breakfast', recipeId: 'pancakes', scale: 1 });
  addEntry(s, '2026-11-03', { type: 'food', slot: 'breakfast', name: 'Milk', amount: 200, unit: 'ml', foodId: 'milk' });
  addRecipeToList(s, 'chili', 1, 'q1', '2026-11-01');
  removeRecipeFromShopping(s, 'chili', '2026-11-01', '2026-11-07');
  let list = shoppingList(s, '2026-11-01', '2026-11-07');
  assert.deepEqual(list.recipes.map((r) => r.recipe.id), ['pancakes']);
  assert.equal(list.skipped.length, 1);
  assert.equal(s.shopping.recipes.length, 0);
  assert.equal(Object.keys(s.plan['2026-11-02']).length, 1, 'the plan is untouched');
  // A new chili planned later still shows up.
  addEntry(s, '2026-11-05', { type: 'cook', slot: 'dinner', recipeId: 'chili', scale: 1 });
  assert.ok(shoppingList(s, '2026-11-01', '2026-11-07').items.some((i) => i.name === 'ground beef'));
  s.shopping.extras.push({ id: 'x1', name: 'Paper towels' });
  clearShopping(s, '2026-11-01', '2026-11-07');
  list = shoppingList(s, '2026-11-01', '2026-11-07');
  assert.equal(list.items.length, 0);
  assert.equal(s.shopping.extras.length, 0);
  // Synced
  const other = defaultState();
  for (const [k, v] of Object.entries(flatten(s))) applyRecord(other, k, v);
  assert.deepEqual(other.shopping.skip, s.shopping.skip);
  skipMeals(s, list.skipped, false);
  assert.equal(shoppingList(s, '2026-11-01', '2026-11-07').recipes.length, 2);
  // Old skips are tidied away.
  skipMeals(s, ['2026-11-02|abc']);
  pruneChecks(s, '2026-11-10');
  assert.deepEqual(s.shopping.skip, {});
});

test('items can be moved to another aisle', async () => {
  const { setSection } = await import('../js/shopping.js');
  const s = kitchen();
  addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'chili', scale: 1 });
  addEntry(s, '2026-11-03', { type: 'cook', slot: 'breakfast', recipeId: 'pancakes', scale: 1 });
  const list = shoppingList(s, '2026-11-01', '2026-11-07');
  setSection(s, list.items.find((i) => i.name === 'onion'), 'Other');
  setSection(s, list.items.find((i) => i.name === 'Milk'), 'Drinks');
  const again = shoppingList(s, '2026-11-01', '2026-11-07');
  assert.equal(again.items.find((i) => i.name === 'onion').section, 'Other');
  assert.equal(again.items.find((i) => i.name === 'Milk').section, 'Drinks');
  assert.equal(s.foods[0].sectionSet, true);
  const other = defaultState();
  for (const [k, v] of Object.entries(flatten(s))) applyRecord(other, k, v);
  assert.deepEqual(other.shopping.sections, { 'n:onion': 'Other' });
});

test('cans keep their size on the list', () => {
  const s = kitchen();
  s.recipes.push({
    id: 'tc', name: 'Tailgate chili', servings: 8, tags: [], steps: [], nutrition: {},
    ingredients: [
      { qty: 2, unit: 'cans', name: 'diced tomatoes with juice (28 oz)' },
      // saved before sizes were read: the size is still at the front of the name
      { qty: 1, unit: '', name: '(15 ounce) can kidney beans, drained' },
    ],
  });
  s.recipes.push({
    id: 'tc2', name: 'Soup', servings: 4, tags: [], steps: [], nutrition: {},
    ingredients: [{ qty: 1, unit: 'can', name: 'kidney beans (15 oz)' }, { qty: 1, unit: 'can', name: 'diced tomatoes (14.5 oz)' }],
  });
  addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'tc', scale: 1 });
  let list = shoppingList(s, '2026-11-01', '2026-11-07');
  assert.equal(list.items.find((i) => i.name === 'diced tomatoes with juice').amount, '2 cans (28 oz each)');
  assert.equal(list.items.find((i) => i.name === 'kidney beans').amount, '1 can (15 oz)');
  addEntry(s, '2026-11-03', { type: 'cook', slot: 'dinner', recipeId: 'tc2', scale: 1 });
  list = shoppingList(s, '2026-11-01', '2026-11-07');
  assert.equal(list.items.find((i) => i.name === 'kidney beans').amount, '2 cans (15 oz each)');
  assert.equal(list.items.find((i) => i.name === 'diced tomatoes').amount, '1 can (14.5 oz)');
});
