import { CHART_DEFAULTS } from '../constants.js';
import { state } from '../state.js';
import { avg, shortModel, providerChip, animateCounter, destroyChart, modelColor } from '../helpers.js';
import { renderBestTimeslot } from '../charts.js';

export function renderOverview() {
  const { runs, modelNames, modelStats } = state;

  const totalRuns = runs.length;
  const allUptimes = modelNames.map(m => modelStats[m].uptime);
  const avgSuccessRate = avg(allUptimes) * 100;

  let bestTimeModel = null, bestTimeVal = Infinity;
  let bestTpsModel = null, bestTpsVal = 0;
  for (const m of modelNames) {
    const s = modelStats[m];
    if (s.avgTime != null && s.avgTime < bestTimeVal) { bestTimeVal = s.avgTime; bestTimeModel = m; }
    if (s.avgTps != null && s.avgTps > bestTpsVal) { bestTpsVal = s.avgTps; bestTpsModel = m; }
  }
  const mostReliable = [...modelNames].sort((a, b) => modelStats[b].uptime - modelStats[a].uptime)[0];

  const kpiData = [
    { icon: 'RUN', label: 'Total Runs', val: totalRuns, sub: `${runs[0]?.timestamp?.slice(0,10)} to ${runs[runs.length-1]?.timestamp?.slice(0,10)}`, decimals: 0 },
    { icon: 'SLA', label: 'Avg Success Rate', val: avgSuccessRate, suffix: '%', decimals: 1, sub: 'across all runs and models' },
    { icon: 'LAT', label: 'Avg Best Response', val: bestTimeVal / 1000, suffix: 's', decimals: 2, sub: bestTimeModel ? shortModel(bestTimeModel) : '' },
    { icon: 'TPS', label: 'Avg Best Throughput', val: bestTpsVal, suffix: ' t/s', decimals: 1, sub: bestTpsModel ? shortModel(bestTpsModel) : '' },
    { icon: 'REL', label: 'Most Reliable', val: (modelStats[mostReliable]?.uptime || 0) * 100, suffix: '%', decimals: 1, sub: mostReliable ? shortModel(mostReliable) : '' },
  ];

  const kpiGrid = document.getElementById('kpi-grid');
  kpiGrid.innerHTML = kpiData.map(k => `
    <div class="kpi-card">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-value" id="kpi-val-${k.label.replace(/\s/g,'_')}">0${k.suffix||''}</div>
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>
  `).join('');

  kpiData.forEach(k => {
    const el = document.getElementById('kpi-val-' + k.label.replace(/\s/g,'_'));
    if (el) animateCounter(el, k.val, 1400, k.decimals || 0, k.suffix || '');
  });

  document.getElementById('overview-sub').textContent =
    `${totalRuns} benchmark runs | ${modelNames.length} models | ${runs[0]?.timestamp?.slice(0,10)} to ${runs[runs.length-1]?.timestamp?.slice(0,10)}`;

  renderBestTimeslot();

  // Top 10 Fastest
  const modelsWithTime = modelNames
    .filter(m => modelStats[m].avgTime != null)
    .sort((a, b) => modelStats[a].avgTime - modelStats[b].avgTime)
    .slice(0, 10);

  destroyChart('fastest');
  state.charts.fastest = new Chart(document.getElementById('chart-fastest'), {
    type: 'bar',
    data: {
      labels: modelsWithTime.map(m => shortModel(m)),
      datasets: [{
        data: modelsWithTime.map(m => modelStats[m].avgTime / 1000),
        backgroundColor: modelsWithTime.map((m, i) => i === 0 ? '#8bd11f' : 'rgba(79,125,0,0.28)'),
        borderColor: modelsWithTime.map((m, i) => i === 0 ? '#8bd11f' : 'rgba(79,125,0,0.48)'),
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
        label: (item) => `Avg: ${item.raw.toFixed(2)}s`
      }}},
      scales: {
        x: { grid: { color: '#2b3627' }, ticks: { callback: v => v + 's' } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });

  // Top 10 Throughput
  const modelsWithTps = modelNames
    .filter(m => modelStats[m].avgTps != null)
    .sort((a, b) => modelStats[b].avgTps - modelStats[a].avgTps)
    .slice(0, 10);

  destroyChart('throughput');
  state.charts.throughput = new Chart(document.getElementById('chart-throughput'), {
    type: 'bar',
    data: {
      labels: modelsWithTps.map(m => shortModel(m)),
      datasets: [{
        data: modelsWithTps.map(m => modelStats[m].avgTps),
        backgroundColor: modelsWithTps.map((m, i) => i === 0 ? '#5ca7f2' : 'rgba(21,95,163,0.24)'),
        borderColor: modelsWithTps.map((m, i) => i === 0 ? '#5ca7f2' : 'rgba(21,95,163,0.48)'),
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
        label: (item) => `${item.raw.toFixed(1)} tok/s`
      }}},
      scales: {
        x: { grid: { color: '#2b3627' }, ticks: { callback: v => v + ' t/s' } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });

  // Reliability pills
  const grid = document.getElementById('reliability-grid');
  const sorted = [...modelNames].sort((a, b) => modelStats[b].uptime - modelStats[a].uptime);
  grid.innerHTML = sorted.map(m => {
    const u = modelStats[m].uptime;
    const cls = u >= 0.7 ? 'green' : u >= 0.4 ? 'yellow' : 'red';
    return `<div class="rel-pill ${cls}"><span class="dot"></span>${shortModel(m)} <span style="opacity:0.7">${(u*100).toFixed(0)}%</span></div>`;
  }).join('');
}
