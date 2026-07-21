import { avg, categorizeError } from './helpers.js';

export function loadFromDb(db) {
  const runsQ = db.exec(
    'SELECT id, timestamp, prompt, success_count, total_models, fastest_model, fastest_time FROM runs ORDER BY timestamp DESC'
  );
  if (!runsQ.length || !runsQ[0].values.length) return { runs: [] };

  const runs = runsQ[0].values.map(([id, timestamp, prompt, sc, tm, fm, ft]) => ({
    _dbId: id,
    timestamp,
    prompt,
    models: [],
    summary: { successCount: sc, totalModels: tm, fastestModel: fm, fastestTime: ft }
  }));

  const runById = new Map(runs.map((r, i) => [r._dbId, i]));

  const resQ = db.exec(
    'SELECT run_id, model, success, error, response_time, tokens_generated, total_tokens FROM model_results ORDER BY run_id ASC'
  );
  if (resQ.length && resQ[0].values.length) {
    for (const [run_id, model, success, error, rt, tg, tt] of resQ[0].values) {
      const idx = runById.get(run_id);
      if (idx !== undefined) {
        runs[idx].models.push({
          model,
          success: success === 1,
          error: error || null,
          responseTime: rt,
          tokensGenerated: tg,
          totalTokens: tt,
          response: null
        });
      }
    }
  }
  return { runs };
}

export function processData(data) {
  const runs = [...data.runs].reverse();
  const modelNames = [...new Set(runs.flatMap(r => r.models.map(m => m.model)))];
  const modelStats = {};

  for (const model of modelNames) {
    const results = runs.map(run => run.models.find(m => m.model === model) || null);
    const successes = results.filter(r => r && r.success);
    const testedResults = results.filter(r => r !== null);
    const times = successes.map(r => r.responseTime).filter(t => t > 0);
    const tpsArr = successes
      .filter(r => r.responseTime > 0)
      .map(r => r.tokensGenerated / (r.responseTime / 1000));

    modelStats[model] = {
      results,
      totalRuns: testedResults.length,
      successCount: successes.length,
      uptime: testedResults.length ? successes.length / testedResults.length : 0,
      responseTimes: results.map(r => (r && r.success && r.responseTime > 0) ? r.responseTime : null),
      throughputs: results.map(r => (r && r.success && r.responseTime > 0)
        ? r.tokensGenerated / (r.responseTime / 1000) : null),
      avgTime: times.length ? avg(times) : null,
      bestTime: times.length ? Math.min(...times) : null,
      avgTps: tpsArr.length ? avg(tpsArr) : null,
      wins: 0,
      errors: {},
      lastSeen: null,
    };

    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i] && results[i].success) {
        modelStats[model].lastSeen = runs[i]?.timestamp || null;
        break;
      }
    }

    results.filter(r => r && !r.success && r.error).forEach(r => {
      const t = categorizeError(r.error);
      modelStats[model].errors[t] = (modelStats[model].errors[t] || 0) + 1;
    });
  }

  runs.forEach(run => {
    const fm = run.summary?.fastestModel;
    if (fm && modelStats[fm]) modelStats[fm].wins++;
  });

  const validTimes = modelNames.filter(m => modelStats[m].avgTime != null).map(m => modelStats[m].avgTime);
  const validTps = modelNames.filter(m => modelStats[m].avgTps != null).map(m => modelStats[m].avgTps);
  const maxTime = validTimes.length ? Math.max(...validTimes) : 1;
  const minTime = validTimes.length ? Math.min(...validTimes) : 0;
  const maxTps = validTps.length ? Math.max(...validTps) : 1;
  const minTps = validTps.length ? Math.min(...validTps) : 0;

  for (const model of modelNames) {
    const s = modelStats[model];
    const speedScore = s.avgTime != null
      ? (1 - (s.avgTime - minTime) / Math.max(maxTime - minTime, 1)) * 100 : 0;
    const tpsScore = s.avgTps != null
      ? ((s.avgTps - minTps) / Math.max(maxTps - minTps, 1)) * 100 : 0;
    s.score = Math.round(s.uptime * 40 + speedScore * 0.3 + tpsScore * 0.3);

    const half = Math.floor(s.responseTimes.length / 2);
    const firstHalf = s.responseTimes.slice(0, half).filter(v => v != null);
    const secondHalf = s.responseTimes.slice(half).filter(v => v != null);
    if (firstHalf.length && secondHalf.length) {
      const diff = avg(secondHalf) - avg(firstHalf);
      s.trend = diff < -500 ? 'up' : diff > 500 ? 'down' : 'flat';
    } else {
      s.trend = 'flat';
    }
  }

  return { runs, modelNames, modelStats };
}

export function computeHourlyStats(runs, models) {
  // Optional allowlist (top-5 filter). Normalize to a Set; omitted/empty = all models.
  const allowSet = models && (Array.isArray(models) ? models.length : models.size) > 0
    ? new Set(Array.isArray(models) ? models : [...models])
    : null;

  // --- 7x24 grid: dow (0=Sun..6=Sat) x localHour ---
  const dowWeightedSum = Array.from({ length: 7 }, () => Array(24).fill(0));
  const dowWeightTotal = Array.from({ length: 7 }, () => Array(24).fill(0));
  const dowRealCount = Array.from({ length: 7 }, () => Array(24).fill(0));
  const dowFailCount = Array.from({ length: 7 }, () => Array(24).fill(0));
  const dowFailWeight = Array.from({ length: 7 }, () => Array(24).fill(0));

  let latestTs = 0;
  for (const run of runs) {
    const t = Date.parse(run.timestamp);
    if (!Number.isNaN(t) && t > latestTs) latestTs = t;
  }

  const weightFor = (ts) => {
    if (!latestTs) return 1.0;                 // no parseable timestamps -> uniform weight
    const t = Date.parse(ts);
    if (Number.isNaN(t)) return 1.0;           // unparseable run -> full weight, skip decay
    const daysAgo = (latestTs - t) / 86400000;
    return Math.pow(0.5, daysAgo / 14);
  };

  for (const run of runs) {
    const d = new Date(run.timestamp);
    const dow = d.getDay();        // 0=Sun..6=Sat
    const localHour = d.getHours();
    const w = weightFor(run.timestamp);
    for (const m of run.models) {
      if (allowSet && !allowSet.has(m.model)) continue;   // top-5 allowlist gate
      if (m.success && m.responseTime > 0) {
        dowWeightedSum[dow][localHour] += m.responseTime * w;
        dowWeightTotal[dow][localHour] += w;
        dowRealCount[dow][localHour]++;
      } else if (!m.success) {
        dowFailCount[dow][localHour]++;
        dowFailWeight[dow][localHour] += w;
      }
    }
  }

  // --- Raw per-cell averages + failure penalty (same shape as today, per (dow,hour)) ---
  const rawAvg = Array.from({ length: 7 }, () => Array(24).fill(0));
  const nonEmptyCellValues = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 0; h < 24; h++) {
      if (dowWeightTotal[dow][h] > 0) {
        rawAvg[dow][h] = dowWeightedSum[dow][h] / dowWeightTotal[dow][h];
        nonEmptyCellValues.push(rawAvg[dow][h]);
      }
    }
  }
  const globalMean = nonEmptyCellValues.length ? avg(nonEmptyCellValues) : 0;
  const penalty = 2 * (globalMean || 1);

  // dowRowMean(dow): mean of real-data cells in this dow row (using rawAvg, real cells only),
  // or null if the whole row is empty. Computed from dowWeightTotal so it stays stable after
  // empty-cell interpolation (interpolation never flips dowWeightTotal[dow][h] from 0 to >0).
  const dowRowMean = (dow) => {
    let s = 0, c = 0;
    for (let h = 0; h < 24; h++) {
      if (dowWeightTotal[dow][h] > 0) { s += rawAvg[dow][h]; c++; }
    }
    return c > 0 ? s / c : null;
  };

  for (let dow = 0; dow < 7; dow++) {
    for (let h = 0; h < 24; h++) {
      if (dowWeightTotal[dow][h] === 0 && dowFailCount[dow][h] === 0) {
        // Interpolate empty cell: per-dow row mean for this hour's dow if available, else global mean.
        rawAvg[dow][h] = dowRowMean(dow) ?? globalMean;
      } else if (dowFailCount[dow][h] > 0) {
        // Failure penalty: blend success+failure weighted totals within the cell.
        const totalW = dowWeightTotal[dow][h] + dowFailWeight[dow][h];
        const totalSum = dowWeightedSum[dow][h] + penalty * dowFailWeight[dow][h];
        rawAvg[dow][h] = totalW > 0 ? totalSum / totalW : penalty;
      }
    }
  }

  // --- E2 shrinkage before spatial smoothing ---
  // neighborhoodMean = circular mean of (dow, h±1) cells in the SAME dow row (2 neighbors);
  // fall back to the dow-row mean if both neighbors are empty; fall back to global if the whole row is empty.
  const regularized = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (let dow = 0; dow < 7; dow++) {
    const rowMean = dowRowMean(dow);   // null iff the whole dow row has no real data
    for (let h = 0; h < 24; h++) {
      const leftIdx = (h - 1 + 24) % 24;
      const rightIdx = (h + 1) % 24;
      const leftReal = dowWeightTotal[dow][leftIdx] > 0;
      const rightReal = dowWeightTotal[dow][rightIdx] > 0;
      let neighborhoodMean;
      if (leftReal || rightReal) {
        // At least one neighbor has real data -> circular mean of the two neighbor cells.
        neighborhoodMean = (rawAvg[dow][leftIdx] + rawAvg[dow][rightIdx]) / 2;
      } else {
        // Both neighbors empty -> dow-row hour mean, else global mean.
        neighborhoodMean = rowMean ?? globalMean;
      }
      const n = dowRealCount[dow][h];
      const effective_n = n > 0 ? n : 0.5;
      const shrink = 1 / (1 + effective_n);
      regularized[dow][h] = (1 - shrink) * rawAvg[dow][h] + shrink * neighborhoodMean;
    }
  }

  // --- Spatial smoothing per dow row (circular over 24 hours) ---
  // 5-tap [1,2,3,2,1]/9 uniformly; 7-tap [1,1,2,3,2,1,1]/11 only for pure-interpolation borders (realCount===0).
  const smoothedDow = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 0; h < 24; h++) {
      const sparse = dowRealCount[dow][h] === 0;
      const offsets = sparse ? [-3, -2, -1, 0, 1, 2, 3] : [-2, -1, 0, 1, 2];
      const weights = sparse ? [1, 1, 2, 3, 2, 1, 1] : [1, 2, 3, 2, 1];
      let sum = 0, wsum = 0;
      for (let i = 0; i < offsets.length; i++) {
        sum += regularized[dow][(h + offsets[i] + 24) % 24] * weights[i];
        wsum += weights[i];
      }
      smoothedDow[dow][h] = sum / wsum;
    }
  }

  // --- Fold to 24h with weekend down-weight ---
  const WEEKEND_WEIGHT = 0.5; // Sat (6) / Sun (0)
  const dowWeight = [WEEKEND_WEIGHT, 1, 1, 1, 1, 1, WEEKEND_WEIGHT];
  const hourAvg = Array(24).fill(0);
  const smoothed = Array(24).fill(0);
  const hourRealCount = Array(24).fill(0);
  const weightedCounts = Array(24).fill(0);
  const hourFailCount = Array(24).fill(0);
  const isReal = Array(24).fill(false);
  for (let h = 0; h < 24; h++) {
    let foldSum = 0, foldW = 0;
    for (let dow = 0; dow < 7; dow++) {
      foldSum += dowWeight[dow] * smoothedDow[dow][h];
      foldW += dowWeight[dow];
      hourRealCount[h] += dowRealCount[dow][h];
      weightedCounts[h] += dowWeightTotal[dow][h];
      hourFailCount[h] += dowFailCount[dow][h];
      if (dowWeightTotal[dow][h] > 0) isReal[h] = true;
    }
    smoothed[h] = foldW > 0 ? foldSum / foldW : 0;
  }
  // Fold hourAvg (dow-weighted) from the regularized raw per-cell averages, mirroring smoothed's fold.
  for (let h = 0; h < 24; h++) {
    let foldSum = 0, foldW = 0;
    for (let dow = 0; dow < 7; dow++) {
      foldSum += dowWeight[dow] * regularized[dow][h];
      foldW += dowWeight[dow];
    }
    hourAvg[h] = foldW > 0 ? foldSum / foldW : 0;
  }
  weightedCounts.forEach((v, i) => { weightedCounts[i] = Math.round(v); });

  return { hourAvg, smoothed, isReal, hourRealCount, weightedCounts, hourFailCount };
}

export function computeBestTimeslots(hourlyStats) {
  const { smoothed, isReal } = hourlyStats;
  const ZONE_SIZE = 4;

  const zones = [];
  for (let start = 0; start < 24; start++) {
    const hours = [];
    let realCount = 0;
    for (let offset = 0; offset < ZONE_SIZE; offset++) {
      const h = (start + offset) % 24;
      hours.push(h);
      if (isReal[h]) realCount++;
    }
    const zoneAvg = avg(hours.map(h => smoothed[h]));
    zones.push({ start, hours, avgTime: zoneAvg, realCount, score: 0 });
  }

  // Score all zones from their min/max so medals remain comparable across the full set.
  const minAvg = Math.min(...zones.map(z => z.avgTime));
  const maxAvg = Math.max(...zones.map(z => z.avgTime));
  for (const z of zones) {
    z.score = maxAvg > minAvg ? Math.round((minAvg / z.avgTime) * 100) : 100;
  }

  // E1 zone confidence gate: prefer zones with >= MIN_REAL_HOURS of real data.
  // Relax the threshold when no valid 3-zone combo exists at the stricter tier,
  // so ultra-sparse data (top-5 filter cuts sample counts ~5x) still shows
  // something rather than a blank chart.
  const pickBestCombo = (pool) => {
    let best = null, bestSum = -1;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (zonesOverlap(pool[i], pool[j])) continue;
        for (let k = j + 1; k < pool.length; k++) {
          if (zonesOverlap(pool[i], pool[k]) || zonesOverlap(pool[j], pool[k])) continue;
          const sum = pool[i].score + pool[j].score + pool[k].score;
          if (sum > bestSum) { bestSum = sum; best = [pool[i], pool[j], pool[k]]; }
        }
      }
    }
    return best;
  };

  // Try stricter thresholds first; relax to 1 then 0 only when the current tier
  // yields no valid non-overlapping triplet (pool size alone can't decide it —
  // 4 contiguous zones have size >=3 but zero possible combos).
  const tiers = [2, 1, 0];
  let bestCombo = null;
  for (const minReal of tiers) {
    const pool = minReal > 0 ? zones.filter(z => z.realCount >= minReal) : zones;
    bestCombo = pickBestCombo(pool);
    if (bestCombo) break;
  }

  if (!bestCombo) return [];
  bestCombo.sort((a, b) => b.score - a.score);
  return bestCombo;
}

function zonesOverlap(a, b) {
  const setA = new Set(a.hours);
  return b.hours.some(h => setA.has(h));
}
