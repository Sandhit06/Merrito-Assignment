import {
  SkuRecommendation,
  SkippedEvent,
  OutputSummary,
  OutputRecord,
  RecommendationOutput,
} from './types';

function toOutputRecord(r: SkuRecommendation): OutputRecord {
  return {
    sku: r.sku,
    primary_channel: r.primaryChannel,
    unit_cost: r.unitCost,
    current_stock: r.currentStock,
    sales_velocity_per_day: r.salesVelocityPerDay,
    days_of_stock_remaining: r.daysOfStockRemaining,
    at_risk: r.atRisk,
    risk_tier: r.riskTier,
    days_since_last_snapshot: r.daysSinceLastSnapshot,
    stock_confidence: r.stockConfidence,
    recommend_reorder: r.recommendReorder,
    reorder_quantity: r.reorderQuantity,
    reorder_cost: r.reorderCost,
    ideal_reorder_quantity: r.idealReorderQuantity,
    ideal_reorder_cost: r.idealReorderCost,
    funding_note: r.fundingNote,
  };
}

export function buildOutput(params: {
  asOf: Date;
  totalEventsRead: number;
  validEventsProcessed: number;
  skippedEvents: SkippedEvent[];
  weeklyReorderBudget: number;
  recommendations: SkuRecommendation[];
}): RecommendationOutput {
  const sorted = [...params.recommendations].sort((a, b) => a.sku.localeCompare(b.sku));
  const totalAllocatedCost = sorted.reduce((sum, r) => sum + r.reorderCost, 0);

  const summary: OutputSummary = {
    as_of: params.asOf.toISOString(),
    total_events_read: params.totalEventsRead,
    valid_events_processed: params.validEventsProcessed,
    events_skipped: params.skippedEvents.length,
    weekly_reorder_budget: params.weeklyReorderBudget,
    total_allocated_cost: totalAllocatedCost,
    remaining_budget: params.weeklyReorderBudget - totalAllocatedCost,
    sku_at_risk_count: sorted.filter((r) => r.atRisk).length,
    sku_funded_count: sorted.filter((r) => r.recommendReorder).length,
  };

  return {
    summary,
    recommendations: sorted.map(toOutputRecord),
    skipped_events: params.skippedEvents.map((s) => ({ index: s.index, reason: s.reason, raw: s.raw })),
  };
}

export function printConsoleReport(output: RecommendationOutput): void {
  const { summary, recommendations, skipped_events: skippedEvents } = output;

  console.log('\n=== Inventory Stockout Risk & Reorder Recommendations ===');
  console.log(`As of: ${summary.as_of}`);
  console.log(
    `Events read: ${summary.total_events_read} | Valid: ${summary.valid_events_processed} | Skipped (malformed): ${summary.events_skipped}`
  );
  console.log(
    `Weekly budget: Rs. ${summary.weekly_reorder_budget.toLocaleString()} | Allocated: Rs. ${summary.total_allocated_cost.toLocaleString()} | Remaining: Rs. ${summary.remaining_budget.toLocaleString()}`
  );
  console.log(`SKUs at risk: ${summary.sku_at_risk_count} | SKUs funded this week: ${summary.sku_funded_count}\n`);

  console.table(
    recommendations.map((r) => ({
      sku: r.sku,
      channel: r.primary_channel,
      stock: r.current_stock,
      'units/day': r.sales_velocity_per_day,
      days_left: r.days_of_stock_remaining,
      at_risk: r.at_risk,
      tier: r.risk_tier,
      confidence: r.stock_confidence,
      reorder: r.recommend_reorder,
      qty: r.reorder_quantity,
      cost: r.reorder_cost,
      note: r.funding_note,
    }))
  );

  if (skippedEvents.length > 0) {
    console.log(`\nSkipped ${skippedEvents.length} malformed event(s):`);
    skippedEvents.slice(0, 20).forEach((s) => {
      console.log(`  [index ${s.index}] ${s.reason}`);
    });
    if (skippedEvents.length > 20) {
      console.log(`  ... and ${skippedEvents.length - 20} more.`);
    }
  }
  console.log('');
}
