# Internal Project Notes — NOT for submission

This file is for you only. It explains *why* every piece of this project is the way it is,
what alternatives were considered and rejected, what the weak points/limitations are (so you
aren't caught off guard if asked), and a full mock-interview Q&A bank (easy/medium/hard) with
answers you can actually give out loud.

Do not include this file in what you submit — only `README.md`, `main.ts`, the test files, and
`package.json` should go out, per the brief's own submission checklist.

---

## Addendum: three extras added beyond the brief, and why

The brief only asks for the boolean risk flag + budget-constrained recommendation. After that was
done, I deliberately added three more things — not because the brief required them, but because a
take-home like this gets submitted by a lot of people who converge on roughly the same shape of
solution (TS, event replay, greedy budget triage, a decent README), and I wanted mine to show
*evidence* of rigor rather than just assert it in prose:

1. **Risk tiers (`critical`/`urgent`/`watch`/`safe`/`unknown`) + `stock_confidence`** — refines
   the plain `at_risk` boolean into something ops can actually triage by, and flags when the
   underlying stock number itself shouldn't be fully trusted (stale/missing snapshot). This lives
   in the *primary* output (`main.ts`), because it's a strict refinement of `at_risk`, not a
   competing interpretation of it.
2. **A second, value-optimized allocation strategy + comparison tool**
   (`allocateBudgetByValue.ts`, `compareStrategies.ts`) — the README already argues greedy
   urgency-first isn't provably value-optimal (see Hard Q8/Q12 below); this turns that argument
   into an actual second algorithm, run against the real data, that genuinely diverges from the
   first in practice. Deliberately kept *separate* from the primary pipeline — urgency-first is
   still "the answer"; this is an appendix proving the trade-off with real numbers instead of
   just narrating it.
3. **An empirical performance benchmark** (`benchmark.ts`) — the README states the pipeline is
   O(E log E); rather than leaving that as an unverified claim, this generates synthetic event
   logs at 1k/10k/100k/500k scale and shows `total_time / (E log₂E)` stays flat across a 500×
   range — the empirical signature of O(E log E) (a hidden O(E²) would make that ratio climb
   sharply instead).

If asked "why go beyond the brief?" — the honest answer is the ambiguous parts of this task are
exactly what the brief says it's grading ("whether the approach you land on is well-reasoned...
consistently implemented"), so I wanted to *demonstrate* that reasoning with runnable evidence,
not just narrate it.

---

## 0. Explain it like I'm 8 years old

Imagine a toy shop that sells the same toys on **three different websites** (Shopify, Amazon,
Flipkart) — but all the toys actually live in **one stockroom** in the back.

Every time something happens to a toy, someone writes it in a **diary** (that's the
`inventory_events.json` file):

- 🧸 "Sold 10 teddy bears today" (a `sale`)
- 📦 "Got 50 new teddy bears delivered" (a `restock`)
- ↩️ "A kid returned 2 teddy bears" (a `return`)
- 👀 "Counted the shelf — there are exactly 80 teddy bears right now" (a `stock_snapshot` — an
  actual headcount, done every now and then, not every day)

**Problem 1:** Some toys are selling fast. If we don't reorder them *soon*, the shelf will go
empty before a new box can even arrive (getting a new box always takes **14 days**, no matter
what). We need to find out which toys are about to run out — that's "at risk of stockout."

**Problem 2:** We only have **Rs. 20,000** to spend this week reordering. That's not enough to
restock *every* toy that's running low. So we have to pick — like a nurse in an emergency room
treating the most urgent patient first, not just whoever showed up first.

**Problem 3:** Sometimes the diary pages are messy — someone forgot to write how many toys, or
wrote a silly date like "banana" instead of a real date. Our program has to just **skip the
messy pages** and keep going, instead of getting confused and crashing.

So the program:

1. Reads the whole diary.
2. Figures out, for each toy (SKU), how many are left right now and how fast it's been selling.
3. Predicts: "at this speed, this toy runs out in X days."
4. If X is less than 14 days → 🚨 flagged as **at risk**.
5. Looks at all the at-risk toys, spends the Rs. 20,000 on the most urgent ones first, until the 
   money runs out.
6. Prints a nice table + writes a JSON file telling the shop manager exactly what to order this
   week, and why.

### Now, how we actually built that (in code, one step at a time)

| Kid version                                                  | What the code actually does                                                                                                                                                                                                                                                                   | Where                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| "Read the diary, throw out messy pages"                      | Parse`inventory_events.json`; for every entry, check it has a real SKU, a real event type, a positive number, and a real date. If anything's wrong, put it in a "skipped" pile with a reason, and move on — never crash.                                                                   | [src/parseEvents.ts](src/parseEvents.ts)                               |
| "Figure out how many teddy bears are on the shelf right now" | For each SKU, sort its diary entries oldest→newest, then walk through them one at a time: a headcount (`stock_snapshot`) sets the exact number; a `sale` subtracts; a `return`/`restock` adds. Whatever number you're left with at the end is "current stock."                       | [src/stockEngine.ts](src/stockEngine.ts) (`reconstructCurrentStock`) |
| "Figure out how fast it's selling"                           | Look at the last 30 days of`sale` entries (minus any `return`s), add them up, divide by 30. That's units sold per day ("velocity").                                                                                                                                                       | [src/stockEngine.ts](src/stockEngine.ts) (`computeVelocity`)         |
| "Predict when it runs out"                                   | `days_left = stock ÷ velocity`. If that's less than 14 (the delivery time), it's **at risk**.                                                                                                                                                                                        | [src/stockEngine.ts](src/stockEngine.ts) (`buildRiskRecord`)         |
| "How many more do we need?"                                  | Enough to have exactly 14 days worth on hand:`(velocity × 14) − stock`.                                                                                                                                                                                                                   | same function                                                         |
| "We can't afford everything — who goes first?"              | Sort at-risk toys by "runs out soonest" first. Give each one its full order, in that order, until the Rs. 20,000 is gone. The one that doesn't fully fit gets a partial order with whatever's left; everyone after gets nothing (but is still marked "at risk" so nobody forgets about them). | [src/allocateBudget.ts](src/allocateBudget.ts)                         |
| "Tell the shop manager"                                      | Print a table to the screen + save a JSON file with every SKU's stock, risk flag, and how much (if anything) to order and why.                                                                                                                                                                | [src/report.ts](src/report.ts), [src/main.ts](src/main.ts)              |

That's the entire program. Everything else in this file below is the deeper "why did you do it
*that* specific way" reasoning, and a Q&A bank in case someone asks you to defend a choice.

---

## 1. What the brief actually asks for, distilled

Two outputs per SKU, driven by an event-sourced log:

1. **A boolean risk flag**: will this SKU run out of stock before a reorder placed *today* would
   arrive (14-day lead time)?
2. **A budget-constrained action**: given only Rs. 20,000 to spend this week across *all* SKUs,
   which at-risk SKUs actually get a PO, and for how much?

The brief is *deliberately* ambiguous about how to define "at risk" and how to prioritize under
a tight budget — it says so explicitly ("There is more than one reasonable way..."). The bar is
not "the right answer", it's: pick a defensible interpretation, state it, and implement it
*consistently*. That's what shaped every decision below.

---

## 2. File-by-file rationale

### `src/types.ts`

Two "layers" of types on purpose:

- **Internal** (`SkuRiskRecord`, `SkuRecommendation`) — camelCase, idiomatic TS, used everywhere
  in the computation pipeline.
- **Output-facing** (`OutputRecord`, `OutputSummary`) — snake_case, deliberately mirrors the
  field names the brief's own worked example uses (`days_of_stock_remaining`,
  `recommend_reorder`, `reorder_quantity`, `reorder_cost`). This is a small thing but signals
  "I read your example carefully and matched your vocabulary" to a reviewer, and makes the JSON
  immediately diffable against the brief's sample.

Why not just use snake_case everywhere? Because idiomatic TypeScript is camelCase; forcing
snake_case through internal logic would read as non-idiomatic to anyone reviewing the code
itself (not just the JSON it produces). Keeping a thin mapping layer (`toOutputRecord` in
`report.ts`) gets both: idiomatic internals, brief-matching external contract.

**Added later:** `RiskTier` and `StockConfidence` are two more deliberately narrow union types
(not open strings) for the same reason `EventType` is — the compiler catches a typo'd tier name
at build time instead of it silently becoming an unrecognized string in the JSON output.

### `src/catalog.ts`

Fixed constants (`REORDER_LEAD_TIME_DAYS`, `WEEKLY_REORDER_BUDGET`, `VELOCITY_WINDOW_DAYS`) and
the SKU catalog live here, not scattered as magic numbers through the codebase. `VELOCITY_WINDOW_DAYS`
is the one constant *I* introduced (not given by the brief) — isolating it here makes it obvious
it's a tunable assumption, not a brief-given fact, and makes it trivial to change in one place if
an interviewer pushes back on "why 30 days?".

**Added later:** `URGENT_TIER_FRACTION` (0.5 — under half the lead time is "urgent" rather than
just "watch") and `STALE_SNAPSHOT_DAYS_THRESHOLD` (10 days — a physical recount older than this
is "low confidence") are two more of *my* assumptions, isolated the same way as
`VELOCITY_WINDOW_DAYS` for the same reason: easy to point to, easy to justify individually, easy
to change if pushed on. Neither is derived from anything in the brief; both are just reasonable-
feeling fractions of numbers the brief *does* give us (the 14-day lead time).

### `src/parseEvents.ts`

This is the "gracefully skip malformed events" requirement, in full. Two distinct failure modes,
handled differently, deliberately:

- **A single record is malformed** (missing field, bad type, bad timestamp, unknown SKU) →
  skipped, logged with a reason, loop continues. Never throws.
- **The whole file isn't valid JSON, or isn't a top-level array** → throws immediately. There's
  no reasonable way to "skip" a file that isn't parseable JSON at all; that's a different class
  of failure (a corrupt/wrong file, not "one bad row in an otherwise-fine log") and should fail
  loudly rather than silently produce an empty/wrong result.

I also chose to reject events referencing a SKU **not in the fixed catalog**. The catalog is
explicitly "fixed, given" in the brief — I decided any event referencing an unknown SKU is
either test/noise data or a data-quality problem upstream, and since we have no unit cost /
channel info for it anyway, we can't make a reorder decision for it. Skipping it (rather than,
say, crashing, or silently inventing a $0 unit cost) is the same "gracefully skip" philosophy
applied one level up.

`parseEvents(records: unknown[])` is exported separately from `loadEvents(filePath)` specifically
so unit tests can feed in raw arrays without touching the filesystem — cleaner and faster tests.

### `src/stockEngine.ts`

The core algorithm. Three logical steps, each a separate small function so each is independently
testable and readable:

1. `determineAsOf` — the "now" for the whole run. See "Why deterministic asOf" below.
2. `reconstructCurrentStock` — replay-based stock reconstruction with snapshot reconciliation.
3. `computeVelocity` — trailing-window sales rate with a sparse-data fallback.

**Why replay-based stock reconstruction instead of "just use the latest stock_snapshot"?**
Because snapshots "arrive periodically, not on a fixed schedule" — the most recent snapshot could
be stale by the time "now" rolls around, with sales/restocks/returns having happened since. Using
*only* the latest snapshot would ignore all activity after it. Using *only* deltas (no snapshots)
would let drift accumulate forever if any event is ever missing from the log. Combining both —
reset on snapshot, then apply subsequent deltas — gets the best of both and is exactly how a
real point-of-sale/inventory system reconciles "counted" vs. "computed" stock.

**Why a 30-day trailing window for velocity, not 7 or 90 or "all-time"?** This is a genuine
judgment call and the one I'd defend most carefully if pushed:

- Too short (7 days) → one unusually good/bad week skews the whole recommendation, and it's
  sensitive to day-of-week effects if a SKU sells in weekly cycles.
- Too long (all-time) → a SKU whose sales trend has changed (ramping up, seasonal, discontinued)
  gets a velocity estimate dragged down/up by ancient, no-longer-relevant history. It also means
  velocity keeps changing indefinitely as more history accumulates, decreasingly reflecting
  "now".
- 30 days sits in the middle: long enough to smooth weekly noise, short enough to track a
  genuinely recent trend. It's also a natural "monthly" cadence a PM/ops person intuitively
  understands.
- The **fallback to entire history when a SKU has <30 days of data** prevents a brand-new SKU
  (or one with a data gap) from getting a velocity of 0 or a wildly extrapolated number just
  because the fixed window is mostly empty.

**Why does `return` reduce net velocity instead of being ignored?** A returned unit represents
demand that didn't actually stick — counting it as "sold" for velocity purposes would overstate
how fast the SKU is *genuinely* depleting, and over-trigger reorders.

**Why clamp negative stock to 0?** Physically, you can't have negative units on a shelf. A
negative computed value means the data undercounted restocks/snapshots somewhere upstream of
what we can see — treating it as "0, i.e., already stocked out" is the conservative, safe
interpretation (it still flags risk; it just doesn't report a nonsensical negative number to
ops).

**Why is "channel" ignored for stock partitioning?** Re-read the brief: the SKU catalog gives one
"primary channel" per SKU, and a stock_snapshot is a single stock LEVEL, not "stock on Shopify"
vs "stock on Amazon" separately. That strongly implies one shared inventory pool sold through
multiple storefronts (a very common D2C setup — one warehouse, multiple sales channels). If the
real data model turned out to have genuinely separate per-channel inventory, this assumption
would need revisiting (see the "hard" interview questions below).

**Added later — `computeRiskTier` / `computeStockConfidence`:** both are pure functions bolted
on right after the existing `atRisk`/`idealReorderQuantity` computation, deliberately *not*
intertwined with it — tiers are a read of the same `daysOfStockRemaining` number the boolean
already uses (never a second, independent judgment that could disagree with `atRisk`), and
confidence is a completely separate axis (data trustworthiness, not urgency) computed off
`lastSnapshotAt` alone. Kept `reconstructCurrentStock` returning `{ stock, lastSnapshotAt }`
instead of adding a second full pass over the events just to find the last snapshot — one replay
does double duty.

### `src/allocateBudget.ts`

The budget-triage logic, and the **primary/chosen strategy** — this is what `main.ts` actually
uses. Implemented as a **greedy, urgency-ranked, partial-fill** algorithm — see README.md's
"Assumptions & Design Decisions" for the user-facing rationale. A few implementation details
worth knowing cold:

- SKUs are split into "at-risk-and-needs-units" vs "everything else" up front, so the sort only
  ever touches the SKUs that actually compete for budget — cheap and clear.
- The tie-break chain (days → velocity → cost) is *not* specified by the brief; I picked it to
  favor genuinely faster-moving/business-critical products when two SKUs are equally urgent, then
  cheaper fixes as a final tiebreak (spends budget more efficiently at the margin). This is
  exactly the kind of ambiguous-but-must-be-consistent decision the brief is testing for.
- `toRecommendation` always stamps a human-readable `funding_note` — every SKU's outcome (funded,
  partially funded, not funded due to budget, not at risk) is explained in plain English. This
  was a deliberate "make it useful for an ops team to act on" choice — a bare boolean flag with no
  explanation forces ops to reverse-engineer *why* something wasn't funded.

### `src/allocateBudgetByValue.ts` (added later — comparison only, not the primary strategy)

Same shape as `allocateBudget.ts` (same split-then-rank-then-greedy-fill-then-partial-fill
structure — deliberately, so the two are easy to diff against each other), but ranks by
**value-at-risk per rupee of ideal cost** instead of urgency:
`salesVelocity × unitCost × shortfallDays ÷ idealReorderCost`, where `shortfallDays =
leadTime − daysOfStockRemaining` (how long the SKU would sit stocked out if left unfunded).

Why this ranking is more than "a different heuristic": because partial units are allowed (same
as the primary strategy), this is the classic **fractional knapsack** setting, and for fractional
knapsack, sorting by value/cost ratio and greedily filling top-down is *provably* the optimal
allocation for "maximize total value protected" — not just a reasonable-sounding alternative.
That's a materially stronger claim than the primary strategy gets to make about itself (urgency-
first is transparent and defensible, but never claimed to be provably optimal for anything).

`unit_cost` stands in for "business value per unit" here since the brief gives no separate
price/margin/revenue figure — worth flagging proactively if asked, since unit cost and revenue
importance aren't always the same thing in a real catalog (a cheap-to-source item can still be a
high-margin bestseller).

### `src/compareStrategies.ts` (added later — standalone script, not wired into `main.ts`)

Runs both `allocateBudget` and `allocateBudgetByValue` against the same risk records and prints a
side-by-side table plus each strategy's total spend and total "value protected" (value-at-risk ×
fraction of ideal quantity actually funded, summed across SKUs). On the real data the two
strategies disagree about which SKU gets the *full* order (urgency-first fully funds the more-
urgent SKU-104; value-optimized fully funds SKU-101 instead, since its absolute value at risk is
slightly higher) — a genuine, reproducible divergence, not a contrived one. See README.md's
"Appendix: alternative allocation strategy comparison" for the real captured output.

Deliberately a separate script/output file (`output/strategy_comparison.json`), not a flag on
`main.ts` — didn't want to complicate the primary pipeline's single, clearly-stated answer with a
strategy-selection option the brief never asked for.

### `src/benchmark.ts` (added later — standalone script, not part of the test suite)

Generates synthetic event logs at 1k/10k/100k/500k events using a seeded PRNG (`mulberry32` —
deterministic, so benchmark runs are reproducible rather than noisy from run to run), then times
`parseEvents` → `computeAllRiskRecords` → `allocateBudget` at each scale and prints
`total_time / (E × log₂E)`. Chose to reuse the *real* pipeline functions rather than writing a
separate micro-benchmark harness, specifically so the timings reflect the actual code path a
grader would run, not a synthetic stand-in for it. Synthetic records include the same ~0.5% rate
of malformed rows (missing timestamp / bad quantity / bad timestamp) as the real data, so
`parseEvents`'s validation branches are genuinely exercised at scale too, not skipped.

### `src/report.ts` / `src/main.ts`

Thin orchestration/formatting layer. `main.ts` takes the input/output paths as optional CLI args
(defaulting to the bundled sample data) specifically so a grader can drop in the *real*
`inventory_events.json` and run the exact same command without editing any code.

### `data/inventory_events.json`

**Updated:** this used to be a hand-authored placeholder (no real file came with the brief
initially). It has since been replaced with the *actual* `inventory_events.json` event log shared
with the brief (53 events, all 4 catalog SKUs). No engine code changes were needed to handle it —
`reconstructCurrentStock`/`computeVelocity`/`allocateBudget` all worked unchanged against the real
data, and the existing test suite (including the brief's-own-worked-example assertion for
SKU-101) still passes exactly. That's a good sign the validation/engine logic generalizes rather
than being overfit to the hand-authored numbers.

**What the real data actually produces (as of the last event's timestamp, 2026-08-26T23:00Z):**

| SKU     | Stock | Velocity | Days left | Ideal cost | Outcome under Rs. 20,000 budget                 |
| ------- | ----- | -------- | --------- | ---------- | ------------------------------------------------ |
| SKU-101 | 80    | 10/day   | 8         | Rs. 12,000 | Partially funded: 45/60 units (budget ran out)   |
| SKU-104 | 20    | 3/day    | 6.67      | Rs. 11,000 | Fully funded first (most urgent, funded first)   |
| SKU-102 | 500   | 2/day    | 250       | —         | Not at risk                                       |
| SKU-103 | 192   | 8/day    | 24        | —         | Not at risk                                       |

SKU-101 still lines up exactly with the brief's own worked example (80 units, ~10/day, 8 days,
`reorder_quantity: 60`, `reorder_cost: 12000` as the *ideal*, uncapped figure) — that was a
genuine coincidence in the real data, not something re-engineered to match.

Total ideal cost of the two at-risk SKUs (SKU-101 + SKU-104) is Rs. 23,000 > the Rs. 20,000
budget, so the real data happens to exercise the "budget doesn't cover everyone" triage path
end-to-end on its own, without needing to hand-craft that scenario.

**The real data contains 3 distinct malformed events:** an event missing the `timestamp` field
entirely (index 0), a `sale` with a non-numeric `quantity` (`"N/A"`, index 36), and an unparsable
`timestamp` (`"not-a-date"`, index 52). That covers all three example categories the brief calls
out ("missing fields, bad timestamp formats") plus a non-numeric quantity, which is enough to
satisfy the required "at least one malformed event, skipped without crashing" test, and together
they exercise the validator across a few distinct failure categories rather than just one.

### Tests (`src/tests/*.test.ts`)

22 tests total, split into four files by concern:

- `stockEngine.test.ts` — the two **required** unambiguous cases (clearly fine / clearly at
  risk) plus edge cases (snapshot reconciliation, returns, no-sales-ever, zero-events), plus
  (added later) one test per risk tier and one test per `stock_confidence` outcome — all using
  small, isolated, hand-computed fixtures (not the shared sample dataset) so each test's expected
  numbers are self-evidently correct just by reading the test.
- `allocateBudget.test.ts` — budget-ranking behavior in isolation, using synthetic risk records
  (doesn't care where they came from), so the triage logic is tested independently of the stock
  math.
- `allocateBudgetByValue.test.ts` (added later) — same idea, for the value-optimized strategy;
  includes one test specifically constructed so the *most urgent* SKU is **not** the one that
  wins the value-per-rupee ranking, proving the two strategies are actually driven by different
  logic and not just the same ranking relabeled.
- `pipeline.test.ts` — the **required** malformed-event test (run against the real data file,
  proving the full file-loading path works, not just the in-memory validator function) plus
  end-to-end sanity checks against the real dataset.

`benchmark.ts` and `compareStrategies.ts` deliberately have **no** `node:test` coverage — they're
diagnostic/reporting scripts whose "correctness" is that they call already-tested functions
(`parseEvents`, `computeAllRiskRecords`, `allocateBudget`, `allocateBudgetByValue`) and print the
results; adding tests that just re-assert console.log output would be testing string formatting,
not logic.

Deliberately used Node's **built-in** `node:test` runner instead of Jest/Vitest/Mocha: zero extra
dependencies, ships with Node 18+, and "easy to set up" was an explicit grading criterion. On a
machine where `npm install` might be flaky/restricted (corporate proxies, offline grading boxes),
fewer dependencies is strictly safer.

---

## 3. Stack-level decisions

**Why TypeScript over Python/JavaScript?** The brief lists it as "most preferred." TypeScript
also lets the domain model (event types, risk records, recommendations) be expressed as compiler-
checked interfaces, which catches a whole class of "field name typo" bugs at compile time rather
than at runtime — valuable in a script that's meant to be trustworthy for a business decision
(spending Rs. 20,000).

**Why zero runtime dependencies?** Two reasons: (1) "Easy to set up" was explicitly called out
as a grading criterion, and every dependency is one more thing that can fail to install on the
grader's machine (proxies, registries, version conflicts). (2) The problem genuinely doesn't need
anything beyond `fs`/`path`/`Date` — pulling in a date library or a CLI-argument-parsing library
for a script this size would be over-engineering.

**Why CommonJS instead of ESM?** Simpler interop with `node --test`/`ts-node`-less compilation on
Windows without needing `"type": "module"` + `.js` extension juggling in relative imports. Purely
a "least friction to run" choice, not a strong technical opinion.

**Why compile with `tsc` + plain `node`, instead of `ts-node`/`tsx`?** Same "fewer dependencies,
fewer things that can break" logic — `tsc` is the one thing you already need to have TypeScript
at all. `npm start` and `npm test` both run the build step automatically first, so there's no
extra manual step for the grader.

---

## 4. Known limitations / things I'd flag proactively if asked

- **No incoming-PO awareness.** The tool has no way to know if a reorder for a SKU is already in
  transit (see the README's PM question) — it could recommend/fund a SKU that's already being
  replenished.
- **Single flat lead time for every SKU/supplier.** Real supply chains have per-supplier (and
  often uncertain/variable) lead times; this assumes one constant 14 days for everything.
  See the "hard" Q&A below for how I'd extend this.
- **Greedy budget allocation (the primary strategy) is a heuristic, not provably value-optimal.**
  It optimizes for "soonest stockout first", not "maximum total risk-days averted per rupee
  spent." That's a deliberate, stated trade-off (see README) — and it's no longer just a
  hypothetical I have an answer ready for (see Hard Q12): `allocateBudgetByValue.ts` +
  `compareStrategies.ts` actually implement and run the value-optimal alternative against the
  real data, so I can show, not just argue, exactly where and by how much the two diverge.
- **No de-duplication of identical events.** If the real event log delivers the same event
  twice (e.g. at-least-once delivery from a message queue), it would be double-counted. The
  brief's "malformed" examples don't mention duplicates, so I didn't build for it, but I'd flag
  it as a real-world gap (see Hard Q16).
- **Whole-file JSON parse, not streaming.** Fine for anything that fits in memory (this problem's
  scale certainly does); would need a streaming JSON parser for a genuinely huge log file.

---

## 5. Mock interview: if I were the interviewer

### Easy

**Q1. What does "at risk of stockout" mean in your implementation, and why that threshold?**

> A SKU is at risk if `current_stock / sales_velocity_per_day` (days of stock left) is strictly
> less than the 14-day reorder lead time — i.e., at the current sell rate, it would run out
> before a reorder placed *today* could physically arrive. I used strict `<` (not `<=`) because
> exactly 14 days of stock means it runs out the same day the reorder would land — a boundary
> case I chose to treat as "just barely fine" for simplicity; either interpretation is
> defensible, I just picked one and applied it consistently.

**Q2. Why do you clamp current_stock at 0 instead of allowing negative values?**

> Physical stock can't be negative. A negative computed value would only ever arise from missing
> upstream data (e.g., a restock event we never saw), and treating it as "0, already stocked out"
> is the conservative choice — it still flags risk correctly without showing ops a
> confusing negative number.

**Q3. Walk me through what happens if an event has an invalid timestamp.**

> `parseEvents` runs `validateRecord` on every raw record. It checks `timestamp` is a string and
> that `Date.parse(timestamp)` doesn't come back `NaN`. If it fails, the record is pushed into a
> `skipped` array with a human-readable reason and the loop moves on — no exception is thrown, so
> one bad event never crashes the run. That skipped list is also surfaced in the final report so
> ops/engineering can see exactly what was dropped and why.

**Q4. Why is the SKU catalog hardcoded rather than derived from the event log?**

> The brief explicitly says the catalog is "fixed, given" — it's the source of truth for unit
> cost and primary channel, neither of which appears on every event. Deriving it from the log
> would mean guessing costs for SKUs we've never seen a cost for, which isn't safe for a tool
> that recommends spending real money.

**Q5. What's the difference in how you process a `sale` event vs. a `stock_snapshot` event?**

> `sale.quantity` is a *delta* — it's subtracted from the running stock total. `stock_snapshot.quantity`
> is an *absolute level* — it replaces the running total outright, discarding whatever was
> computed before it. That's why `stock_snapshot` needs its own branch instead of just another
> add/subtract.

### Medium

**Q6. Why a 30-day trailing window for velocity — why not 7 or 90 or all-time?**

> (See "Known limitations" section above — I'd give the same reasoning: 7 days is noisy/day-of-
> week sensitive, all-time drags in stale trend data and never stabilizes, 30 days balances
> smoothing against recency. I'd also point out it's the one number in the whole design that's
> *my* assumption rather than a brief-given fact, isolated as a named constant for exactly that
> reason, and I'd happily discuss changing it if given more context on how ops actually thinks
> about "recent.")

**Q7. Two SKUs have identical days_of_stock_remaining during budget allocation — how do you break the tie?**

> First by higher sales velocity (treat the faster-moving product as more business-critical),
> then by lower unit cost (cheaper to fully resolve, leaving more budget for others). Neither
> tiebreak is specified by the brief; I picked a defensible, stated order and applied it
> uniformly rather than leaving it to array/insertion order (which would be non-deterministic in
> spirit even if technically deterministic in JS).

**Q8. Your algorithm is greedy urgency-first. Is that optimal for total value/revenue protected? Give a case where it isn't.**

> No — it's not optimized for value at all, by design. Example: SKU A has 1 day left, ideal cost
> Rs. 19,999, unit_cost so high it only buys 1 unit of safety; SKU B has 13 days left (still at
> risk) but only costs Rs. 500 to fully resolve and is a much higher-velocity, higher-revenue
> product. Urgency-first spends almost the entire budget on A (barely denting its risk) and
> leaves B unfunded, even though B could've been fully resolved for a tiny fraction of the
> budget. A value-per-rupee or 0/1-knapsack-style allocation (maximize total "risk avoided" or
> "revenue protected" per rupee spent) would catch this. I chose urgency-first anyway because
> it's transparent and easy for ops to sanity-check ("we fixed what breaks soonest"), and the
> brief doesn't specify an objective function to optimize — but I'd happily implement a
> knapsack-style variant if "maximize value protected" were the stated goal.
>
> (I actually did implement it — `allocateBudgetByValue.ts`, run side-by-side via
> `npm run compare-strategies`. On the real data the two strategies both spend the full Rs.
> 20,000 but disagree on which SKU gets the *full* order, and value-optimized protects slightly
> more total value. Small divergence on this particular dataset, but the mechanism is real and
> the comparison is reproducible, not hypothetical.)

**Q9. How do you handle a stock_snapshot that arrives out of order relative to a sale that already updated stock?**

> Events are sorted by timestamp *before* replay, per SKU, regardless of their order in the raw
> file — so "out of order in the file" is already handled. What I *don't* handle is a snapshot
> whose timestamp is correct but which logically contradicts events immediately around it (e.g.
> a snapshot recorded appreciably later than a sale, but the sale hadn't actually been rung up
> yet in the source system) — that's a data-quality problem no amount of client-side sorting can
> fix; I'd flag it for the upstream system, not silently paper over it.

**Q10. Time and space complexity of the full pipeline — where's the bottleneck?**

> O(E log E) time, O(E) space, where E is event count — dominated by sorting each SKU's events
> for chronological replay (bounded by sorting all events once). Everything else — parsing,
> stock replay, velocity computation, budget ranking (O(S log S) for S SKUs) — is linear or
> smaller. For this problem's scale (a handful of SKUs, a modest event log) this is effectively
> instant; the sort would only start to matter at genuinely large event volumes.
>
> (I also verified this empirically instead of just asserting it — `benchmark.ts` /
> `npm run benchmark` times the real pipeline at 1k/10k/100k/500k synthetic events and prints
> `total_time / (E log₂E)`. That ratio stays within about 8% of itself across a 500× range in
> event count, which is the signature you'd expect from true O(E log E) scaling — a hidden O(E²)
> would make it climb sharply instead of staying flat.)

**Q11. Why "top up to exactly cover the lead time" instead of adding a safety-stock buffer?**

> Because that's the formula implied by the brief's own worked example (10/day × 14 days − 80 on
> hand = 60 units, matching their sample output exactly) — I anchored to that rather than
> inventing an arbitrary safety multiplier the brief gives no basis for. In a real system I'd
> want a safety-stock buffer sized off lead-time *variance*, not just its mean (see Hard Q14) —
> but that requires data (lead-time reliability/variability) the brief doesn't provide.

### Hard

**Q12. Prove or disprove: can your greedy urgency-first allocation ever be strictly worse than an optimal knapsack (by "total risk-days averted") solution? Construct an example.**

> It can, provably — see the concrete construction in Q8's answer (one very-urgent, very-
> expensive-to-fully-fix SKU crowds out a moderately-urgent, cheap-to-fully-fix SKU). Greedy-by-
> urgency ignores cost-effectiveness entirely, so any scenario where the most urgent item is also
> disproportionately expensive to resolve will produce a worse "total risk resolved per rupee"
> outcome than an optimal (or even a simple value/cost-ratio greedy) allocation would. I'd frame
> the fix as: define an objective (e.g. Σ (days_of_stock_remaining shortfall resolved) or Σ
> (velocity × unit_cost) protected), then either run a value-density greedy (sort by
> objective-value ÷ cost, a good approximation for a 0/1 knapsack) or, for a small SKU count, an
> exact DP knapsack over `budget` in Rs. increments.

**Q13. How would you extend this to run incrementally as new events stream in, without recomputing full per-SKU history from scratch every time?**

> Keep a small per-SKU running state instead of the raw event list: `{ lastSnapshotStock, lastSnapshotTimestamp, deltasSinceSnapshot: [...] }` plus a rolling structure for the velocity
> window (e.g. a deque of `{timestamp, netUnits}` bucketed by day, so old days can be evicted in
> O(1) as the 30-day window slides forward — a classic sliding-window technique). On each new
> event: O(1) to update the running stock (apply delta, or hard-reset + clear old deltas on a new
> snapshot); O(log window_size) or amortized O(1) to update the rolling velocity sum depending on
> the eviction strategy. Recomputing the at-risk flag and ideal reorder qty is O(1) per event.
> This turns the whole pipeline from O(E log E) *per run* into O(1) amortized *per new event*,
> which is what you'd want for a real streaming ops dashboard.

**Q14. Your model assumes one fixed 14-day lead time for everyone. Real lead times vary and are uncertain. How would you extend the at-risk model?**

> I'd move from a point estimate to a distribution: per-supplier/SKU historical lead time mean
> and variance (or a full empirical distribution, if enough PO history exists). Then apply a
> classic inventory-theory approach — compute a **reorder point** as
> `demand_rate × mean_lead_time + safety_stock`, where safety stock is sized to hit a target
> service level (e.g. `z × sqrt(mean_lead_time × demand_variance + demand_rate² × lead_time_variance)`
> for a desired z-score/service level, the standard formula from inventory management). "At risk"
> then becomes "current stock is below the reorder point," rather than a simple deterministic
> days-remaining-vs-14 comparison. This is strictly better but needs data the brief doesn't give
> us (lead time variability per supplier) — which is itself a great follow-up question for
> ops/procurement.

**Q15. How would this scale to 500,000 SKUs and tens of millions of events/day? What breaks first, and how would you re-architect?**

> First to break: loading the whole event log into memory and re-sorting it every run — both the
> O(E log E) compute and the O(E) memory become untenable at that scale, and a single Node
> process reading one JSON file stops being viable entirely. I'd re-architect as: (1) an
> event-sourced pipeline with a real message queue (Kafka/Kinesis) instead of a flat JSON file;
> (2) per-SKU state kept in a fast key-value/document store (Redis/DynamoDB) using the
> incremental-update model from Q13, so each event is O(1) to apply, not O(E) to replay; (3)
> velocity/risk computation as a streaming job (Flink/Kafka Streams) partitioned by SKU (SKUs are
> embarrassingly parallel — no cross-SKU dependency in the risk calc); (4) the budget-allocation
> step (which genuinely needs a global view across all at-risk SKUs) as a separate periodic batch
> job over a much smaller "currently at-risk" working set, rather than re-deriving risk for every
> SKU from scratch; (5) an approximate/streaming top-K or bucketed-priority-queue approach for
> ranking at-risk SKUs by urgency instead of a full sort, if even the at-risk set gets huge.

**Q16. The log can have duplicate events (at-least-once delivery). How would you make stock reconstruction idempotent?**

> Require (or synthesize) a unique event ID, and de-duplicate by ID before replay (a `Set` of
> seen IDs, O(1) lookup, dropped if already applied) — this is the standard idempotency-key
> pattern for exactly this class of problem. If the upstream system genuinely can't provide a
> unique ID, a weaker fallback is content-based de-duplication (hash of `sku+type+quantity+timestamp`)
> within a short time bucket, accepting that it can't distinguish a true duplicate from two
> genuinely identical concurrent sales — which is a real limitation, not a full fix, and I'd say
> so rather than pretend content-hashing fully solves it.

---

## 6. If asked "what would you do differently with more time?"

- Add a safety-stock buffer / service-level-based reorder point instead of "exactly cover lead
  time" (see Hard Q14).
- ~~Add a value-density (cost-efficiency) allocation mode alongside urgency-first~~ — done
  (`allocateBudgetByValue.ts` + `compareStrategies.ts`). Next step up from here would be surfacing
  *both* strategies' numbers directly in the primary `output/recommendations.json` (as a side-by-
  side field per SKU) rather than a separate comparison file, so an ops consumer doesn't have to
  run a second command to see the trade-off.
- Property-based tests (e.g. `fast-check`) for `allocateBudget`/`allocateBudgetByValue` — generate
  random risk records and assert the budget-never-exceeded invariant holds for *all* inputs, not
  just the hand-picked cases in the current test suite.
- Idempotent replay (Hard Q16) if the real data source turned out to be a message queue.
- Wire `risk_tier`/`stock_confidence` thresholds (`URGENT_TIER_FRACTION`,
  `STALE_SNAPSHOT_DAYS_THRESHOLD`) into the benchmark/comparison scripts as CLI overrides, so an
  interviewer could poke at "what if urgent meant 30% of lead time instead of 50%" live without
  editing code.
