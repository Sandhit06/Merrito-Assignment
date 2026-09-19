import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InventoryEvent } from '../types';
import { determineAsOf, buildRiskRecord } from '../stockEngine';
import { SKU_CATALOG } from '../catalog';

const sku101Catalog = SKU_CATALOG.find((s) => s.sku === 'SKU-101')!;
const sku104Catalog = SKU_CATALOG.find((s) => s.sku === 'SKU-104')!;

test('REQUIRED: clearly at-risk SKU (brief\'s own worked example) is flagged, with correct math', () => {
  // 80 units on hand, selling ~10/day -> 8 days of stock left, less than the 14-day
  // lead time -> at risk. Reproduces the exact numbers from the case study brief.
  const events: InventoryEvent[] = [
    { sku: 'SKU-101', channel: 'shopify', type: 'restock', quantity: 300, timestamp: '2026-06-01T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 70, timestamp: '2026-07-26T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 70, timestamp: '2026-08-02T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 70, timestamp: '2026-08-09T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 70, timestamp: '2026-08-16T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 20, timestamp: '2026-08-23T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 80, timestamp: '2026-08-24T00:00:00Z' },
  ];

  const asOf = determineAsOf(events);
  const record = buildRiskRecord(sku101Catalog, events, asOf);

  assert.equal(record.currentStock, 80);
  assert.equal(record.salesVelocityPerDay, 10);
  assert.equal(record.daysOfStockRemaining, 8);
  assert.equal(record.atRisk, true);
  assert.equal(record.riskTier, 'watch'); // 8 days is still >= half the 14-day lead time
  assert.equal(record.idealReorderQuantity, 60);
  assert.equal(record.idealReorderCost, 12000);
});

test('REQUIRED: clearly fine SKU (plenty of stock relative to sell rate) is not flagged', () => {
  // 500 units on hand, selling only ~2/day -> 250 days of stock left, way more than
  // the 14-day lead time -> not at risk.
  const events: InventoryEvent[] = [
    { sku: 'SKU-104', channel: 'shopify', type: 'restock', quantity: 600, timestamp: '2026-06-05T00:00:00Z' },
    { sku: 'SKU-104', channel: 'shopify', type: 'sale', quantity: 20, timestamp: '2026-07-28T00:00:00Z' },
    { sku: 'SKU-104', channel: 'shopify', type: 'sale', quantity: 20, timestamp: '2026-08-07T00:00:00Z' },
    { sku: 'SKU-104', channel: 'shopify', type: 'sale', quantity: 20, timestamp: '2026-08-17T00:00:00Z' },
    { sku: 'SKU-104', channel: 'shopify', type: 'stock_snapshot', quantity: 500, timestamp: '2026-08-24T00:00:00Z' },
  ];

  const asOf = determineAsOf(events);
  const record = buildRiskRecord(sku104Catalog, events, asOf);

  assert.equal(record.currentStock, 500);
  assert.equal(record.salesVelocityPerDay, 2);
  assert.equal(record.daysOfStockRemaining, 250);
  assert.equal(record.atRisk, false);
  assert.equal(record.riskTier, 'safe');
  assert.equal(record.idealReorderQuantity, 0);
});

test('riskTier is "critical" when a SKU is projected to already be out today', () => {
  const events: InventoryEvent[] = [
    { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 100, timestamp: '2026-08-02T00:00:00Z' },
  ];

  const asOf = determineAsOf(events);
  const record = buildRiskRecord(sku101Catalog, events, asOf);

  assert.equal(record.currentStock, 0);
  assert.equal(record.daysOfStockRemaining, 0);
  assert.equal(record.riskTier, 'critical');
});

test('riskTier is "urgent" when days remaining is under half the lead time', () => {
  const events: InventoryEvent[] = [
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-01T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-02T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-03T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 30, timestamp: '2026-08-04T00:00:00Z' },
  ];

  const asOf = determineAsOf(events);
  const record = buildRiskRecord(sku101Catalog, events, asOf);

  assert.equal(record.currentStock, 30);
  assert.equal(record.salesVelocityPerDay, 10);
  assert.equal(record.daysOfStockRemaining, 3);
  assert.equal(record.riskTier, 'urgent');
});

test('stockConfidence is "low" when a SKU has never had a stock_snapshot', () => {
  const events: InventoryEvent[] = [
    { sku: 'SKU-101', channel: 'shopify', type: 'restock', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-02T00:00:00Z' },
  ];

  const asOf = determineAsOf(events);
  const record = buildRiskRecord(sku101Catalog, events, asOf);

  assert.equal(record.daysSinceLastSnapshot, null);
  assert.equal(record.stockConfidence, 'low');
});

test('stockConfidence is "low" when the most recent snapshot is more than 10 days stale', () => {
  const events: InventoryEvent[] = [
    { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-15T00:00:00Z' },
  ];

  const asOf = determineAsOf(events);
  const record = buildRiskRecord(sku101Catalog, events, asOf);

  assert.equal(record.daysSinceLastSnapshot, 14);
  assert.equal(record.stockConfidence, 'low');
});

test('stockConfidence is "high" when the most recent snapshot is within the freshness threshold', () => {
  const events: InventoryEvent[] = [
    { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-05T00:00:00Z' },
  ];

  const asOf = determineAsOf(events);
  const record = buildRiskRecord(sku101Catalog, events, asOf);

  assert.equal(record.daysSinceLastSnapshot, 4);
  assert.equal(record.stockConfidence, 'high');
});

test('stock_snapshot reconciles drift: later deltas apply only after the most recent snapshot', () => {
  const events: InventoryEvent[] = [
    { sku: 'SKU-101', channel: 'shopify', type: 'restock', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 30, timestamp: '2026-08-02T00:00:00Z' },
    // Ground truth says 50 on hand here, overriding the (100 - 30 = 70) implied by the deltas above.
    { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 50, timestamp: '2026-08-03T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-04T00:00:00Z' },
  ];

  const asOf = determineAsOf(events);
  const record = buildRiskRecord(sku101Catalog, events, asOf);

  assert.equal(record.currentStock, 40); // 50 (snapshot) - 10 (sale after it)
});

test('return events add back to stock and reduce net sales velocity', () => {
  const events: InventoryEvent[] = [
    { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 20, timestamp: '2026-08-02T00:00:00Z' },
    { sku: 'SKU-101', channel: 'shopify', type: 'return', quantity: 5, timestamp: '2026-08-03T00:00:00Z' },
  ];

  const asOf = determineAsOf(events);
  const record = buildRiskRecord(sku101Catalog, events, asOf);

  assert.equal(record.currentStock, 85); // 100 - 20 + 5
});

test('a SKU with no sales history ever has null days_of_stock_remaining and is not at risk', () => {
  const events: InventoryEvent[] = [
    { sku: 'SKU-101', channel: 'shopify', type: 'restock', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
  ];

  const asOf = determineAsOf(events);
  const record = buildRiskRecord(sku101Catalog, events, asOf);

  assert.equal(record.salesVelocityPerDay, 0);
  assert.equal(record.daysOfStockRemaining, null);
  assert.equal(record.atRisk, false);
  assert.equal(record.riskTier, 'safe'); // has stock, just no trend to project
});

test('a SKU with zero recorded events resolves to zero stock and is not at risk', () => {
  const asOf = new Date('2026-08-24T00:00:00Z');
  const record = buildRiskRecord(sku101Catalog, [], asOf);

  assert.equal(record.currentStock, 0);
  assert.equal(record.daysOfStockRemaining, null);
  assert.equal(record.atRisk, false);
  assert.equal(record.riskTier, 'unknown'); // zero stock, but no velocity data to size the urgency
  assert.equal(record.stockConfidence, 'low'); // never had a snapshot
});
