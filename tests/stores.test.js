import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amazonCartUrl, compareRows, compareTotals, instacartItems, instacartMeasure, parseAmazonLink, parsePrice,
  setLink, titleFromAmazonUrl,
} from '../js/stores.js';
import { defaultState } from '../js/model.js';
import { applyRecord, flatten } from '../js/records.js';

test('reads Amazon links', () => {
  assert.deepEqual(parseAmazonLink('https://www.amazon.com/King-Arthur-Flour/dp/B000VDQ8GC/ref=sr_1_3?keywords=flour'),
    { asin: 'B000VDQ8GC', host: 'www.amazon.com', url: 'https://www.amazon.com/King-Arthur-Flour/dp/B000VDQ8GC/ref=sr_1_3?keywords=flour' });
  assert.equal(parseAmazonLink('https://amazon.co.uk/gp/product/B07ABCDE12').host, 'www.amazon.co.uk');
  assert.equal(parseAmazonLink('Check out this item on Amazon https://www.amazon.com/dp/b0c1234567?ref=x').asin, 'B0C1234567');
  assert.deepEqual(parseAmazonLink('Look https://a.co/d/3xYzAbc'), { short: 'https://a.co/d/3xYzAbc' });
  assert.equal(parseAmazonLink('B000VDQ8GC').asin, 'B000VDQ8GC');
  assert.equal(parseAmazonLink('https://www.example.com/dp/B000VDQ8GC'), null);
  assert.equal(parseAmazonLink('flour'), null);
  assert.equal(titleFromAmazonUrl('https://www.amazon.com/King-Arthur-Unbleached-Flour-5lb/dp/B000VDQ8GC'), 'King Arthur Unbleached Flour 5lb');
  assert.equal(titleFromAmazonUrl('https://www.amazon.com/dp/B000VDQ8GC'), '');
});

test('prices and the cart link', () => {
  assert.equal(parsePrice('$4.99'), 4.99);
  assert.equal(parsePrice('4,99 €'), 4.99);
  assert.equal(parsePrice('1,299.00'), 1299);
  assert.equal(parsePrice(''), null);
  assert.equal(amazonCartUrl('www.amazon.com', [{ asin: 'B000VDQ8GC', qty: 2 }, { asin: 'B07ABCDE12' }]),
    'https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B000VDQ8GC&Quantity.1=2&ASIN.2=B07ABCDE12&Quantity.2=1');
  assert.match(amazonCartUrl('evil.com', [{ asin: 'B000VDQ8GC' }]), /^https:\/\/www\.amazon\.com\//);
});

test('Instacart line items', () => {
  assert.deepEqual(instacartMeasure('500 g'), { quantity: 500, unit: 'gram' });
  assert.deepEqual(instacartMeasure('1½ cups'), { quantity: 1.5, unit: 'cup' });
  assert.deepEqual(instacartMeasure('3'), { quantity: 3, unit: 'each' });
  assert.equal(instacartMeasure('1 can + 2 cup'), null);
  assert.equal(instacartMeasure('2 sprigs'), null);
  assert.deepEqual(instacartItems([
    { name: 'flour', amount: '500 g' },
    { name: 'milk', amount: '', instacart: { name: 'oat milk' } },
  ]), [
    { name: 'flour', display_text: 'flour (500 g)', line_item_measurements: [{ quantity: 500, unit: 'gram' }] },
    { name: 'oat milk', display_text: 'milk' },
  ]);
});

test('compares the two stores and picks the cheaper one', () => {
  const st = defaultState();
  setLink(st, 'n:flour', { amazon: { asin: 'B000VDQ8GC', title: 'Flour', price: 3, qty: 2 }, instacart: { price: 5 } });
  setLink(st, 'n:milk', { amazon: { asin: 'B07ABCDE12', price: 4 }, instacart: { price: 3.5 } });
  setLink(st, 'n:eggs', { instacart: { name: 'large eggs', price: 4.2 } });
  const items = [
    { key: 'n:flour', name: 'flour', amount: '1 kg', cost: 2 },
    { key: 'n:milk', name: 'milk', amount: '' },
    { key: 'n:eggs', name: 'eggs', amount: '6' },
    { key: 'x:abc', name: 'paper towels', extra: true },
  ];
  const rows = compareRows(st, items);
  assert.deepEqual(rows.map((r) => [r.pick, r.amazonCost, r.instacartCost, r.cheaper]), [
    ['instacart', 6, 5, 'instacart'],
    ['instacart', 4, 3.5, 'instacart'],
    ['instacart', null, 4.2, ''],
    ['instacart', null, null, ''],
  ]);
  assert.equal(rows[3].linkKey, 'n:paper towels');
  const picked = compareRows(st, items, { picks: { 'n:flour': 'amazon', 'n:eggs': 'amazon', 'x:abc': 'skip' } });
  assert.deepEqual(picked.map((r) => r.pick), ['amazon', 'instacart', 'instacart', 'skip']);
  const t = compareTotals(picked);
  assert.deepEqual(t.amazon, { linked: 2, missing: 2, cost: 10, unpriced: 0 });
  assert.deepEqual(t.instacart, { priced: 3, cost: 12.7 });
  assert.deepEqual(t.both, { count: 2, amazon: 10, instacart: 8.5 });
  assert.deepEqual(t.toAmazon, { count: 1, cost: 6 });
});

test('store links sync as their own records', () => {
  const st = defaultState();
  setLink(st, 'f:abc', { amazon: { asin: 'B000VDQ8GC' } });
  const recs = flatten(st);
  assert.deepEqual(recs['l|f:abc'], { amazon: { asin: 'B000VDQ8GC' } });
  const other = defaultState();
  applyRecord(other, 'l|f:abc', recs['l|f:abc']);
  assert.equal(other.shopping.links['f:abc'].amazon.asin, 'B000VDQ8GC');
  applyRecord(other, 'l|f:abc', undefined);
  assert.deepEqual(other.shopping.links, {});
  setLink(st, 'f:abc', { amazon: null });
  assert.deepEqual(st.shopping.links, {});
});
