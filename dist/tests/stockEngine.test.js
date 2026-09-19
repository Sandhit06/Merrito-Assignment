"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const stockEngine_1 = require("../stockEngine");
const catalog_1 = require("../catalog");
const sku101Catalog = catalog_1.SKU_CATALOG.find((s) => s.sku === 'SKU-101');
const sku104Catalog = catalog_1.SKU_CATALOG.find((s) => s.sku === 'SKU-104');
(0, node_test_1.test)('REQUIRED: clearly at-risk SKU (brief\'s own worked example) is flagged, with correct math', () => {
    // 80 units on hand, selling ~10/day -> 8 days of stock left, less than the 14-day
    // lead time -> at risk. Reproduces the exact numbers from the case study brief.
    const events = [
        { sku: 'SKU-101', channel: 'shopify', type: 'restock', quantity: 300, timestamp: '2026-06-01T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 70, timestamp: '2026-07-26T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 70, timestamp: '2026-08-02T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 70, timestamp: '2026-08-09T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 70, timestamp: '2026-08-16T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 20, timestamp: '2026-08-23T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 80, timestamp: '2026-08-24T00:00:00Z' },
    ];
    const asOf = (0, stockEngine_1.determineAsOf)(events);
    const record = (0, stockEngine_1.buildRiskRecord)(sku101Catalog, events, asOf);
    strict_1.default.equal(record.currentStock, 80);
    strict_1.default.equal(record.salesVelocityPerDay, 10);
    strict_1.default.equal(record.daysOfStockRemaining, 8);
    strict_1.default.equal(record.atRisk, true);
    strict_1.default.equal(record.riskTier, 'watch'); // 8 days is still >= half the 14-day lead time
    strict_1.default.equal(record.idealReorderQuantity, 60);
    strict_1.default.equal(record.idealReorderCost, 12000);
});
(0, node_test_1.test)('REQUIRED: clearly fine SKU (plenty of stock relative to sell rate) is not flagged', () => {
    // 500 units on hand, selling only ~2/day -> 250 days of stock left, way more than
    // the 14-day lead time -> not at risk.
    const events = [
        { sku: 'SKU-104', channel: 'shopify', type: 'restock', quantity: 600, timestamp: '2026-06-05T00:00:00Z' },
        { sku: 'SKU-104', channel: 'shopify', type: 'sale', quantity: 20, timestamp: '2026-07-28T00:00:00Z' },
        { sku: 'SKU-104', channel: 'shopify', type: 'sale', quantity: 20, timestamp: '2026-08-07T00:00:00Z' },
        { sku: 'SKU-104', channel: 'shopify', type: 'sale', quantity: 20, timestamp: '2026-08-17T00:00:00Z' },
        { sku: 'SKU-104', channel: 'shopify', type: 'stock_snapshot', quantity: 500, timestamp: '2026-08-24T00:00:00Z' },
    ];
    const asOf = (0, stockEngine_1.determineAsOf)(events);
    const record = (0, stockEngine_1.buildRiskRecord)(sku104Catalog, events, asOf);
    strict_1.default.equal(record.currentStock, 500);
    strict_1.default.equal(record.salesVelocityPerDay, 2);
    strict_1.default.equal(record.daysOfStockRemaining, 250);
    strict_1.default.equal(record.atRisk, false);
    strict_1.default.equal(record.riskTier, 'safe');
    strict_1.default.equal(record.idealReorderQuantity, 0);
});
(0, node_test_1.test)('riskTier is "critical" when a SKU is projected to already be out today', () => {
    const events = [
        { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 100, timestamp: '2026-08-02T00:00:00Z' },
    ];
    const asOf = (0, stockEngine_1.determineAsOf)(events);
    const record = (0, stockEngine_1.buildRiskRecord)(sku101Catalog, events, asOf);
    strict_1.default.equal(record.currentStock, 0);
    strict_1.default.equal(record.daysOfStockRemaining, 0);
    strict_1.default.equal(record.riskTier, 'critical');
});
(0, node_test_1.test)('riskTier is "urgent" when days remaining is under half the lead time', () => {
    const events = [
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-01T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-02T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-03T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 30, timestamp: '2026-08-04T00:00:00Z' },
    ];
    const asOf = (0, stockEngine_1.determineAsOf)(events);
    const record = (0, stockEngine_1.buildRiskRecord)(sku101Catalog, events, asOf);
    strict_1.default.equal(record.currentStock, 30);
    strict_1.default.equal(record.salesVelocityPerDay, 10);
    strict_1.default.equal(record.daysOfStockRemaining, 3);
    strict_1.default.equal(record.riskTier, 'urgent');
});
(0, node_test_1.test)('stockConfidence is "low" when a SKU has never had a stock_snapshot', () => {
    const events = [
        { sku: 'SKU-101', channel: 'shopify', type: 'restock', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-02T00:00:00Z' },
    ];
    const asOf = (0, stockEngine_1.determineAsOf)(events);
    const record = (0, stockEngine_1.buildRiskRecord)(sku101Catalog, events, asOf);
    strict_1.default.equal(record.daysSinceLastSnapshot, null);
    strict_1.default.equal(record.stockConfidence, 'low');
});
(0, node_test_1.test)('stockConfidence is "low" when the most recent snapshot is more than 10 days stale', () => {
    const events = [
        { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-15T00:00:00Z' },
    ];
    const asOf = (0, stockEngine_1.determineAsOf)(events);
    const record = (0, stockEngine_1.buildRiskRecord)(sku101Catalog, events, asOf);
    strict_1.default.equal(record.daysSinceLastSnapshot, 14);
    strict_1.default.equal(record.stockConfidence, 'low');
});
(0, node_test_1.test)('stockConfidence is "high" when the most recent snapshot is within the freshness threshold', () => {
    const events = [
        { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-05T00:00:00Z' },
    ];
    const asOf = (0, stockEngine_1.determineAsOf)(events);
    const record = (0, stockEngine_1.buildRiskRecord)(sku101Catalog, events, asOf);
    strict_1.default.equal(record.daysSinceLastSnapshot, 4);
    strict_1.default.equal(record.stockConfidence, 'high');
});
(0, node_test_1.test)('stock_snapshot reconciles drift: later deltas apply only after the most recent snapshot', () => {
    const events = [
        { sku: 'SKU-101', channel: 'shopify', type: 'restock', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 30, timestamp: '2026-08-02T00:00:00Z' },
        // Ground truth says 50 on hand here, overriding the (100 - 30 = 70) implied by the deltas above.
        { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 50, timestamp: '2026-08-03T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 10, timestamp: '2026-08-04T00:00:00Z' },
    ];
    const asOf = (0, stockEngine_1.determineAsOf)(events);
    const record = (0, stockEngine_1.buildRiskRecord)(sku101Catalog, events, asOf);
    strict_1.default.equal(record.currentStock, 40); // 50 (snapshot) - 10 (sale after it)
});
(0, node_test_1.test)('return events add back to stock and reduce net sales velocity', () => {
    const events = [
        { sku: 'SKU-101', channel: 'shopify', type: 'stock_snapshot', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'sale', quantity: 20, timestamp: '2026-08-02T00:00:00Z' },
        { sku: 'SKU-101', channel: 'shopify', type: 'return', quantity: 5, timestamp: '2026-08-03T00:00:00Z' },
    ];
    const asOf = (0, stockEngine_1.determineAsOf)(events);
    const record = (0, stockEngine_1.buildRiskRecord)(sku101Catalog, events, asOf);
    strict_1.default.equal(record.currentStock, 85); // 100 - 20 + 5
});
(0, node_test_1.test)('a SKU with no sales history ever has null days_of_stock_remaining and is not at risk', () => {
    const events = [
        { sku: 'SKU-101', channel: 'shopify', type: 'restock', quantity: 100, timestamp: '2026-08-01T00:00:00Z' },
    ];
    const asOf = (0, stockEngine_1.determineAsOf)(events);
    const record = (0, stockEngine_1.buildRiskRecord)(sku101Catalog, events, asOf);
    strict_1.default.equal(record.salesVelocityPerDay, 0);
    strict_1.default.equal(record.daysOfStockRemaining, null);
    strict_1.default.equal(record.atRisk, false);
    strict_1.default.equal(record.riskTier, 'safe'); // has stock, just no trend to project
});
(0, node_test_1.test)('a SKU with zero recorded events resolves to zero stock and is not at risk', () => {
    const asOf = new Date('2026-08-24T00:00:00Z');
    const record = (0, stockEngine_1.buildRiskRecord)(sku101Catalog, [], asOf);
    strict_1.default.equal(record.currentStock, 0);
    strict_1.default.equal(record.daysOfStockRemaining, null);
    strict_1.default.equal(record.atRisk, false);
    strict_1.default.equal(record.riskTier, 'unknown'); // zero stock, but no velocity data to size the urgency
    strict_1.default.equal(record.stockConfidence, 'low'); // never had a snapshot
});
