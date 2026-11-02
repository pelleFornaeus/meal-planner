import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText, findRecipeLd, fromPage, fromText, isoMinutes, nutritionFrom, stepsFrom, yieldCount,
} from '../js/importer.js';

const yoast = [{
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Some Blog' },
    { '@type': 'Article', headline: 'Best chili' },
    {
      '@type': 'Recipe',
      name: 'Easy Beef Chili &amp; Beans',
      image: ['https://example.com/chili-1x1.jpg', 'https://example.com/chili-4x3.jpg'],
      recipeYield: ['6', '6 servings'],
      prepTime: 'PT15M',
      cookTime: 'PT1H',
      totalTime: 'PT1H15M',
      description: 'A <b>hearty</b> chili.',
      recipeIngredient: ['1 lb ground beef', '1 (15 ounce) can kidney beans, drained', '2 tablespoons chili powder', '1 onion, chopped', 'Salt to taste'],
      recipeInstructions: [
        { '@type': 'HowToSection', name: 'Cook', itemListElement: [
          { '@type': 'HowToStep', text: 'Brown the beef with the onion.' },
          { '@type': 'HowToStep', text: 'Add the beans and spices.' },
        ] },
        { '@type': 'HowToSection', name: 'Serve', itemListElement: [{ '@type': 'HowToStep', text: 'Top with cheese.' }] },
      ],
      nutrition: { '@type': 'NutritionInformation', calories: '420 kcal', proteinContent: '32 g', carbohydrateContent: '25g', fatContent: '21 g', fiberContent: '7 g', sugarContent: '6 g' },
    },
  ],
}];

test('finds the recipe in a page and reads it', () => {
  const r = fromPage({ url: 'https://example.com/chili/', ld: yoast, meta: {}, text: '' });
  assert.equal(r.name, 'Easy Beef Chili & Beans');
  assert.equal(r.servings, 6);
  assert.equal(r.minutes, 75);
  assert.equal(r.image, 'https://example.com/chili-1x1.jpg');
  assert.equal(r.notes, 'A hearty chili.');
  assert.equal(r.ingredients.length, 5);
  assert.deepEqual(r.ingredients[0], { qty: 1, unit: 'lb', name: 'ground beef' });
  assert.equal(r.ingredients[2].unit, 'tablespoons');
  assert.deepEqual(r.steps, ['Cook:', 'Brown the beef with the onion.', 'Add the beans and spices.', 'Serve:', 'Top with cheese.']);
  assert.deepEqual(r.nutrition, { cal: 420, protein: 32, carbs: 25, fat: 21, sugar: 6, fiber: 7 });
  assert.equal(r.source, 'https://example.com/chili/');
});

test('recipe types and nesting', () => {
  assert.equal(findRecipeLd([{ '@type': ['Recipe', 'NewsArticle'], name: 'A' }]).name, 'A');
  assert.equal(findRecipeLd({ '@type': 'WebPage', mainEntity: { '@type': 'Recipe', name: 'B' } }).name, 'B');
  assert.equal(findRecipeLd([{ '@type': 'Article' }]), null);
});

test('small readers', () => {
  assert.equal(isoMinutes('PT45M'), 45);
  assert.equal(isoMinutes('P0DT1H0M'), 60);
  assert.equal(isoMinutes(''), null);
  assert.equal(isoMinutes('PT'), null);
  assert.equal(yieldCount('Makes 12 muffins'), 12);
  assert.equal(yieldCount(4), 4);
  assert.equal(yieldCount('a few'), null);
  assert.deepEqual(stepsFrom('1. Mix.\n2. Bake.'), ['Mix.', 'Bake.']);
  assert.deepEqual(stepsFrom('<p>Mix it.</p><br>Bake it.'), ['Mix it.', 'Bake it.']);
  assert.deepEqual(nutritionFrom({ calories: '1674 kJ', sodiumContent: '300 mg' }), { cal: 400.1 });
  assert.equal(cleanText('Salt &amp; pepper&nbsp;to taste'), 'Salt & pepper to taste');
});

test('pasted recipe text', () => {
  const r = fromText(`Grandma's Pancakes
Prep 5 min · Serves 4
Total time: 25 minutes
Ingredients
- 1 1/2 cups flour
- 2 eggs
- 300 ml milk
Instructions
1. Whisk everything together.
2. Fry in a hot pan.
Notes
Keeps for 2 days.`);
  assert.equal(r.name, "Grandma's Pancakes");
  assert.equal(r.servings, 4);
  assert.equal(r.minutes, 25);
  assert.deepEqual(r.ingredients.map((i) => i.name), ['flour', 'eggs', 'milk']);
  assert.equal(r.ingredients[0].qty, 1.5);
  assert.deepEqual(r.steps, ['Whisk everything together.', 'Fry in a hot pan.']);
});

test('a page without recipe data falls back to its text', () => {
  const r = fromPage({ url: 'https://x.com/p', ld: [], meta: { title: 'Soup | My Blog', image: '/soup.jpg' }, text: 'Soup | My Blog\nIngredients\n1 l stock\n2 carrots\nMethod\nBoil.' });
  assert.equal(r.ingredients.length, 2);
  assert.equal(r.image, 'https://x.com/soup.jpg');
  assert.equal(fromPage({ url: 'https://x.com', ld: [], meta: {}, text: 'Hello' }), null);
});
