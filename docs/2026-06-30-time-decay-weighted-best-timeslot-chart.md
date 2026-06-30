## Enhance "Best Timeslot" chart with time-decay weighting

### Problem
`computeHourlyStats()` treats all runs with equal weight regardless of age. A run from 30 days ago counts the same as one from today, which skews the chart when performance patterns shift.

### Changes (all in `index.html`)

#### 1. Add time-decay weighting to `computeHourlyStats()`
- Find `latestTs` = timestamp of most recent run
- For each run, compute age in days: `daysAgo = (latestTs - run.timestamp) / 86400000`
- Apply weight:
  - 0-7 days: **weight = 1.0** (full)
  - 7-30 days: **weight = 1.0 - 0.7 * (daysAgo - 7) / 23** (linear decay 1.0 → 0.3)
  - 30+ days: **weight = 0.3** (floor)
- Accumulate `hourWeightedSum[h] += value * weight` and `hourWeightTotal[h] += weight`
- Compute `hourAvg[h] = hourWeightedSum / hourWeightTotal` (instead of simple `avg()`)
- Apply same decay weighting to failure count contributions (penalty values are also multiplied by weight)

#### 2. Improve smoothing kernel
- Replace current 3-hour `(1,1,1)/3` with **5-hour weighted `(1,2,3,2,1)/9`**
- For hours with `hourRealCount[h] < 3` (sparse data), use a **7-hour kernel `(1,1,2,3,2,1,1)/11`** for extra stability

#### 3. Update tooltip to show Recency
- Tooltip label: `Avg: X.Xs (N recent samples)` where N reflects weighted sample count for transparency

### No changes needed
- DB schema / SQL queries (timestamps already available)
- `computeBestTimeslots()` (it consumes smoothed data, works as-is)
- Chart rendering (colors, zones, pills all remain the same)
- CSS