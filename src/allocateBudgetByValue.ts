// Alternative to allocateBudget.ts's "fix what's about to break soonest" rule. This
// one ranks at-risk SKUs by how much value (approx. revenue lost while stocked out)
// each rupee of budget protects, and funds the highest value-per-rupee first. Exists
// so we can show, with real numbers on the real data, how much the choice of
// allocation strategy actually matters - see compareStrategies.ts and the README's
// "Appendix: strategy comparison".
//
// Greedy-by-ratio is actually provably optimal here, not just a heuristic: every SKU
// can be funded for any quantity from 0 up to its ideal quantity (partial units are
// allowed, same as allocateBudget.ts). That's the classic "fractional knapsack" case,
// and for fractional knapsack, sorting by value-per-cost and filling top-down is the
// optimal solution. Unlike 0/1 knapsack (where an item has to be taken whole or not
// at all), there's no scenario where skipping a high-ratio item beats it, since
// leftover budget can always buy a fraction of whatever's next best.
import { SkuRiskRecord, SkuRecommendation } from './types';
import { WEEKLY_REORDER_BUDGET, REORDER_LEAD_TIME_DAYS } from './catalog';

export interface ValueRankedRecommendation extends SkuRecommendation {
  /** Approx. revenue this SKU loses while stocked out, if left completely unfunded. */
  valueAtRisk: number;
  /** valueAtRisk per rupee of ideal reorder cost - this is what we rank by. */
  valuePerRupee: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// How much value is riding on fully resolving this SKU: the number of days it'd sit
// stocked out before a reorder placed today could land, times how many units/day it
// moves, times what each unit is worth (unit_cost stands in for revenue/importance
// here - the brief doesn't give us a separate price/margin figure).
function computeValueAtRisk(record: SkuRiskRecord, leadTimeDays: number): number {
  const daysOfStockRemaining = record.daysOfStockRemaining ?? 0;
  const shortfallDays = Math.max(0, leadTimeDays - daysOfStockRemaining);
  return round2(record.salesVelocityPerDay * record.unitCost * shortfallDays);
}

export function allocateBudgetByValue(
  riskRecords: SkuRiskRecord[],
  budget: number = WEEKLY_REORDER_BUDGET
): ValueRankedRecommendation[] {
  const atRiskNeedingReorder = riskRecords.filter((r) => r.atRisk && r.idealReorderQuantity > 0);
  const everythingElse = riskRecords.filter((r) => !(r.atRisk && r.idealReorderQuantity > 0));

  const ranked = atRiskNeedingReorder
    .map((r) => {
      const valueAtRisk = computeValueAtRisk(r, REORDER_LEAD_TIME_DAYS);
      const valuePerRupee = r.idealReorderCost > 0 ? round2(valueAtRisk / r.idealReorderCost) : 0;
      return { record: r, valueAtRisk, valuePerRupee };
    })
    .sort((a, b) => {
      if (a.valuePerRupee !== b.valuePerRupee) return b.valuePerRupee - a.valuePerRupee; // best value/rupee first
      if (a.valueAtRisk !== b.valueAtRisk) return b.valueAtRisk - a.valueAtRisk; // higher absolute value next
      return a.record.unitCost - b.record.unitCost; // cheaper to fix as final tiebreak
    });

  let remaining = budget;
  const funded: ValueRankedRecommendation[] = [];

  for (const { record, valueAtRisk, valuePerRupee } of ranked) {
    if (remaining <= 0) {
      funded.push(
        toValueRecommendation(
          record,
          0,
          'Not funded this week: budget already exhausted by higher-value-per-rupee SKUs.',
          valueAtRisk,
          valuePerRupee
        )
      );
      continue;
    }
    if (record.idealReorderCost <= remaining) {
      funded.push(
        toValueRecommendation(
          record,
          record.idealReorderQuantity,
          'Fully funded at ideal reorder quantity (highest value protected per rupee).',
          valueAtRisk,
          valuePerRupee
        )
      );
      remaining -= record.idealReorderCost;
    } else {
      const partialQty = Math.floor(remaining / record.unitCost);
      if (partialQty > 0) {
        funded.push(
          toValueRecommendation(
            record,
            partialQty,
            `Partially funded: remaining budget covered ${partialQty} of the ideal ${record.idealReorderQuantity} units.`,
            valueAtRisk,
            valuePerRupee
          )
        );
        remaining -= partialQty * record.unitCost;
      } else {
        funded.push(
          toValueRecommendation(
            record,
            0,
            'Not funded this week: remaining budget cannot cover even 1 unit.',
            valueAtRisk,
            valuePerRupee
          )
        );
      }
    }
  }

  const passthrough = everythingElse.map((record) =>
    toValueRecommendation(
      record,
      0,
      record.atRisk
        ? 'At risk but no reorder needed (already at or above the ideal lead-time-covering quantity).'
        : 'Not at risk: sufficient stock relative to recent sales velocity.',
      0,
      0
    )
  );

  return [...funded, ...passthrough];
}

function toValueRecommendation(
  record: SkuRiskRecord,
  fundedQty: number,
  note: string,
  valueAtRisk: number,
  valuePerRupee: number
): ValueRankedRecommendation {
  return {
    ...record,
    recommendReorder: fundedQty > 0,
    reorderQuantity: fundedQty,
    reorderCost: fundedQty * record.unitCost,
    fundingNote: note,
    valueAtRisk,
    valuePerRupee,
  };
}
