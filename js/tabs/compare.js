import { CHART_DEFAULTS } from '../constants.js';
import { state } from '../state.js';
import { shortModel, providerMeta, providerChip, fmtTimestampShort, destroyChart, modelColor, sortModelsByLiveScore, responseTimeDatasets, responseTimeTooltipLabel, COMPARE_RESPONSE_COLORS } from '../helpers.js';

export function populateCompareSelects() {
  const sorted = sortModelsByLiveScore(state.modelNames);
  const opts = sorted.map(m => `<option value="${m}">${shortModel(m)} (${providerMeta(m).name})</option>`).join('');

  const selA = document.getElementById('compare-a');
  const selB = document.getElementById('compare-b');
  selA.innerHTML = opts;
  selB.innerHTML = opts;

  const defaultA = 'qwen/qwen3-coder-480b-a35b-instruct';
  const defaultB = 'nvidia/nemotron-3-super-120b-a12b';
  selA.value = state.modelNames.includes(defaultA) ? defaultA : sorted[0];
  selB.value = state.modelNames.includes(defaultB) ? defaultB : sorted[1];

  selA.addEventListener('change', renderCompare);
  selB.addEventListener('change', renderCompare);

  document.getElementById('swap-btn').addEventListener('click', () => {
    const tmp = selA.value;
    selA.value = selB.value;
    selB.value = tmp;
    renderCompare();
  });
}

export function renderCompare() {
  const modelA = document.getElementById('compare-a').value;
  const modelB = document.getElementById('compare-b').value;
  const sA = state.modelStats[modelA];
  const sB = state.modelStats[modelB];
  if (!sA || !sB) return;

  let winsA = 0, winsB = 0, bothSucceeded = 0;
  state.runs.forEach((run, i) => {
    const rA = sA.results[i];
    const rB = sB.results[i];
    if (rA && rA.success && rB && rB.success) {
      bothSucceeded++;
      if (rA.responseTime < rB.responseTime) winsA++;
      else winsB++;
    }
  });

  const metrics = [
    { label: 'Uptime', a: (sA.uptime*100).toFixed(1)+'%', b: (sB.uptime*100).toFixed(1)+'%', higherBetter: true, av: sA.uptime, bv: sB.uptime },
    { label: 'Avg Response Time', a: sA.avgTime ? (sA.avgTime/1000).toFixed(2)+'s' : '--', b: sB.avgTime ? (sB.avgTime/1000).toFixed(2)+'s' : '--', higherBetter: false, av: sA.avgTime, bv: sB.avgTime },
    { label: 'Best Response Time', a: sA.bestTime ? (sA.bestTime/1000).toFixed(2)+'s' : '--', b: sB.bestTime ? (sB.bestTime/1000).toFixed(2)+'s' : '--', higherBetter: false, av: sA.bestTime, bv: sB.bestTime },
    { label: 'Avg Throughput', a: sA.avgTps ? sA.avgTps.toFixed(1)+' t/s' : '--', b: sB.avgTps ? sB.avgTps.toFixed(1)+' t/s' : '--', higherBetter: true, av: sA.avgTps, bv: sB.avgTps },
    { label: 'Total Wins', a: sA.wins, b: sB.wins, higherBetter: true, av: sA.wins, bv: sB.wins },
    { label: 'Score', a: sA.score, b: sB.score, higherBetter: true, av: sA.score, bv: sB.score },
    { label: 'H2H Win Rate', a: bothSucceeded ? (winsA/bothSucceeded*100).toFixed(1)+'%' : '--', b: bothSucceeded ? (winsB/bothSucceeded*100).toFixed(1)+'%' : '--', higherBetter: true, av: winsA, bv: winsB },
  ];

  const colorA = modelColor(modelA);
  const colorB = modelColor(modelB);

  document.getElementById('h2h-table').innerHTML = `
    <thead><tr>
      <td class="h2h-val-a" style="color:${colorA};font-size:13px;padding:10px 16px;text-align:center">${providerChip(modelA, true)} ${shortModel(modelA)}</td>
      <td class="h2h-metric">Metric</td>
      <td class="h2h-val-b" style="color:${colorB};font-size:13px;padding:10px 16px;text-align:center">${providerChip(modelB, true)} ${shortModel(modelB)}</td>
    </tr></thead>
    <tbody>${metrics.map(m => {
      let clsA = 'h2h-val-a', clsB = 'h2h-val-b';
      if (m.av != null && m.bv != null) {
        const aWins = m.higherBetter ? m.av > m.bv : m.av < m.bv;
        const bWins = m.higherBetter ? m.bv > m.av : m.bv < m.av;
        if (aWins) clsA += ' winner';
        if (bWins) clsB += ' winner';
      }
      return `<tr class="h2h-row">
        <td class="${clsA}" style="padding:10px 16px">${m.a}</td>
        <td class="h2h-metric" style="padding:10px 16px">${m.label}</td>
        <td class="${clsB}" style="padding:10px 16px">${m.b}</td>
      </tr>`;
    }).join('')}</tbody>
  `;

  // Overlay chart
  const labels = state.runs.map(r => fmtTimestampShort(r.timestamp));
  const datasets = responseTimeDatasets([
    { label: shortModel(modelA), responseTimes: sA.responseTimes },
    { label: shortModel(modelB), responseTimes: sB.responseTimes },
  ], COMPARE_RESPONSE_COLORS);

  destroyChart('compareTime');
  state.charts.compareTime = new Chart(document.getElementById('chart-compare-time'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
          label: responseTimeTooltipLabel
        }}
      },
      scales: {
        x: { display: false },
        y: { grid: { color: '#2b3627' }, ticks: { callback: v => v + 's' } }
      }
    }
  });

  // Win timeline
  const winData = state.runs.map((run, i) => {
    const rA = sA.results[i], rB = sB.results[i];
    if (!rA?.success && !rB?.success) return null;
    if (rA?.success && !rB?.success) return 1;
    if (!rA?.success && rB?.success) return -1;
    return rA.responseTime < rB.responseTime ? 1 : -1;
  });

  destroyChart('compareWins');
  state.charts.compareWins = new Chart(document.getElementById('chart-compare-wins'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Winner per run',
        data: winData,
        backgroundColor: winData.map(v => v == null ? '#2b3627' : v > 0 ? colorA + 'cc' : colorB + 'cc'),
        borderColor: winData.map(v => v == null ? '#2b3627' : v > 0 ? colorA : colorB),
        borderWidth: 1,
        borderRadius: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
          label: (item) => {
            if (item.raw == null) return 'Both failed';
            return item.raw > 0 ? `${shortModel(modelA)} won` : `${shortModel(modelB)} won`;
          }
        }}
      },
      scales: {
        x: { display: false },
        y: { display: false, min: -1.5, max: 1.5 }
      }
    }
  });
}
