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
import { parseEvents } from './parseEvents';
import { determineAsOf, computeAllRiskRecords } from './stockEngine';
import { allocateBudget } from './allocateBudget';
import { SKU_CATALOG, WEEKLY_REORDER_BUDGET } from './catalog';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_TYPES = ['sale', 'sale', 'sale', 'sale', 'return', 'restock', 'stock_snapshot'] as const;

// Deterministic PRNG (mulberry32) so benchmark runs are reproducible run-to-run,
// instead of relying on Math.random() and getting slightly different data (and
// noisier timings) on every invocation.
function mulberry32(seed: number): () => number {
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
function generateSyntheticRecords(count: number, seed = 42): unknown[] {
  const rng = mulberry32(seed);
  const startMs = Date.now() - 730 * MS_PER_DAY;
  const records: unknown[] = [];

  for (let i = 0; i < count; i++) {
    const sku = SKU_CATALOG[Math.floor(rng() * SKU_CATALOG.length)].sku;
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

function log2(n: number): number {
  return Math.log(n) / Math.log(2);
}

function timeMs(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000;
}

function runBenchmarkAtScale(count: number): void {
  const raw = generateSyntheticRecords(count);

  let valid: ReturnType<typeof parseEvents>['valid'] = [];
  const parseTime = timeMs(() => {
    ({ valid } = parseEvents(raw));
  });

  let riskRecords: ReturnType<typeof computeAllRiskRecords> = [];
  const riskTime = timeMs(() => {
    const asOf = determineAsOf(valid);
    riskRecords = computeAllRiskRecords(SKU_CATALOG, valid, asOf);
  });

  const allocateTime = timeMs(() => {
    allocateBudget(riskRecords, WEEKLY_REORDER_BUDGET);
  });

  const totalMs = parseTime + riskTime + allocateTime;
  // Normalized constant: total_ms / (E * log2(E)). If the pipeline really is
  // O(E log E), this ratio should stay roughly flat across wildly different scales.
  // If it were secretly O(E^2), this number would climb sharply as E grows instead.
  const normalized = totalMs / (count * log2(count));

  console.log(
    `${count.toString().padStart(9)} events | parse ${parseTime.toFixed(2).padStart(8)}ms | ` +
      `risk ${riskTime.toFixed(2).padStart(8)}ms | allocate ${allocateTime.toFixed(3).padStart(7)}ms | ` +
      `total ${totalMs.toFixed(2).padStart(9)}ms | total/(E*log2 E) = ${normalized.toExponential(3)}`
  );
}

function main(): void {
  const argScales = process.argv.slice(2).join(',').split(',').filter(Boolean).map(Number);
  const scales = argScales.length > 0 ? argScales : [1_000, 10_000, 100_000, 500_000];

  console.log('\n=== Pipeline Performance Benchmark ===');
  console.log('Claim being tested: parsing + risk computation + allocation is O(E log E) time.');
  console.log('If true, "total/(E*log2 E)" below should stay roughly constant across scales.\n');

  for (const scale of scales) {
    runBenchmarkAtScale(scale);
  }
  console.log('');
}

main();
