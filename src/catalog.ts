import { SkuCatalogEntry } from './types';

/** How long a new order takes to arrive once placed, for every SKU (fixed, given by the brief). */
export const REORDER_LEAD_TIME_DAYS = 14;

/** Total Rs. available for reorders this week, across all SKUs (fixed, given by the brief). */
export const WEEKLY_REORDER_BUDGET = 20000;

// Trailing window (in days) for estimating sales velocity. 30 seemed like a decent
// middle ground: long enough to smooth out one unusually slow or busy week, short
// enough to still track how a SKU is actually selling right now. See README.md.
export const VELOCITY_WINDOW_DAYS = 30;

// Below this fraction of the lead time, an at-risk SKU gets bumped from "watch" to
// "urgent". 7 days left (half the 14-day lead time) is a meaningfully different
// situation for ops than 13 days left, even though both technically count as at_risk.
export const URGENT_TIER_FRACTION = 0.5;

// If a SKU hasn't had a physical recount (stock_snapshot) in this many days, treat
// current_stock as low confidence - more time for sale/return/restock deltas to
// drift from what's actually on the shelf without anyone noticing.
export const STALE_SNAPSHOT_DAYS_THRESHOLD = 10;

// Anything outside these four is malformed and gets skipped.
export const KNOWN_EVENT_TYPES = ['sale', 'return', 'restock', 'stock_snapshot'] as const;

// Fixed catalog from the brief: unit cost + primary channel per SKU.
export const SKU_CATALOG: SkuCatalogEntry[] = [
  { sku: 'SKU-101', primaryChannel: 'shopify', unitCost: 200 },
  { sku: 'SKU-102', primaryChannel: 'amazon', unitCost: 50 },
  { sku: 'SKU-103', primaryChannel: 'flipkart', unitCost: 80 },
  { sku: 'SKU-104', primaryChannel: 'shopify', unitCost: 500 },
];
