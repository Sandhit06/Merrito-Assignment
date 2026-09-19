import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { loadEvents } from '../parseEvents';
import { determineAsOf, computeAllRiskRecords } from '../stockEngine';
import { allocateBudget } from '../allocateBudget';
import { SKU_CATALOG, WEEKLY_REORDER_BUDGET } from '../catalog';

const SAMPLE_DATA_PATH = path.join(__dirname, '..', '..', 'data', 'inventory_events.json');

test('REQUIRED: at least one malformed event in the sample data is skipped without crashing', () => {
  const { valid, skipped } = loadEvents(SAMPLE_DATA_PATH);

  assert.ok(valid.length > 0, 'expected some valid events to be parsed');
  assert.ok(skipped.length >= 1, 'expected the sample dataset to contain at least one malformed event');

  // Sanity check a few of the specific malformed cases the sample data was designed to cover.
  const reasons = skipped.map((s) => s.reason).join(' | ');
  assert.match(reasons, /quantity/i);
  assert.match(reasons, /timestamp/i);
});

test('end-to-end: full pipeline on the sample dataset never over-allocates the weekly budget', () => {
  const { valid } = loadEvents(SAMPLE_DATA_PATH);
  const asOf = determineAsOf(valid);
  const riskRecords = computeAllRiskRecords(SKU_CATALOG, valid, asOf);
  const recommendations = allocateBudget(riskRecords, WEEKLY_REORDER_BUDGET);

  assert.equal(recommendations.length, SKU_CATALOG.length);

  const totalAllocated = recommendations.reduce((sum, r) => sum + r.reorderCost, 0);
  assert.ok(totalAllocated <= WEEKLY_REORDER_BUDGET, 'total allocated cost must never exceed the weekly budget');
});

test("end-to-end: sample dataset's SKU-101 matches the brief's worked example exactly", () => {
  const { valid } = loadEvents(SAMPLE_DATA_PATH);
  const asOf = determineAsOf(valid);
  const riskRecords = computeAllRiskRecords(SKU_CATALOG, valid, asOf);
  const sku101 = riskRecords.find((r) => r.sku === 'SKU-101');

  assert.ok(sku101);
  assert.equal(sku101!.atRisk, true);
  assert.equal(sku101!.daysOfStockRemaining, 8);
  assert.equal(sku101!.idealReorderQuantity, 60);
  assert.equal(sku101!.idealReorderCost, 12000);
});
