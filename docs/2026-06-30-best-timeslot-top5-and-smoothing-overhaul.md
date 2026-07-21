
## Best Timeslot: top-5 model filter + smoothing overhaul

### Goal
Restrict the "Best Timeslot to Work" chart to runs of the **top 5 models** from the Model Leaderboard, and replace the current two-stage smoothing with a principled three-axis scheme (time → day → hour) plus a zone confidence gate and UI clarity fixes.

### 1. Top-5 model allowlist
- `sortModelsByLiveScore(state.modelNames, state.modelStats, state.runs).slice(0, 5)` resolves the top 5 (same ranking the Leaderboard tab uses — live-status check then composite `score`).
- `renderBestTimeslot()` (charts.js) computes the set and passes it as a new **`models`** param to `computeHourlyStats()`.
- `computeHourlyStats(runs, models)` gains an optional `models` allowlist (Set or array). When provided, the per-run model loop skips any model not in the set. Default (omitted) = all models (no behavior change for any other caller).
- Single filter point. No mutation of `state.runs`.

### 2. Temporal decay — A1: exponential half-life (14d)
Replace the piecewise-linear `weightFor(ts)` with:

```js
const HALFLIFE_DAYS = 14;
const weightFor = (ts) => {
  if (!latestTs) return 1.0;
  const daysAgo = (latestTs - ts) / 86400000;
  return Math.pow(0.5, daysAgo / HALFLIFE_DAYS);
};
```

- No plateau, no hard floor — smooth continuous decay.
- At 14d → 0.5, 28d → 0.25, 42d → 0.125. Old runs fade out gracefully.
- Bounds the "last 30 days" window the subtitle will claim (weights are negligible beyond ~6 half-lives).

### 3. Day-of-week grid — C1: 7×24 with weekend down-weight, then fold
Right now all weekdays collapse into 24 buckets; Tuesday 14:00 == Saturday 14:00. Add genuine "smooth by day":

**3a. Per-(dow,hour) accumulation.**
- Track `dowWeightedSum[7][24]`, `dowWeightTotal[7][24]`, `dowRealCount[7][24]`, `dowFailCount[7][24]`, `dowFailWeight[7][24]`.
- For each run, `dow = new Date(run.timestamp).getDay()` (0=Sun..6=Sat) alongside the existing local hour.

**3b. Apply A1 exponential decay + failure penalty per (dow,hour) cell** — same logic as today but in the 7×24 grid. Interpolate empty cells with the per-dow mean, falling back to the global mean if the whole dow row is empty.

**3c. Spatial smoothing within each weekday row** — 5-tap triangular `[1,2,3,2,1]/9` circular-kernel applied per dow. Sparse cells (`realCount < 3`) get the 7-tap `[1,1,2,3,2,1,1]/11` kernel.

**3d. Fold to 24h with weekend down-weighting.**
- `WEEKEND_WEIGHT = 0.5` (Sat/Sun contribute half).
- For each hour: `smoothed[h] = (sum over dow of dowWeight[dow] * smoothedDow[dow][h]) / (sum of dowWeight[dow])`.
- Produce a single `smoothed[24]` array consumed unchanged by `computeBestTimeslots()`.
- Surface the raw per-dow grid only if needed for debugging; the public return shape of `computeHourlyStats` stays `{ hourAvg, smoothed, isReal, hourRealCount, weightedCounts, hourFailCount }` where each is the folded 24h version.

### 4. Shrinkage on sparse hour averages — E2 (replaces B3)
Before spatial smoothing, regularize each (dow,hour) cell's average toward its local neighborhood to reduce single-sample noise:

```js
// neighborhoodMean = circular mean of the 4 adjacent (dow,hour-1),(dow,hour+1) cells,
// falling back to the per-dow hour mean if neighbors are also empty.
const n = dowRealCount[dow][h];
const k = 1 / Math.sqrt(Math.max(n, 1));          // shrinkage strength
const regularized = (n * rawAvg + (1/k >= 1 ? 0 : (1 - n*k) * neighborhoodMean)) ...
```

Concrete form (clean version to implement):
- `rawAvg[dow][h]` = existing weighted mean for that cell.
- `neighborhoodMean` = circular mean of cells at `(dow, h±1)` (2 neighbors) — or the dow-row hour mean if both neighbors empty.
- `effective_n = n > 0 ? n : 0.5` (treat fully-empty interpolated cells as n=0.5 so they lean hard on neighbors).
- `shrink = 1 / (1 + effective_n)` → cell with many samples: shrink → 0 (trust raw). Cell with 1 sample: shrink → 0.5 (blend 50/50).
- `regularized[dow][h] = (1 - shrink) * rawAvg + shrink * neighborhoodMean`.

This makes B3 redundant — sparse cells are already stabilized before the spatial kernel runs. Drop B3's threshold-based kernel switch; apply the 5-tap kernel uniformly (7-tap only when `realCount === 0`, i.e. pure interpolation border).

### 5. Zone confidence gate — E1
In `computeBestTimeslots()`, before the combinatorial medal search:
```js
const MIN_REAL_HOURS = 2;
const eligible = zones.filter(z => z.realCount >= MIN_REAL_HOURS);
```
Run the 3-zone combo search over `eligible` only. If fewer than 3 eligible zones exist, relax `MIN_REAL_HOURS` to 1, then 0 (current behavior) so the chart still shows *something* rather than "no data" — but prefer real data when it exists. Add a comment explaining the fallback.

### 6. Tooltip clarity — E4
With A1 decay, `weightedCounts[h]` (sum of weights) becomes fractional. Update the tooltip label:
- Keep showing the raw per-hour count (`hourRealCount[h]`) as the primary sample figure.
- Show the weighted effective count separately and labeled: `Avg: X.Xs · N samples (M weighted)`.
- Implementation: return `hourRealCount` in addition to `weightedCounts` from `computeHourlyStats` (already returned), and reformat the label string in `renderBestTimeslot()`'s tooltip callback.

### 7. UI subtitle — E3
In `index.html`, the "Best Timeslot to Work" card title currently:
```html
<div class="card-title"><span class="dot"></span>Best Timeslot to Work</div>
```
Add a subtitle line under it:
```html
<div class="card-title"><span class="dot"></span>Best Timeslot to Work</div>
<div class="card-sub" id="timeslot-sub">Based on top 5 models · last 30 days</div>
```
Reusable `.card-sub` style if it exists; otherwise minimal CSS (small, muted, `margin-top:-4px;margin-bottom:6px`). Keep the label static text — the top-5 / 30d framing is constant; dynamic update is optional and out of scope.

### Files touched
- `js/data.js` — `computeHourlyStats()` core rewrite (allowlist param, 7×24 grid, A1 decay, shrinkage, fold). `computeBestTimeslots()` confidence gate.
- `js/charts.js` — `renderBestTimeslot()` passes top-5 allowlist; tooltip label reformat (E4). Resolve top-5 via imported `sortModelsByLiveScore`.
- `index.html` — card subtitle (E3).
- `css/styles.css` (or inline) — `.card-sub` if not already defined.

### Out of scope / deliberately deferred
- Adaptive zone window size (E5) — stays 4h.
- Distance-penalized midnight wrap in kernel (E6) — circular wrap remains.
- Dynamic subtitle updates / "last 30 days" derivation from data — static text is fine.

### Acceptance
1. Chart aggregates only the top-5 leaderboard models.
2. Old runs fade exponentially (half-life 14d); no plateau/floor discontinuities.
3. Weekday vs weekend signal distinguished before folding; weekends down-weighted 0.5.
4. Sparse (single/zero-sample) hour cells lean on neighbor mean via shrinkage, not a hard kernel switch.
5. No 4h zone with <2 real-data hours wins a medal unless the fallback relaxation kicks in.
6. Tooltip shows raw sample count and weighted effective count, clearly labeled.
7. Card header shows "Based on top 5 models · last 30 days".
8. No other tab/view regresses — `computeHourlyStats()` default (no allowlist) behaves as before for any other consumer.
