"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineAsOf = determineAsOf;
exports.groupBySku = groupBySku;
exports.buildRiskRecord = buildRiskRecord;
exports.computeAllRiskRecords = computeAllRiskRecords;
const catalog_1 = require("./catalog");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// "Now" for this run is the latest timestamp actually seen in the data, not the
// system clock. That way the same input always gives the same answer, whether you
// run it today or six months from now.
function determineAsOf(events) {
    if (events.length === 0)
        return new Date();
    let max = new Date(events[0].timestamp).getTime();
    for (const e of events) {
        const t = new Date(e.timestamp).getTime();
        if (t > max)
            max = t;
    }
    return new Date(max);
}
// Buckets events by SKU. channel is just metadata here, not something stock gets
// split by - one SKU has one shared stockroom feeding Shopify/Amazon/Flipkart all at
// once, so every event replays against the same running total regardless of which
// channel it came through.
function groupBySku(events) {
    const map = new Map();
    for (const e of events) {
        const list = map.get(e.sku);
        if (list)
            list.push(e);
        else
            map.set(e.sku, [e]);
    }
    return map;
}
// Replays a SKU's events oldest-to-newest to work out what's actually on the shelf
// right now. stock_snapshot is a real headcount so it overwrites the running total
// outright (fixes drift from anything we never saw); sale subtracts, return/restock
// add. Clamped at 0 since stock can't go negative - treat that as already out.
// Also returns the timestamp of the last snapshot seen (or null), which is what
// stock_confidence is based on.
function reconstructCurrentStock(sortedEvents) {
    let stock = 0;
    let lastSnapshotAt = null;
    for (const e of sortedEvents) {
        switch (e.type) {
            case 'stock_snapshot':
                stock = e.quantity;
                lastSnapshotAt = new Date(e.timestamp);
                break;
            case 'sale':
                stock -= e.quantity;
                break;
            case 'return':
            case 'restock':
                stock += e.quantity;
                break;
        }
    }
    return { stock: Math.max(0, stock), lastSnapshotAt };
}
// Turns the plain at_risk boolean into a tier ops can triage by at a glance.
// critical/urgent/watch are all still at_risk=true underneath; unknown is the one
// case the boolean can't express at all (zero stock, no sales history to project
// a trend from - see the null-velocity handling in buildRiskRecord).
function computeRiskTier(daysOfStockRemaining, currentStock, leadTimeDays) {
    if (daysOfStockRemaining === null) {
        return currentStock === 0 ? 'unknown' : 'safe';
    }
    if (daysOfStockRemaining <= 0)
        return 'critical';
    if (daysOfStockRemaining < leadTimeDays * catalog_1.URGENT_TIER_FRACTION)
        return 'urgent';
    if (daysOfStockRemaining < leadTimeDays)
        return 'watch';
    return 'safe';
}
// 'low' means either this SKU has never had a physical recount at all (currentStock
// is pure delta arithmetic from zero, nothing catching drift), or the last one is
// stale enough that a fair number of sale/return/restock events have piled up on top
// of it since. Purely informational - doesn't touch at_risk or the tier, just tells
// ops how much to trust the number.
function computeStockConfidence(lastSnapshotAt, daysSinceLastSnapshot) {
    if (lastSnapshotAt === null)
        return 'low';
    if (daysSinceLastSnapshot !== null && daysSinceLastSnapshot > catalog_1.STALE_SNAPSHOT_DAYS_THRESHOLD)
        return 'low';
    return 'high';
}
// Rough units-sold-per-day over the trailing window. If a SKU doesn't have a full
// window of history yet (new SKU, gap in the data, whatever) just use however much
// history we've got instead of dividing by a mostly-empty window. Returns get
// subtracted out, since a returned unit was never really "demand" to begin with.
function computeVelocity(sortedEvents, asOf) {
    if (sortedEvents.length === 0)
        return 0;
    const earliest = new Date(sortedEvents[0].timestamp);
    const windowStart = new Date(asOf.getTime() - catalog_1.VELOCITY_WINDOW_DAYS * MS_PER_DAY);
    const hasFullWindow = earliest.getTime() <= windowStart.getTime();
    const effectiveStart = hasFullWindow ? windowStart : earliest;
    const windowDays = hasFullWindow
        ? catalog_1.VELOCITY_WINDOW_DAYS
        : Math.max(1, (asOf.getTime() - earliest.getTime()) / MS_PER_DAY);
    let sold = 0;
    let returned = 0;
    for (const e of sortedEvents) {
        const t = new Date(e.timestamp).getTime();
        if (t < effectiveStart.getTime() || t > asOf.getTime())
            continue;
        if (e.type === 'sale')
            sold += e.quantity;
        else if (e.type === 'return')
            returned += e.quantity;
    }
    const netUnitsSold = Math.max(0, sold - returned);
    return netUnitsSold / windowDays;
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
// Pulls it together for one SKU: stock on hand, sell rate, days left, the at-risk
// flag, and the ideal (budget-agnostic) reorder quantity/cost.
function buildRiskRecord(catalogEntry, eventsForSku, asOf) {
    const sorted = [...eventsForSku].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const { stock: currentStock, lastSnapshotAt } = reconstructCurrentStock(sorted);
    const velocity = computeVelocity(sorted, asOf);
    // nothing to project without sales history, so don't try
    const daysOfStockRemaining = velocity > 0 ? currentStock / velocity : null;
    const roundedDaysOfStockRemaining = daysOfStockRemaining !== null ? round2(daysOfStockRemaining) : null;
    // at risk if it'd run out before a reorder placed today could actually land
    const atRisk = daysOfStockRemaining !== null && daysOfStockRemaining < catalog_1.REORDER_LEAD_TIME_DAYS;
    // top up to cover the full lead time: ceil(velocity * lead_time) - stock_on_hand
    const idealReorderQuantity = atRisk
        ? Math.max(0, Math.ceil(velocity * catalog_1.REORDER_LEAD_TIME_DAYS) - currentStock)
        : 0;
    const daysSinceLastSnapshot = lastSnapshotAt !== null ? round2((asOf.getTime() - lastSnapshotAt.getTime()) / MS_PER_DAY) : null;
    return {
        sku: catalogEntry.sku,
        primaryChannel: catalogEntry.primaryChannel,
        unitCost: catalogEntry.unitCost,
        currentStock,
        salesVelocityPerDay: round2(velocity),
        daysOfStockRemaining: roundedDaysOfStockRemaining,
        atRisk,
        riskTier: computeRiskTier(roundedDaysOfStockRemaining, currentStock, catalog_1.REORDER_LEAD_TIME_DAYS),
        daysSinceLastSnapshot,
        stockConfidence: computeStockConfidence(lastSnapshotAt, daysSinceLastSnapshot),
        idealReorderQuantity,
        idealReorderCost: idealReorderQuantity * catalogEntry.unitCost,
    };
}
// Same thing, but for every SKU in the catalog.
function computeAllRiskRecords(catalog, events, asOf) {
    const grouped = groupBySku(events);
    return catalog.map((entry) => buildRiskRecord(entry, grouped.get(entry.sku) ?? [], asOf));
}
