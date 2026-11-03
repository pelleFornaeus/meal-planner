import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFood, parseReceipt, priceTrend, rememberReceiptName, setPrice, unitPrice } from '../js/receipt.js';

const milk = () => ({ id: 'milk', name: 'Milk', base: 'g', per: 100, density: 1.03, portions: [], price: { amount: 3.49, qty: 1, unit: 'gal' } });

test('unit price and price history', () => {
  const f = milk();
  assert.ok(Math.abs(unitPrice(f) - 3.49 * 100 / (3785.41 * 1.03)) < 0.01);
  setPrice(f, { amount: 3.79, qty: 1, unit: 'gal' }, '2026-11-01');
  assert.equal(f.priceHistory.length, 2, 'keeps the old price as the start');
  setPrice(f, { amount: 3.89, qty: 1, unit: 'gal' }, '2026-11-01');
  assert.equal(f.priceHistory.length, 2, 'same day replaces');
  setPrice(f, { amount: 3.89, qty: 1, unit: 'gal' }, '2026-11-08');
  assert.equal(f.priceHistory.length, 2, 'same price adds nothing');
  const t = priceTrend(f);
  assert.ok(Math.abs(t.change - (3.89 / 3.49 - 1)) < 1e-9);
});

test('reading a receipt', () => {
  const lines = parseReceipt(`WALMART SUPERCENTER
GV WHL MLK GAL 007874235 3.48 N
BANANAS 000000004011 KF
2.04 lb @ 0.58 /lb 1.18 N
2 @ 1.25
CHKN BREAST 2.50 F
EGGS LRG 18CT 4.97 F
INSTANT SAVINGS -1.00
SUBTOTAL 12.13
TAX 1 7.000% 0.35
TOTAL 12.48
VISA TEND 12.48`);
  assert.deepEqual(lines.map((l) => l.name), ['GV WHL MLK GAL', 'BANANAS', 'CHKN BREAST', 'EGGS LRG 18CT']);
  assert.equal(lines[0].price, 3.48);
  assert.equal(lines[1].price, 1.18);
  assert.equal(lines[1].qty, 2.04);
  assert.equal(lines[1].unit, 'lb');
  assert.equal(lines[2].price, 2.5);
});

test('matching receipt names to foods', () => {
  const foods = [milk(), { id: 'ch', name: 'Chicken breast', base: 'g' }, { id: 'eg', name: 'Eggs', base: 'piece' }, { id: 'ba', name: 'Bananas', base: 'piece' }];
  assert.equal(matchFood(foods, 'GV WHL MLK GAL').id, 'milk');
  assert.equal(matchFood(foods, 'CHKN BREAST').id, 'ch');
  assert.equal(matchFood(foods, 'EGGS LRG 18CT').id, 'eg');
  assert.equal(matchFood(foods, 'PAPER TOWELS'), null);
  rememberReceiptName(foods[2], 'PAPER TOWELS');
  assert.equal(matchFood(foods, 'paper towels').id, 'eg');
});
