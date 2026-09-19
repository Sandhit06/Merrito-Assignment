"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allocateBudgetByValue = allocateBudgetByValue;
const catalog_1 = require("./catalog");
function round2(n) {
    return Math.round(n * 100) / 100;
}
// How much value is riding on fully resolving this SKU: the number of days it'd sit
// stocked out before a reorder placed today could land, times how many units/day it
// moves, times what each unit is worth (unit_cost stands in for revenue/importance
// here - the brief doesn't give us a separate price/margin figure).
function computeValueAtRisk(record, leadTimeDays) {
    const daysOfStockRemaining = record.daysOfStockRemaining ?? 0;
    const shortfallDays = Math.max(0, leadTimeDays - daysOfStockRemaining);
    return round2(record.salesVelocityPerDay * record.unitCost * shortfallDays);
}
function allocateBudgetByValue(riskRecords, budget = catalog_1.WEEKLY_REORDER_BUDGET) {
    const atRiskNeedingReorder = riskRecords.filter((r) => r.atRisk && r.idealReorderQuantity > 0);
    const everythingElse = riskRecords.filter((r) => !(r.atRisk && r.idealReorderQuantity > 0));
    const ranked = atRiskNeedingReorder
        .map((r) => {
        const valueAtRisk = computeValueAtRisk(r, catalog_1.REORDER_LEAD_TIME_DAYS);
        const valuePerRupee = r.idealReorderCost > 0 ? round2(valueAtRisk / r.idealReorderCost) : 0;
        return { record: r, valueAtRisk, valuePerRupee };
    })
        .sort((a, b) => {
        if (a.valuePerRupee !== b.valuePerRupee)
            return b.valuePerRupee - a.valuePerRupee; // best value/rupee first
        if (a.valueAtRisk !== b.valueAtRisk)
            return b.valueAtRisk - a.valueAtRisk; // higher absolute value next
        return a.record.unitCost - b.record.unitCost; // cheaper to fix as final tiebreak
    });
    let remaining = budget;
    const funded = [];
    for (const { record, valueAtRisk, valuePerRupee } of ranked) {
        if (remaining <= 0) {
            funded.push(toValueRecommendation(record, 0, 'Not funded this week: budget already exhausted by higher-value-per-rupee SKUs.', valueAtRisk, valuePerRupee));
            continue;
        }
        if (record.idealReorderCost <= remaining) {
            funded.push(toValueRecommendation(record, record.idealReorderQuantity, 'Fully funded at ideal reorder quantity (highest value protected per rupee).', valueAtRisk, valuePerRupee));
            remaining -= record.idealReorderCost;
        }
        else {
            const partialQty = Math.floor(remaining / record.unitCost);
            if (partialQty > 0) {
                funded.push(toValueRecommendation(record, partialQty, `Partially funded: remaining budget covered ${partialQty} of the ideal ${record.idealReorderQuantity} units.`, valueAtRisk, valuePerRupee));
                remaining -= partialQty * record.unitCost;
            }
            else {
                funded.push(toValueRecommendation(record, 0, 'Not funded this week: remaining budget cannot cover even 1 unit.', valueAtRisk, valuePerRupee));
            }
        }
    }
    const passthrough = everythingElse.map((record) => toValueRecommendation(record, 0, record.atRisk
        ? 'At risk but no reorder needed (already at or above the ideal lead-time-covering quantity).'
        : 'Not at risk: sufficient stock relative to recent sales velocity.', 0, 0));
    return [...funded, ...passthrough];
}
function toValueRecommendation(record, fundedQty, note, valueAtRisk, valuePerRupee) {
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
