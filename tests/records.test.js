import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRecord, diff, flatten } from '../js/records.js';
import { addEntry, defaultState } from '../js/model.js';

test('records round-trip into an empty state', () => {
  const s = defaultState();
  s.recipes.push({ id: 'r1', name: 'Chili' });
  s.foods.push({ id: 'f1', name: 'Milk' });
  addEntry(s, '2026-11-02', { type: 'cook', slot: 'dinner', recipeId: 'r1' });
  const recs = flatten(s);
  const t = { recipes: [], categories: [], foods: [], plan: {}, settings: {} };
  for (const [k, v] of Object.entries(recs)) applyRecord(t, k, JSON.parse(JSON.stringify(v)));
  assert.deepEqual(flatten(t), JSON.parse(JSON.stringify(recs)));
});

test('removing the last meal of a day removes the day', () => {
  const s = defaultState();
  const e = addEntry(s, '2026-11-02', { type: 'food', slot: 'lunch', name: 'Apple' });
  applyRecord(s, `p|2026-11-02|${e.id}`, undefined);
  assert.deepEqual(s.plan, {});
});

test('diff finds changes and removals', () => {
  const s = defaultState();
  s.recipes.push({ id: 'r1', name: 'Chili' });
  const { json } = diff({}, s);
  s.recipes[0].name = 'Veggie chili';
  s.categories.pop();
  const d = diff(json, s);
  assert.deepEqual(d.changed, ['r|r1']);
  assert.equal(d.removed.length, 1);
  assert.ok(d.removed[0].startsWith('c|'));
});
