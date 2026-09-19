"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Standalone perf benchmark, NOT part of the primary pipeline or test suite. The
// README states the pipeline is O(E log E) time / O(E) space, dominated by sorting
// each SKU's events for chronological replay. Rather than leaving that as an
// unverified claim, this generates synthetic event logs at increasing scale and
// times the real code (parseEvents -> computeAllRiskRecords -> allocateBudget)
// against each, so the near-linearithmic scaling shows up as actual numbers instead
// of just being asserted.
//
// Usage: node dist/benchmark.js [scale1,scale2,...]
// Defaults to 1000, 10000, 100000, 500000 events.
const parseEvents_1 = require("./parseEvents");
const stockEngine_1 = require("./stockEngine");
const allocateBudget_1 = require("./allocateBudget");
const catalog_1 = require("./catalog");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_TYPES = ['sale', 'sale', 'sale', 'sale', 'return', 'restock', 'stock_snapshot'];
// Deterministic PRNG (mulberry32) so benchmark runs are reproducible run-to-run,
// instead of relying on Math.random() and getting slightly different data (and
// noisier timings) on every invocation.
function mulberry32(seed) {
    let a = seed;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// Builds `count` raw (unvalidated) event records spread across the fixed 4-SKU
// catalog and a ~2-year span, so parseEvents has to do real validation work too,
// not just get handed a pre-cleaned array. A small, fixed fraction are deliberately
// malformed (mirrors the real data always having a few bad rows to skip).
function generateSyntheticRecords(count, seed = 42) {
    const rng = mulberry32(seed);
    const startMs = Date.now() - 730 * MS_PER_DAY;
    const records = [];
    for (let i = 0; i < count; i++) {
        const sku = catalog_1.SKU_CATALOG[Math.floor(rng() * catalog_1.SKU_CATALOG.length)].sku;
        const type = EVENT_TYPES[Math.floor(rng() * EVENT_TYPES.length)];
        const timestamp = new Date(startMs + Math.floor(rng() * 730 * MS_PER_DAY)).toISOString();
        const quantity = type === 'stock_snapshot' ? Math.floor(rng() * 1000) : 1 + Math.floor(rng() * 50);
        // ~0.5% malformed, same categories the real data actually contains.
        const malformedRoll = rng();
        if (malformedRoll < 0.002) {
            records.push({ sku, channel: 'shopify', type, quantity }); // missing timestamp
            continue;
        }
        if (malformedRoll < 0.004) {
            records.push({ sku, channel: 'shopify', type, quantity: 'N/A', timestamp }); // bad quantity
            continue;
        }
        if (malformedRoll < 0.005) {
            records.push({ sku, channel: 'shopify', type, quantity, timestamp: 'not-a-date' }); // bad timestamp
            continue;
        }
        records.push({ sku, channel: 'shopify', type, quantity, timestamp });
    }
    return records;
}
function log2(n) {
    return Math.log(n) / Math.log(2);
}
function timeMs(fn) {
    const start = process.hrtime.bigint();
    fn();
    const end = process.hrtime.bigint();
    return Number(end - start) / 1000000;
}
function runBenchmarkAtScale(count) {
    const raw = generateSyntheticRecords(count);
    let valid = [];
    const parseTime = timeMs(() => {
        ({ valid } = (0, parseEvents_1.parseEvents)(raw));
    });
    let riskRecords = [];
    const riskTime = timeMs(() => {
        const asOf = (0, stockEngine_1.determineAsOf)(valid);
        riskRecords = (0, stockEngine_1.computeAllRiskRecords)(catalog_1.SKU_CATALOG, valid, asOf);
    });
    const allocateTime = timeMs(() => {
        (0, allocateBudget_1.allocateBudget)(riskRecords, catalog_1.WEEKLY_REORDER_BUDGET);
    });
    const totalMs = parseTime + riskTime + allocateTime;
    // Normalized constant: total_ms / (E * log2(E)). If the pipeline really is
    // O(E log E), this ratio should stay roughly flat across wildly different scales.
    // If it were secretly O(E^2), this number would climb sharply as E grows instead.
    const normalized = totalMs / (count * log2(count));
    console.log(`${count.toString().padStart(9)} events | parse ${parseTime.toFixed(2).padStart(8)}ms | ` +
        `risk ${riskTime.toFixed(2).padStart(8)}ms | allocate ${allocateTime.toFixed(3).padStart(7)}ms | ` +
        `total ${totalMs.toFixed(2).padStart(9)}ms | total/(E*log2 E) = ${normalized.toExponential(3)}`);
}
function main() {
    const argScales = process.argv.slice(2).join(',').split(',').filter(Boolean).map(Number);
    const scales = argScales.length > 0 ? argScales : [1000, 10000, 100000, 500000];
    console.log('\n=== Pipeline Performance Benchmark ===');
    console.log('Claim being tested: parsing + risk computation + allocation is O(E log E) time.');
    console.log('If true, "total/(E*log2 E)" below should stay roughly constant across scales.\n');
    for (const scale of scales) {
        runBenchmarkAtScale(scale);
    }
    console.log('');
}
main();
