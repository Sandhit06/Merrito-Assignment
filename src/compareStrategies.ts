// Standalone diagnostic script, NOT part of the primary recommendation pipeline.
// main.ts's output (urgency-first allocation, via allocateBudget.ts) is still "the
// answer". This just proves, with real numbers on the real data, what a differently
// optimized allocation strategy would have done instead - turning the "greedy
// urgency-first isn't provably value-optimal" trade-off (discussed in the README and
// README.internal.md) into something you can actually run and see, not just prose.
//
// Usage: node dist/compareStrategies.js [path/to/inventory_events.json] [path/to/output.json]
import * as fs from 'fs';
import * as path from 'path';
import { loadEvents } from './parseEvents';
import { determineAsOf, computeAllRiskRecords } from './stockEngine';
import { allocateBudget } from './allocateBudget';
import { allocateBudgetByValue } from './allocateBudgetByValue';
import { SKU_CATALOG, WEEKLY_REORDER_BUDGET, REORDER_LEAD_TIME_DAYS } from './catalog';
import { SkuRecommendation } from './types';

// "Value protected" for a SKU = valueAtRisk (see allocateBudgetByValue.ts) scaled by
// how much of its ideal reorder actually got funded - a SKU funded for half its
// ideal quantity is treated as protecting roughly half the value at risk. Used only
// to compare the two strategies' overall outcomes, not part of either one's own logic.
function totalValueProtected(
  recommendations: SkuRecommendation[],
  valueAtRiskBySku: Map<string, number>
): number {
  let total = 0;
  for (const r of recommendations) {
    if (r.idealReorderQuantity <= 0) continue;
    const valueAtRisk = valueAtRiskBySku.get(r.sku) ?? 0;
    const fractionFunded = Math.min(1, r.reorderQuantity / r.idealReorderQuantity);
    total += valueAtRisk * fractionFunded;
  }
  return Math.round(total * 100) / 100;
}

function main(): void {
  const inputPath = process.argv[2] ?? path.join(__dirname, '..', 'data', 'inventory_events.json');
  const outputPath = process.argv[3] ?? path.join(__dirname, '..', 'output', 'strategy_comparison.json');

  const { valid } = loadEvents(inputPath);
  const asOf = determineAsOf(valid);
  const riskRecords = computeAllRiskRecords(SKU_CATALOG, valid, asOf);

  const urgencyFirst = allocateBudget(riskRecords, WEEKLY_REORDER_BUDGET);
  const valueOptimized = allocateBudgetByValue(riskRecords, WEEKLY_REORDER_BUDGET);

  const valueAtRiskBySku = new Map(valueOptimized.map((r) => [r.sku, r.valueAtRisk]));
  const urgencyValueProtected = totalValueProtected(urgencyFirst, valueAtRiskBySku);
  const valueValueProtected = totalValueProtected(valueOptimized, valueAtRiskBySku);

  console.log('\n=== Allocation Strategy Comparison ===');
  console.log(`As of: ${asOf.toISOString()} | Budget: Rs. ${WEEKLY_REORDER_BUDGET.toLocaleString()} | Lead time: ${REORDER_LEAD_TIME_DAYS} days\n`);

  console.table(
    riskRecords
      .filter((r) => r.atRisk)
      .map((r) => {
        const urgency = urgencyFirst.find((u) => u.sku === r.sku)!;
        const value = valueOptimized.find((v) => v.sku === r.sku)!;
        return {
          sku: r.sku,
          days_left: r.daysOfStockRemaining,
          value_per_rupee: value.valuePerRupee,
          'urgency-first qty': urgency.reorderQuantity,
          'urgency-first cost': urgency.reorderCost,
          'value-optimized qty': value.reorderQuantity,
          'value-optimized cost': value.reorderCost,
        };
      })
  );

  const urgencySpend = urgencyFirst.reduce((sum, r) => sum + r.reorderCost, 0);
  const valueSpend = valueOptimized.reduce((sum, r) => sum + r.reorderCost, 0);

  console.log(`Urgency-first   : spent Rs. ${urgencySpend.toLocaleString()}, value protected \u2248 Rs. ${urgencyValueProtected.toLocaleString()}`);
  console.log(`Value-optimized : spent Rs. ${valueSpend.toLocaleString()}, value protected \u2248 Rs. ${valueValueProtected.toLocaleString()}`);
  console.log(
    valueValueProtected > urgencyValueProtected
      ? `\n=> On this data, value-optimized protects Rs. ${(valueValueProtected - urgencyValueProtected).toLocaleString()} more revenue-at-risk for the same budget.`
      : `\n=> On this data, both strategies protect the same value (no divergence in this dataset).`
  );

  const output = {
    as_of: asOf.toISOString(),
    weekly_reorder_budget: WEEKLY_REORDER_BUDGET,
    urgency_first: {
      total_spend: urgencySpend,
      total_value_protected: urgencyValueProtected,
      recommendations: urgencyFirst,
    },
    value_optimized: {
      total_spend: valueSpend,
      total_value_protected: valueValueProtected,
      recommendations: valueOptimized,
    },
  };

  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\nFull comparison written to: ${path.resolve(outputPath)}`);
}

main();
