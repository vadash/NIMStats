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

export function computeHourlyStats(runs) {
  const hourWeightedSum = Array(24).fill(0);
  const hourWeightTotal = Array(24).fill(0);
  const hourRealCount = Array(24).fill(0);
  const hourFailCount = Array(24).fill(0);
  const hourFailWeight = Array(24).fill(0);

  let latestTs = 0;
  for (const run of runs) {
    if (run.timestamp > latestTs) latestTs = run.timestamp;
  }

  const weightFor = (ts) => {
    if (!latestTs) return 1.0;
    const daysAgo = (latestTs - ts) / 86400000;
    if (daysAgo <= 7) return 1.0;
    if (daysAgo < 30) return 1.0 - 0.7 * (daysAgo - 7) / 23;
    return 0.3;
  };

  for (const run of runs) {
    const localHour = new Date(run.timestamp).getHours();
    const w = weightFor(run.timestamp);
    for (const m of run.models) {
      if (m.success && m.responseTime > 0) {
        hourWeightedSum[localHour] += m.responseTime * w;
        hourWeightTotal[localHour] += w;
        hourRealCount[localHour]++;
      } else if (!m.success) {
        hourFailCount[localHour]++;
        hourFailWeight[localHour] += w;
      }
    }
  }

  const hourAvg = Array(24).fill(0);
  const hoursWithData = [];
  for (let h = 0; h < 24; h++) {
    if (hourWeightTotal[h] > 0) {
      hourAvg[h] = hourWeightedSum[h] / hourWeightTotal[h];
      hoursWithData.push(hourAvg[h]);
    }
  }
  const globalMean = hoursWithData.length ? avg(hoursWithData) : 0;

  for (let h = 0; h < 24; h++) {
    if (hourWeightTotal[h] === 0 && hourFailCount[h] === 0) {
      hourAvg[h] = globalMean;
    }
  }

  for (let h = 0; h < 24; h++) {
    if (hourFailCount[h] > 0) {
      const penalty = 2 * (globalMean || 1);
      const totalW = hourWeightTotal[h] + hourFailWeight[h];
      const totalSum = hourWeightedSum[h] + penalty * hourFailWeight[h];
      hourAvg[h] = totalW > 0 ? totalSum / totalW : penalty;
    }
  }

  const isReal = Array(24).fill(true);
  for (let h = 0; h < 24; h++) {
    if (hourWeightTotal[h] === 0) {
      isReal[h] = false;
    }
  }

  const smoothed = Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    const sparse = hourRealCount[h] < 3;
    const offsets = sparse ? [-3, -2, -1, 0, 1, 2, 3] : [-2, -1, 0, 1, 2];
    const weights = sparse ? [1, 1, 2, 3, 2, 1, 1] : [1, 2, 3, 2, 1];
    let sum = 0, wsum = 0;
    for (let i = 0; i < offsets.length; i++) {
      sum += hourAvg[(h + offsets[i] + 24) % 24] * weights[i];
      wsum += weights[i];
    }
    smoothed[h] = sum / wsum;
  }

  const weightedCounts = hourWeightTotal.map(w => Math.round(w));

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

  const minAvg = Math.min(...zones.map(z => z.avgTime));
  const maxAvg = Math.max(...zones.map(z => z.avgTime));
  for (const z of zones) {
    z.score = maxAvg > minAvg ? Math.round((minAvg / z.avgTime) * 100) : 100;
  }

  let bestCombo = null;
  let bestSum = -1;

  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      if (zonesOverlap(zones[i], zones[j])) continue;
      for (let k = j + 1; k < zones.length; k++) {
        if (zonesOverlap(zones[i], zones[k]) || zonesOverlap(zones[j], zones[k])) continue;
        const sum = zones[i].score + zones[j].score + zones[k].score;
        if (sum > bestSum) {
          bestSum = sum;
          bestCombo = [zones[i], zones[j], zones[k]];
        }
      }
    }
  }

  if (!bestCombo) return [];
  bestCombo.sort((a, b) => b.score - a.score);
  return bestCombo;
}

function zonesOverlap(a, b) {
  const setA = new Set(a.hours);
  return b.hours.some(h => setA.has(h));
}
