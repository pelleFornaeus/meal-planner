import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemText, joinStep, splitStep, unusedIngredients } from '../js/steps.js';

test('steps keep their checklist as "- " lines', () => {
  const st = joinStep({ text: 'Combine the dry ingredients', items: ['1/4 cup chili powder', ' 1 tsp salt ', ''] });
  assert.equal(st, 'Combine the dry ingredients\n- 1/4 cup chili powder\n- 1 tsp salt');
  assert.deepEqual(splitStep(st), { text: 'Combine the dry ingredients', items: ['1/4 cup chili powder', '1 tsp salt'] });
  assert.deepEqual(splitStep('Brown the beef.'), { text: 'Brown the beef.', items: [] });
  // A step that starts with a dash is still a step.
  assert.deepEqual(splitStep('- Preheat the oven'), { text: '- Preheat the oven', items: [] });
  assert.equal(joinStep({ text: '', items: [] }), '');
});

test('ingredient items scale with the portions', () => {
  const ings = [{ qty: 0.25, unit: 'cup', name: 'chili powder' }, { qty: 1, unit: 'tsp', name: 'salt' }];
  assert.equal(itemText('¼ cup chili powder', ings, 2), '½ cup chili powder');
  assert.equal(itemText('a pinch of love', ings, 2), 'a pinch of love');
  assert.deepEqual(unusedIngredients(ings, ['Mix\n- 1 tsp salt']).map((i) => i.name), ['chili powder']);
});
