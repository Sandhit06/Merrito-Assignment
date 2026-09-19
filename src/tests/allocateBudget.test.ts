import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkuRiskRecord } from '../types';
import { allocateBudget } from '../allocateBudget';

function record(overrides: Partial<SkuRiskRecord>): SkuRiskRecord {
  return {
    sku: 'SKU-TEST',
    primaryChannel: 'shopify',
    unitCost: 100,
    currentStock: 10,
    salesVelocityPerDay: 5,
    daysOfStockRemaining: 2,
    atRisk: true,
    riskTier: 'urgent',
    daysSinceLastSnapshot: 0,
    stockConfidence: 'high',
    idealReorderQuantity: 60,
    idealReorderCost: 6000,
    ...overrides,
  };
}

test('fully funds every at-risk SKU when total ideal cost is within budget', () => {
  const records = [
    record({ sku: 'SKU-A', daysOfStockRemaining: 5, idealReorderQuantity: 50, idealReorderCost: 5000 }),
    record({ sku: 'SKU-B', daysOfStockRemaining: 10, idealReorderQuantity: 30, idealReorderCost: 3000 }),
  ];

  const result = allocateBudget(records, 20000);
  const a = result.find((r) => r.sku === 'SKU-A')!;
  const b = result.find((r) => r.sku === 'SKU-B')!;

  assert.equal(a.recommendReorder, true);
  assert.equal(a.reorderQuantity, 50);
  assert.equal(a.reorderCost, 5000);
  assert.equal(b.recommendReorder, true);
  assert.equal(b.reorderQuantity, 30);
  assert.equal(b.reorderCost, 3000);
});

test('when budget is tight, funds the most urgent SKU first and partially funds the cutoff SKU', () => {
  const records = [
    // Less urgent (more days left) but listed FIRST in the input, to prove ranking,
    // not insertion order, decides funding priority.
    record({ sku: 'SKU-SLOW', daysOfStockRemaining: 8, unitCost: 200, idealReorderQuantity: 60, idealReorderCost: 12000 }),
    // Most urgent: fewest days remaining.
    record({ sku: 'SKU-URGENT', daysOfStockRemaining: 3, unitCost: 50, idealReorderQuantity: 220, idealReorderCost: 11000 }),
  ];

  const result = allocateBudget(records, 20000);
  const urgent = result.find((r) => r.sku === 'SKU-URGENT')!;
  const slow = result.find((r) => r.sku === 'SKU-SLOW')!;

  // SKU-URGENT (3 days left) must be funded in full first.
  assert.equal(urgent.recommendReorder, true);
  assert.equal(urgent.reorderQuantity, 220);
  assert.equal(urgent.reorderCost, 11000);

  // Remaining budget = 20000 - 11000 = 9000. SKU-SLOW's ideal cost (12000) doesn't
  // fit, so it gets a partial quantity: floor(9000 / 200) = 45 units @ Rs 200 = 9000.
  assert.equal(slow.recommendReorder, true);
  assert.equal(slow.reorderQuantity, 45);
  assert.equal(slow.reorderCost, 9000);
});

test('SKUs that receive no funding this week are still flagged at risk, just with zero reorder', () => {
  const records = [
    record({ sku: 'SKU-URGENT', daysOfStockRemaining: 1, unitCost: 100, idealReorderQuantity: 200, idealReorderCost: 20000 }),
    record({ sku: 'SKU-STARVED', daysOfStockRemaining: 2, unitCost: 100, idealReorderQuantity: 50, idealReorderCost: 5000 }),
  ];

  const result = allocateBudget(records, 20000);
  const starved = result.find((r) => r.sku === 'SKU-STARVED')!;

  assert.equal(starved.atRisk, true);
  assert.equal(starved.recommendReorder, false);
  assert.equal(starved.reorderQuantity, 0);
  assert.ok(starved.fundingNote.length > 0);
});

test('total allocated cost never exceeds the given budget, across varied inputs', () => {
  const records = [
    record({ sku: 'SKU-A', daysOfStockRemaining: 1, unitCost: 137, idealReorderQuantity: 233, idealReorderCost: 137 * 233 }),
    record({ sku: 'SKU-B', daysOfStockRemaining: 4, unitCost: 61, idealReorderQuantity: 401, idealReorderCost: 61 * 401 }),
    record({ sku: 'SKU-C', daysOfStockRemaining: 9, unitCost: 29, idealReorderQuantity: 900, idealReorderCost: 29 * 900 }),
  ];

  const result = allocateBudget(records, 20000);
  const total = result.reduce((sum, r) => sum + r.reorderCost, 0);

  assert.ok(total <= 20000);
});

test('SKUs that are not at risk pass through with no reorder recommended', () => {
  const records = [record({ sku: 'SKU-FINE', atRisk: false, idealReorderQuantity: 0, idealReorderCost: 0, daysOfStockRemaining: 250 })];
  const result = allocateBudget(records, 20000);

  assert.equal(result[0].recommendReorder, false);
  assert.equal(result[0].reorderQuantity, 0);
});
