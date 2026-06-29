
## Replace "Success Count per Run" with "Best Timeslot to Work"

### Timezone
All hours are browser-local (via `new Date(ts).getHours()`). No extra handling.

### HTML changes (index.html)
Replace the left card in the top chart-row-2:
- Remove: `<canvas id="chart-success-count">` + "Success Count per Run" title
- Add: `<canvas id="chart-best-timeslot">` in same card, title "Best Timeslot to Work"
- Add below canvas: `<div id="timeslot-recommendations">` for the 3 ranked window pills

### Algorithm: `computeHourlyStats()`
1. Scan all runs, extract **local hour** (0-23) from `new Date(timestamp).getHours()`
2. For each hour, collect all successful model results' `responseTime` (across all models)
3. Compute per-hour **avg response time**
4. **Interpolation**: hours with 0 data points → fill with **global mean** of hours that DO have data. Track `realCount[hour]` for confidence.
5. **Smoothing**: 3-hour moving average (1-1-1 kernel)

### Algorithm: `computeBestTimeslots()` — sliding window + combinatorial pick
1. Generate all 24 possible 4-hour zones: start=0..23, hours = [start, start+1, start+2, start+3] mod 24
2. For each zone, compute:
   - `avgTime` = mean of its 4 smoothed hourly values
   - `score` = relative: `round(minAvg / zoneAvg * 100)` (fastest = 100)
   - `confidence` = count of hours with real data (not interpolated) out of 4
3. **Find top 3 non-overlapping zones**: Generate all combinations of 3 zones from the 24 candidates. Filter: reject combos where any two zones share an hour. Pick the combo with the highest **sum of scores**. Gaps between zones are allowed (e.g. 1-5, 7-11, 11-15 is fine even though 7-11 and 11-15 only touch at boundary hour 11 — we treat [start, start+3] as inclusive so 7-11 covers hours 7,8,9,10 and 11-15 covers 11,12,13,14 — no overlap).
4. Sort the 3 winners by score descending → 🥇🥈🥉

### Chart: `renderBestTimeslot()`
- **Type**: Bar chart, 24 bars (hours 0-23, local)
- **X-axis**: "00", "01", ..., "23"
- **Y-axis**: Avg response time (seconds)
- **Bar colors**: gradient green→orange based on speed (fastest=green, slowest=orange)
- **Tooltip**: "Hour HH:00 — Avg X.Xs | N samples"
- Bars in the #1 zone get bright `#76b900` accent border; #2/#3 zones get dimmer border highlights

### Recommendations panel (below chart)
Flex row of 3 pills:

```
🥇 01:00-05:00  95  🟢 high
🥈 07:00-11:00  85  🟡 medium
🥉 11:00-15:00  60  ⚪ low
```

Each pill: rank emoji, time range, score, confidence badge. Reuses `.rel-pill` styling. New gray variant for low confidence.

### JS cleanup in `renderOverview()`
- Remove `successCounts`, `chart-success-count` canvas, `successCount` chart creation
- Add `renderBestTimeslot()` call

### New CSS (minimal)
- `.rel-pill.gray`: gray variant for low confidence
- `.timeslot-recs`: flex row with gap
- `.timeslot-pill`: mono font pill extending `.rel-pill`
