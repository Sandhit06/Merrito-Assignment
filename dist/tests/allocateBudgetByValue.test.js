"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const allocateBudgetByValue_1 = require("../allocateBudgetByValue");
function record(overrides) {
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
(0, node_test_1.test)('funds the SKU with the highest value-per-rupee first, not the most urgent one', () => {
    const records = [
        // Most urgent (fewest days left), but low velocity/low unit cost -> low value at risk.
        record({
            sku: 'SKU-URGENT-LOWVALUE',
            daysOfStockRemaining: 1,
            salesVelocityPerDay: 1,
            unitCost: 50,
            idealReorderQuantity: 13,
            idealReorderCost: 650,
        }),
        // Less urgent, but high velocity + high unit cost -> much more value at risk per rupee.
        record({
            sku: 'SKU-SLOW-HIGHVALUE',
            daysOfStockRemaining: 10,
            salesVelocityPerDay: 50,
            unitCost: 200,
            idealReorderQuantity: 500,
            idealReorderCost: 100000,
        }),
    ];
    const result = (0, allocateBudgetByValue_1.allocateBudgetByValue)(records, 100000);
    const lowValue = result.find((r) => r.sku === 'SKU-URGENT-LOWVALUE');
    const highValue = result.find((r) => r.sku === 'SKU-SLOW-HIGHVALUE');
    // valueAtRisk = velocity * unitCost * (leadTime - daysLeft):
    //   SKU-URGENT-LOWVALUE: 1 * 50 * (14-1) = 650   -> valuePerRupee = 650/650 = 1
    //   SKU-SLOW-HIGHVALUE:  50 * 200 * (14-10) = 40000 -> valuePerRupee = 40000/100000 = 0.4
    // So SKU-URGENT-LOWVALUE actually wins on value-per-rupee here, illustrating the
    // ranking is driven by the ratio, not just being "more urgent" or "bigger in absolute terms".
    strict_1.default.equal(lowValue.recommendReorder, true);
    strict_1.default.equal(lowValue.reorderQuantity, 13);
    strict_1.default.equal(highValue.recommendReorder, true);
    // Remaining budget after funding the low-value SKU in full: 100000 - 650 = 99350,
    // which doesn't cover the high-value SKU's full ideal cost (100000), so it's partial.
    strict_1.default.ok(highValue.reorderQuantity < 500);
    strict_1.default.ok(highValue.reorderQuantity > 0);
});
(0, node_test_1.test)('never allocates more than the given budget', () => {
    const records = [
        record({ sku: 'SKU-A', daysOfStockRemaining: 1, unitCost: 137, idealReorderQuantity: 233, idealReorderCost: 137 * 233 }),
        record({ sku: 'SKU-B', daysOfStockRemaining: 4, unitCost: 61, idealReorderQuantity: 401, idealReorderCost: 61 * 401 }),
        record({ sku: 'SKU-C', daysOfStockRemaining: 9, unitCost: 29, idealReorderQuantity: 900, idealReorderCost: 29 * 900 }),
    ];
    const result = (0, allocateBudgetByValue_1.allocateBudgetByValue)(records, 20000);
    const total = result.reduce((sum, r) => sum + r.reorderCost, 0);
    strict_1.default.ok(total <= 20000);
});
(0, node_test_1.test)('SKUs that are not at risk pass through with zero value at risk and no reorder', () => {
    const records = [record({ sku: 'SKU-FINE', atRisk: false, idealReorderQuantity: 0, idealReorderCost: 0, daysOfStockRemaining: 250 })];
    const result = (0, allocateBudgetByValue_1.allocateBudgetByValue)(records, 20000);
    strict_1.default.equal(result[0].recommendReorder, false);
    strict_1.default.equal(result[0].reorderQuantity, 0);
    strict_1.default.equal(result[0].valueAtRisk, 0);
});
