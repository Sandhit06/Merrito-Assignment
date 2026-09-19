// Shared types for the pipeline.
//
// Internal stuff below is normal camelCase. The output shape (snake_case) is what
// actually gets written to disk - kept separate on purpose. Those fields mirror the
// brief's own worked example almost word for word (days_of_stock_remaining,
// reorder_quantity, etc) so it's easy to eyeball against their sample, but I didn't
// want snake_case leaking into the rest of the code.

export type EventType = 'sale' | 'return' | 'restock' | 'stock_snapshot';

// A bit more useful than the plain atRisk boolean, since ops doesn't really think in
// true/false. Rules for these live in stockEngine.ts (computeRiskTier):
//   critical  already out, or will be by end of today
//   urgent    at risk, runs out in under half the lead time
//   watch     at risk, but there's still some runway left
//   safe      not at risk
//   unknown   zero stock but no sales history, so nothing to project a trend from -
//             can't say how urgent it is, just that someone should take a look
export type RiskTier = 'critical' | 'urgent' | 'watch' | 'safe' | 'unknown';

// How much to trust the currentStock number. 'low' = it's been a while (or never)
// since a real stock_snapshot headcount, so sale/return/restock deltas have had more
// room to drift from what's actually on the shelf without anyone catching it.
export type StockConfidence = 'high' | 'low';

/** A single raw inventory event, as read from inventory_events.json. */
export interface InventoryEvent {
  sku: string;
  channel: string;
  type: EventType;
  quantity: number;
  timestamp: string;
}

/** An event record that failed validation and was skipped (never thrown/crashed on). */
export interface SkippedEvent {
  index: number;
  raw: unknown;
  reason: string;
}

/** Fixed SKU catalog entry (SKU -> primary channel + unit cost), given in the brief. */
export interface SkuCatalogEntry {
  sku: string;
  primaryChannel: string;
  unitCost: number;
}

/** Per-SKU stockout risk assessment, BEFORE any weekly budget constraint is applied. */
export interface SkuRiskRecord {
  sku: string;
  primaryChannel: string;
  unitCost: number;
  currentStock: number;
  salesVelocityPerDay: number;
  daysOfStockRemaining: number | null;
  atRisk: boolean;
  riskTier: RiskTier;
  /** Days since the last real stock_snapshot for this SKU, or null if it's never had one. */
  daysSinceLastSnapshot: number | null;
  stockConfidence: StockConfidence;
  /** Uncapped reorder quantity that would top this SKU up to exactly cover the lead time. */
  idealReorderQuantity: number;
  idealReorderCost: number;
}

/** SkuRiskRecord plus the final, budget-constrained funding decision for this week. */
export interface SkuRecommendation extends SkuRiskRecord {
  recommendReorder: boolean;
  reorderQuantity: number;
  reorderCost: number;
  fundingNote: string;
}

/** Final, ops-facing JSON shape for a single SKU (snake_case; see file header). */
export interface OutputRecord {
  sku: string;
  primary_channel: string;
  unit_cost: number;
  current_stock: number;
  sales_velocity_per_day: number;
  days_of_stock_remaining: number | null;
  at_risk: boolean;
  risk_tier: RiskTier;
  days_since_last_snapshot: number | null;
  stock_confidence: StockConfidence;
  recommend_reorder: boolean;
  reorder_quantity: number;
  reorder_cost: number;
  ideal_reorder_quantity: number;
  ideal_reorder_cost: number;
  funding_note: string;
}

/** Run-level summary included alongside the per-SKU recommendations. */
export interface OutputSummary {
  as_of: string;
  total_events_read: number;
  valid_events_processed: number;
  events_skipped: number;
  weekly_reorder_budget: number;
  total_allocated_cost: number;
  remaining_budget: number;
  sku_at_risk_count: number;
  sku_funded_count: number;
}

/** The complete JSON document written to output/recommendations.json. */
export interface RecommendationOutput {
  summary: OutputSummary;
  recommendations: OutputRecord[];
  skipped_events: Array<{ index: number; reason: string; raw: unknown }>;
}
