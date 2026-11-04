import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fromOpenFoodFacts, fromUsda, guessSection, normUnit, nutritionFor, priceFor, toBase, upgradeFood,
} from '../js/foods.js';
import {
  addFood, defaultState, findFood, linkName, migrate, recipeFromIngredients, entryFromFood,
} from '../js/model.js';

const milk = {
  name: 'Milk', base: 'g', per: 100, nutrition: { cal: 61, protein: 3.2, fat: 3.3 },
  portions: [{ unit: 'cup', grams: 244 }], price: { amount: 3.49, qty: 1, unit: 'gal' },
};

test('units', () => {
  assert.equal(normUnit('Tablespoons'), 'tbsp');
  assert.equal(normUnit('lbs.'), 'lb');
  assert.equal(toBase(milk, 200, 'ml'), 200);
  assert.equal(toBase(milk, 1, 'cup'), 244); // the food's own cup wins over the standard one
  assert.equal(toBase(milk, 2, 'oz'), 56.699);
  assert.equal(toBase(milk, 1, 'bowl'), null);
  const egg = { name: 'Egg', base: 'egg', per: 1, nutrition: { cal: 72 } };
  assert.equal(toBase(egg, 3, 'eggs'), 3);
  assert.equal(toBase(egg, 3, ''), 3);
  assert.deepEqual(nutritionFor(egg, 2, ''), { cal: 144 });
});

test('nutrition and price for an amount', () => {
  assert.deepEqual(nutritionFor(milk, 200, 'ml'), { cal: 122, protein: 6.4, fat: 6.6 });
  // $3.49 a gallon -> about 18 cents for 200 ml
  assert.equal(priceFor(milk, 200, 'ml'), 0.18);
  assert.equal(priceFor({ ...milk, price: null }, 200, 'ml'), null);
  const chicken = { base: 'g', per: 100, nutrition: { cal: 177 }, price: { amount: 2.99, qty: 1, unit: 'lb' } };
  assert.equal(priceFor(chicken, 500, 'g'), 3.3);
});

test('Open Food Facts products', () => {
  const f = fromOpenFoodFacts({
    code: '0016000275287', product_name: 'Cheerios', brands: 'General Mills,Cheerios',
    nutriments: { 'energy-kcal_100g': 357, proteins_100g: 12.5, carbohydrates_100g: 73.2, fat_100g: 7.1, sugars_100g: 3.6, fiber_100g: 10.7 },
    serving_quantity: 39,
  });
  assert.equal(f.name, 'Cheerios');
  assert.equal(f.brand, 'General Mills');
  assert.equal(f.nutrition.cal, 357);
  assert.equal(f.section, 'Pantry');
  assert.deepEqual(f.serving, { qty: 39, unit: 'g' });
  assert.equal(toBase(f, 1, 'serving'), 39);
  // Energy only in kJ
  assert.equal(fromOpenFoodFacts({ code: '1', product_name: 'X', nutriments: { energy_100g: 418.4 } }).nutrition.cal, 100);
});

test('USDA foods', () => {
  const f = fromUsda({
    fdcId: 173638, description: 'CHICKEN, BROILERS OR FRYERS, THIGH, MEAT ONLY, RAW', dataType: 'SR Legacy',
    foodNutrients: [
      { nutrientNumber: '208', nutrientName: 'Energy', unitName: 'KCAL', value: 121 },
      { nutrientNumber: '268', nutrientName: 'Energy', unitName: 'kJ', value: 506 },
      { nutrientNumber: '203', nutrientName: 'Protein', unitName: 'G', value: 19.7 },
      { nutrientNumber: '204', nutrientName: 'Total lipid (fat)', unitName: 'G', value: 4.12 },
      { nutrientNumber: '205', nutrientName: 'Carbohydrate, by difference', unitName: 'G', value: 0 },
    ],
    foodMeasures: [
      { disseminationText: '1 thigh, bone and skin removed', gramWeight: 69 },
      { disseminationText: '1/2 cup, diced', gramWeight: 70 },
      { disseminationText: 'Quantity not specified', gramWeight: 100 },
    ],
  });
  assert.equal(f.name, 'Chicken, broilers or fryers, thigh, meat only, raw');
  assert.deepEqual(f.nutrition, { cal: 121, protein: 19.7, carbs: 0, fat: 4.1 });
  assert.deepEqual(f.portions, [{ unit: 'thigh', grams: 69 }, { unit: 'cup', grams: 140 }]);
  assert.equal(f.section, 'Meat & fish');
  // Foundation foods report energy under another number
  const g = fromUsda({ fdcId: 1, description: 'Apple', foodNutrients: [{ nutrientNumber: '958', nutrientName: 'Energy (Atwater Specific Factors)', unitName: 'KCAL', value: 58 }] });
  assert.equal(g.nutrition.cal, 58);
});

test('store sections', () => {
  assert.equal(guessSection('Whole milk'), 'Dairy & eggs');
  assert.equal(guessSection('chicken thighs'), 'Meat & fish');
  assert.equal(guessSection('black pepper'), 'Spices');
  assert.equal(guessSection('red bell pepper'), 'Produce');
  assert.equal(guessSection('kidney beans'), 'Pantry');
});

test('older saved foods are upgraded', () => {
  const f = upgradeFood({ id: 'x', name: 'Cheerios', amount: 50, unit: 'g', nutrition: { cal: 190 }, cost: 0.4 });
  assert.equal(f.base, 'g');
  assert.equal(f.nutrition.cal, 380);
  assert.equal(priceFor(f, 100, 'g'), 0.8);
  const b = upgradeFood({ id: 'y', name: 'Banana', amount: 1, unit: '', nutrition: { cal: 105 } });
  assert.equal(b.base, 'piece');
  assert.deepEqual(nutritionFor(b, 2, ''), { cal: 210 });
  assert.equal(migrate({ foods: [{ name: 'Old', amount: 1, unit: 'cup', nutrition: { cal: 100 } }] }).foods[0].base, 'g');
});

test('finding foods by name', () => {
  const s = defaultState();
  const f = addFood(s, { name: 'Onion', base: 'g', per: 100, nutrition: { cal: 40 }, portions: [{ unit: 'piece', grams: 110 }] });
  assert.equal(findFood(s, 'onions, chopped'), f);
  assert.equal(findFood(s, 'large onion'), f);
  assert.equal(findFood(s, 'ground beef'), null);
  const beef = addFood(s, { name: 'Beef, ground, 85% lean', base: 'g', per: 100, nutrition: { cal: 215 } });
  linkName(beef, 'ground beef');
  assert.equal(findFood(s, 'Ground beef'), beef);
  // Looking the same product up again refreshes it instead of adding a copy
  addFood(s, { name: 'Onion', source: 'usda', sourceId: '1', base: 'g', per: 100, nutrition: { cal: 40 } });
  addFood(s, { name: 'Onion', source: 'usda', sourceId: '1', base: 'g', per: 100, nutrition: { cal: 41 } });
  assert.equal(s.foods.length, 3);
});

test('recipe nutrition and price from ingredients', () => {
  const s = defaultState();
  addFood(s, { name: 'Ground beef', base: 'g', per: 100, nutrition: { cal: 250, protein: 26 }, price: { amount: 5.99, qty: 1, unit: 'lb' } });
  addFood(s, { name: 'Kidney beans', base: 'g', per: 100, nutrition: { cal: 85, protein: 6 }, portions: [{ unit: 'can', grams: 425 }], price: { amount: 1.29, qty: 1, unit: 'can' } });
  addFood(s, { name: 'Onion', base: 'g', per: 100, nutrition: { cal: 40 }, portions: [{ unit: 'piece', grams: 110 }] });
  const r = recipeFromIngredients(s, {
    servings: 4,
    ingredients: [
      { qty: 500, unit: 'g', name: 'ground beef' },
      { qty: 1, unit: 'can', name: 'kidney beans' },
      { qty: 1, unit: '', name: 'onion, chopped' },
      { qty: null, unit: '', name: 'Salt to taste' },
    ],
  });
  assert.equal(r.counted, 3);
  assert.equal(r.perPortion.cal, Math.round(((1250 + 361.25 + 44) / 4) * 10) / 10);
  assert.equal(r.totalCost, Math.round((6.6 + 1.29) * 100) / 100);
  assert.equal(r.rows[3].problem, 'not in your food list');
  const e = entryFromFood(s.foods[0], 150, 'g');
  assert.equal(e.nutrition.cal, 375);
});

test('a food on a day follows later price changes', async () => {
  const { addEntry, dayTotals } = await import('../js/model.js');
  const s = defaultState();
  const f = addFood(s, { name: 'Milk', base: 'g', per: 100, nutrition: { cal: 61 }, price: null });
  addEntry(s, '2026-11-02', { type: 'food', slot: 'breakfast', ...entryFromFood(f, 200, 'ml') });
  assert.equal(dayTotals(s, '2026-11-02').missingCost, 1);
  f.price = { amount: 3.49, qty: 1, unit: 'gal' };
  assert.equal(dayTotals(s, '2026-11-02').cost, 0.18);
  assert.equal(dayTotals(s, '2026-11-02').cal, 122);
});

test('aisles go by what the thing is, not by describing words', () => {
  const cases = {
    'minced garlic': 'Produce', 'cayenne pepper': 'Spices', 'garlic powder': 'Spices', 'chili powder': 'Spices',
    'ground beef': 'Meat & fish', 'ground cumin': 'Spices', 'beef broth': 'Pantry', 'diced tomatoes': 'Pantry',
    'tomato paste': 'Pantry', 'red pepper flakes': 'Spices', 'sour cream': 'Dairy & eggs', 'lime juice': 'Produce',
    'olive oil': 'Pantry', 'garlic cloves': 'Produce', 'ground cloves': 'Spices', 'shredded cheddar cheese': 'Dairy & eggs',
    'Beef, ground, 80% lean meat / 20% fat, raw': 'Meat & fish', 'Peppers, sweet, red, raw': 'Produce', 'Spices, pepper, black': 'Spices',
    'jalapeño': 'Produce', 'cocoa powder': 'Pantry',
  };
  for (const [name, section] of Object.entries(cases)) assert.equal(guessSection(name), section, name);
});

test('saved foods use the newest guess unless you picked an aisle', async () => {
  const { foodSection } = await import('../js/foods.js');
  assert.equal(foodSection({ name: 'Minced garlic', section: 'Meat & fish' }), 'Produce');
  assert.equal(foodSection({ name: 'Minced garlic', section: 'Spices', sectionSet: true }), 'Spices');
  assert.equal(foodSection({ name: 'Zzz brand thing', section: 'Snacks' }), 'Snacks');
});
