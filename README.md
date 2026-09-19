<<<<<<< HEAD
# Inventory Stockout Risk & Reorder Recommendation Tool

A script that reads a per-SKU inventory event log and answers two questions the ops team actually needs answered:

1. Is this SKU going to run out of stock before a reorder placed today could arrive?
2. The budget won't cover a reorder for every at-risk SKU, so which ones actually get a purchase order this week, and how much of each?

Built in TypeScript on Node. No runtime dependencies.

---

## Setup

Needs Node.js 18+ (I'm using the built-in `node:test` runner, so there's no test framework to install).

```bash
npm install
```

That's the whole setup: two dependencies, both dev-only (`typescript` and `@types/node`).

## Running it

```bash
npm start
```

This builds the TypeScript and runs it against the real event log at `data/inventory_events.json`, printing a summary/table to the console and writing the full result to `output/recommendations.json`.

**Want to point it at a different file**? Just pass the path:

```bash
npm run build
node dist/main.js data/inventory_events.json
```

## Tests

```bash
npm test
```

Runs the full suite (`node --test dist/tests`, 22 tests). Covers the three required cases, plus a lot more I added for confidence:

- **Required**: a clearly-fine SKU (plenty of stock vs. sell rate) doesn't get flagged.
- **Required**: a clearly-at-risk SKU (low stock, steady sales, same numbers as the brief's example) gets flagged, and the `days_of_stock_remaining` / `reorder_quantity` / `reorder_cost` math checks out exactly.
- **Required**: malformed events (missing fields, bad timestamp, unknown type, unknown SKU, negative quantity) get skipped, nothing crashes.
- Extra: snapshot reconciliation, returns reducing net velocity, a SKU with zero sales history, every risk tier (`critical`/`urgent`/`watch`/`safe`/`unknown`) and both `stock_confidence` outcomes, budget allocation ranking by urgency and by value-per-rupee and partially funding the cutoff SKU in each, total spend never exceeding the budget under either strategy, and a full end-to-end pass over the real dataset.

## Extras: strategy comparison & performance benchmark

Two standalone scripts, separate from the primary pipeline (they don't change `main.ts`'s output, which is still the actual answer):

```bash
npm run compare-strategies   # urgency-first vs. value-optimized budget allocation, side by side
npm run benchmark            # times the pipeline at 1k/10k/100k/500k synthetic events
```

See "Alternative allocation strategy comparison" and "Time complexity" below for what these actually show.

## What's in here

```
src/
  types.ts                  shared types (internal + the final JSON output shape)
  catalog.ts                 fixed SKU catalog + the fixed parameters (lead time, budget, velocity window, tier/confidence thresholds)
  parseEvents.ts              loads + validates inventory_events.json, skips anything malformed
  stockEngine.ts              stock reconstruction, sales velocity, at-risk logic, risk tiers, stock-data confidence
  allocateBudget.ts           primary strategy: decides who gets funded this week (urgency-first), within budget
  allocateBudgetByValue.ts    alternative strategy: funds by value-protected-per-rupee instead (comparison only)
  compareStrategies.ts        standalone script: runs both strategies on the real data, side by side
  benchmark.ts                standalone script: times the pipeline at increasing event-log scale
  report.ts                   console + JSON output formatting
  main.ts                     wires the primary pipeline together
  tests/                      node:test suites
  allocateBudget.test.ts
  allocateBudgetByValue.test.ts
  pipeline.test.ts
  stockEngine.test.ts
data/
  inventory_events.json  the real event log shared with the brief (see note above)
output/
  recommendations.json   written on each `npm start`, not committed
  strategy_comparison.json  written on each `npm run compare-strategies`, not committed
```

## What the output looks like (console)

```
=== Inventory Stockout Risk & Reorder Recommendations ===
As of: 2026-08-26T23:00:00.000Z
Events read: 53 | Valid: 50 | Skipped (malformed): 3
Weekly budget: Rs. 20,000 | Allocated: Rs. 20,000 | Remaining: Rs. 0
SKUs at risk: 2 | SKUs funded this week: 2

┌─────────┬───────────┬────────────┬───────┬───────────┬───────────┬─────────┬─────────┬────────────┬─────────┬─────┬───────┬─────────────────────────────────────────────────────────┐
│ (index) │ sku       │ channel    │ stock │ units/day │ days_left │ at_risk │ tier     │ confidence │ reorder │ qty │ cost  │ note                                                    │
├─────────┼───────────┼────────────┼───────┼───────────┼───────────┼─────────┼─────────┼────────────┼─────────┼─────┼───────┼─────────────────────────────────────────────────────────┤
│ 0       │ 'SKU-101' │ 'shopify'  │ 80    │ 10        │ 8         │ true    │ 'watch'  │ 'high'     │ true    │ 45  │ 9000  │ 'Partially funded: remaining budget covered 45 of...'  │
│ 1       │ 'SKU-102' │ 'amazon'   │ 500   │ 2         │ 250       │ false   │ 'safe'   │ 'high'     │ false   │ 0   │ 0     │ 'Not at risk: sufficient stock relative to...'         │
│ 2       │ 'SKU-103' │ 'flipkart' │ 192   │ 8         │ 24        │ false   │ 'safe'   │ 'high'     │ false   │ 0   │ 0     │ 'Not at risk: sufficient stock relative to...'         │
│ 3       │ 'SKU-104' │ 'shopify'  │ 20    │ 3         │ 6.67      │ true    │ 'urgent' │ 'high'     │ true    │ 22  │ 11000 │ 'Fully funded at ideal reorder quantity.'              │
└─────────┴───────────┴────────────┴───────┴───────────┴───────────┴─────────┴─────────┴────────────┴─────────┴─────┴───────┴─────────────────────────────────────────────────────────┘

Skipped 3 malformed event(s):
  [index 0] missing or unparsable "timestamp" (got undefined)
  [index 36] missing or non-numeric "quantity"
  [index 52] missing or unparsable "timestamp" (got "not-a-date")
```

`output/recommendations.json` has the same data in full (every SKU's numbers plus a run summary), for anything downstream that wants to consume it programmatically.

---

## Assumptions & Design Decisions

### How I'm defining "at risk of stockout"

For every SKU, I do three things:

1. **Rebuild current stock** by replaying its events in time order. A `stock_snapshot` is a real headcount, so it overwrites whatever's been computed so far. That matters because snapshots "arrive periodically, not on a fixed schedule," so drift can build up between them. `sale` subtracts, `return`/`restock` add. I clamp the result at 0, since stock can't physically go negative.
2. **Work out a daily sell rate** using a trailing 30-day window of net units sold (sales minus returns), counting back from the most recent timestamp anywhere in the data. Thirty days felt like the right middle ground: long enough that one unusually slow or busy week doesn't throw the number off, short enough to still reflect how the product is actually selling *right now* rather than its entire history. If a SKU has under 30 days of data, I just use whatever's available instead of dividing by a mostly-empty window.
3. **Project it forward**: `days_of_stock_remaining = current_stock / velocity`. A SKU counts as at risk if that's strictly less than the 14-day lead time, meaning it'd run dry before a reorder placed *today* could physically show up. If a SKU has never actually sold anything, there's no trend to project, so it's treated as not at risk regardless of how much stock it has.

One more thing worth calling out: `channel` is treated as descriptive metadata, not something that splits the stock. All of a SKU's events, regardless of which channel they came through, get replayed against one shared running total. A `stock_snapshot` is one physical count, which implies one stockroom feeding all three storefronts rather than three separate ones.

Run this against the brief's own worked example and it lines up exactly: SKU-101 with 80 units on hand selling ~10/day comes out to 8 days of stock, under the 14-day lead time, so it gets flagged at risk, with `reorder_quantity: 60` and `reorder_cost: 12000` matching their sample precisely.

### Risk tiers & stock-data confidence

Ops doesn't really think in booleans: "at risk: true" doesn't say whether something needs attention this afternoon or just this week. So alongside `at_risk`, every SKU also gets a `risk_tier`:

| Tier         | Meaning                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `critical` | Projected to already be out, or hit zero today (`days_of_stock_remaining <= 0`)                                                              |
| `urgent`   | At risk, and will run out in under half the lead time (< 7 days here)                                                                          |
| `watch`    | At risk, but there's still some runway before it bites (7–13 days here)                                                                       |
| `safe`     | Not at risk                                                                                                                                    |
| `unknown`  | Zero stock right now, but no sales history to project a trend from. Can't say how urgent it is, but an empty shelf is still worth a human look |

`critical`/`urgent`/`watch` are all still `at_risk: true` underneath. It's a strict refinement of the same boolean, not a separate judgment call.

Each SKU also gets a `stock_confidence` (`high`/`low`), a signal for how much to trust the `current_stock` number itself, independent of risk. It's `low` if the SKU has never had a real `stock_snapshot` headcount at all (the figure is pure delta arithmetic from zero, with nothing to catch drift), or if the last one is more than 10 days old (a fraction of the 14-day lead time; a snapshot that stale has had plenty of time for missed or duplicated delta events to quietly pile up on top of it). This doesn't change `at_risk` or the tier, it's purely a "trust but verify" flag for ops, since a recommendation is only as good as the stock number it's based on.

### How I'm deciding who gets funded when the budget's too tight

Every at-risk SKU gets an "ideal" reorder quantity first: enough to top it back up to cover the full 14 days, `ceil(velocity × 14) − current_stock`. If the total ideal cost across every at-risk SKU comes to more than Rs. 20,000, I sort them by urgency (fewest `days_of_stock_remaining` first) and go down the list funding each one in full until the money's gone:

- Whichever SKU is next in line when the remaining budget can't cover its full ideal order gets a **partial** amount instead: `floor(remaining_budget / unit_cost)`, spending whatever's left.
- Everything after that gets zero units this week. It still stays flagged `at_risk: true` though, since I didn't want an unfunded SKU to just quietly vanish from the report.
- If two SKUs are tied on urgency, I break the tie by higher velocity first (treat the faster mover as more business-critical), then by lower unit cost.

Why urgency-first instead of, say, a value-optimizing knapsack approach? Mostly because it's easy to explain and trust. "We fixed what was about to break soonest" is a one-line justification an ops person can sanity-check without needing to trust a black box, and it's a direct read of the brief's own framing around running out before a reorder can arrive. A cost-efficiency or revenue-weighted approach is equally defensible and might actually protect more total sales value, it's just optimizing for a different goal than the one I picked. The brief allows either kind of reasoning as long as it's applied consistently, so I picked one and stuck with it everywhere.

### Appendix: alternative allocation strategy comparison

Rather than just asserting urgency-first isn't provably value-optimal, `npm run compare-strategies` actually runs a second strategy (`allocateBudgetByValue.ts`) against it. That one ranks at-risk SKUs by **value protected per rupee spent**: `sales_velocity × unit_cost × shortfall_days ÷ ideal_reorder_cost`, where `shortfall_days` is how long the SKU would sit stocked out before a reorder could land. Since partial units are allowed (same as the primary strategy), sorting by this ratio and filling top-down is the textbook **fractional-knapsack** optimum, provably the best possible allocation for "maximize value protected" given the same budget.

Real output on the real data:

```
=== Allocation Strategy Comparison ===
As of: 2026-08-26T23:00:00.000Z | Budget: Rs. 20,000 | Lead time: 14 days

┌─────────┬───────────┬───────────┬────────────────┬────────────────────┬─────────────────────┬──────────────────────┬───────────────────────┐
│ (index) │ sku       │ days_left │ value_per_rupee │ urgency-first qty  │ urgency-first cost  │ value-optimized qty  │ value-optimized cost  │
├─────────┼───────────┼───────────┼────────────────┼────────────────────┼─────────────────────┼──────────────────────┼───────────────────────┤
│ 0       │ 'SKU-101' │ 8         │ 1              │ 45                 │ 9000                │ 60                   │ 12000                 │
│ 1       │ 'SKU-104' │ 6.67      │ 1              │ 22                 │ 11000               │ 16                   │ 8000                  │
└─────────┴───────────┴───────────┴────────────────┴────────────────────┴─────────────────────┴──────────────────────┴───────────────────────┘
Urgency-first   : spent Rs. 20,000, value protected ≈ Rs. 19,995
Value-optimized : spent Rs. 20,000, value protected ≈ Rs. 19,996.36

=> On this data, value-optimized protects Rs. 1.36 more revenue-at-risk for the same budget.
```

Both strategies spend the full budget, and the numbers are close, but they genuinely disagree on *which* SKU gets the full order: urgency-first fully funds SKU-104 (it's more urgent, 6.67 days vs. 8), while value-optimized fully funds SKU-101 instead (its absolute value at risk, Rs. 12,000 worth, edges out SKU-104's Rs. 10,995 once you round to the same value-per-rupee ratio). That's exactly the trade-off this section already argued in prose, now with real numbers backing it up instead of just a hypothetical. Neither is "more correct": they're optimizing for different things (soonest-to-break vs. most-value-protected), and I stuck with urgency-first as the primary answer because it's the more transparent one for ops to sanity-check.

### Time complexity

Let *E* = number of events, *S* = number of SKUs (4 here, but this holds generally):

- Parsing/validation: **O(E)**, one pass, constant work per record.
- Grouping by SKU: **O(E)**.
- Sorting each SKU's events for replay: **O(E log E)** overall, since summing `n_i log n_i` across SKUs is bounded by sorting the whole thing at once.
- Stock + velocity computation: a couple of linear passes per SKU, **O(E)** total.
- Budget allocation: **O(S log S)** to rank the at-risk SKUs, then a single **O(S)** pass to fund them.

So overall it's **O(E log E) time, O(E) space**, and the per-SKU sort is what dominates.

**Verified empirically, not just asserted.** `npm run benchmark` generates synthetic event logs at increasing scale and times parsing + risk computation + allocation against each. If the pipeline is really O(E log E), `total_time / (E × log₂E)` should stay roughly flat across scales; if it were secretly O(E²), that ratio would climb sharply as E grows. Real run, 500× the event volume from smallest to largest:

```
     1000 events | parse     1.12ms | risk     7.64ms | allocate   0.188ms | total      8.95ms | total/(E*log2 E) = 8.981e-4
    10000 events | parse    10.51ms | risk    99.91ms | allocate   0.117ms | total    110.54ms | total/(E*log2 E) = 8.319e-4
   100000 events | parse    51.45ms | risk  1373.06ms | allocate   0.081ms | total   1424.59ms | total/(E*log2 E) = 8.577e-4
   500000 events | parse   232.26ms | risk  8249.35ms | allocate   0.066ms | total   8481.68ms | total/(E*log2 E) = 8.960e-4
```

The normalized ratio stays within ~8% of itself (8.3e-4 to 9.0e-4) across a 500× range in event count, consistent with O(E log E) and not some hidden superlinear blow-up. (Absolute numbers will vary by machine; the point is the ratio staying flat, not the raw milliseconds. `allocate` looks essentially free here since it only scales with the 4-SKU catalog, not event count, exactly as the S vs. E distinction above predicts.)

<p align="center">
    Made by Sandhit Karmakar</a>
</p>
=======
# Merito-Assignment
>>>>>>> e55f9df59f4dcd005382beadf0dd0f75c47fa766
