import { SkuRiskRecord, SkuRecommendation } from './types';
import { WEEKLY_REORDER_BUDGET } from './catalog';

// Decides who actually gets a PO this week when the budget won't stretch to cover
// everyone. Sorts at-risk SKUs soonest-to-run-out first, funds each one in full
// until the money runs out. Whoever's next in line when we can't afford their full
// order gets whatever's left as a partial order; everyone after that gets nothing
// this week, but stays marked at_risk so they don't quietly disappear from the report.
//
// This is a "fix what's about to break first" rule, not a value-optimizing one. Easy
// to explain to an ops person and cheap to compute, but it's a heuristic, not a
// guaranteed-optimal knapsack solution - see README.md for the full trade-off
// discussion.
export function allocateBudget(
  riskRecords: SkuRiskRecord[],
  budget: number = WEEKLY_REORDER_BUDGET
): SkuRecommendation[] {
  const atRiskNeedingReorder = riskRecords.filter((r) => r.atRisk && r.idealReorderQuantity > 0);
  const everythingElse = riskRecords.filter((r) => !(r.atRisk && r.idealReorderQuantity > 0));

  const ranked = [...atRiskNeedingReorder].sort((a, b) => {
    const daysA = a.daysOfStockRemaining ?? Number.POSITIVE_INFINITY;
    const daysB = b.daysOfStockRemaining ?? Number.POSITIVE_INFINITY;
    if (daysA !== daysB) return daysA - daysB; // soonest stockout first
    if (a.salesVelocityPerDay !== b.salesVelocityPerDay) return b.salesVelocityPerDay - a.salesVelocityPerDay; // faster mover first
    return a.unitCost - b.unitCost; // cheaper to fix first
  });

  let remaining = budget;
  const funded: SkuRecommendation[] = [];

  for (const record of ranked) {
    if (remaining <= 0) {
      funded.push(
        toRecommendation(record, 0, 'Not funded this week: budget already exhausted by higher-priority (more urgent) SKUs.')
      );
      continue;
    }
    if (record.idealReorderCost <= remaining) {
      funded.push(toRecommendation(record, record.idealReorderQuantity, 'Fully funded at ideal reorder quantity.'));
      remaining -= record.idealReorderCost;
    } else {
      const partialQty = Math.floor(remaining / record.unitCost);
      if (partialQty > 0) {
        funded.push(
          toRecommendation(
            record,
            partialQty,
            `Partially funded: remaining budget covered ${partialQty} of the ideal ${record.idealReorderQuantity} units.`
          )
        );
        remaining -= partialQty * record.unitCost;
      } else {
        funded.push(toRecommendation(record, 0, 'Not funded this week: remaining budget cannot cover even 1 unit.'));
      }
    }
  }

  const passthrough = everythingElse.map((record) =>
    toRecommendation(
      record,
      0,
      record.atRisk
        ? 'At risk but no reorder needed (already at or above the ideal lead-time-covering quantity).'
        : 'Not at risk: sufficient stock relative to recent sales velocity.'
    )
  );

  return [...funded, ...passthrough];
}

function toRecommendation(record: SkuRiskRecord, fundedQty: number, note: string): SkuRecommendation {
  return {
    ...record,
    recommendReorder: fundedQty > 0,
    reorderQuantity: fundedQty,
    reorderCost: fundedQty * record.unitCost,
    fundingNote: note,
  };
}
