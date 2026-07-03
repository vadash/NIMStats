import { CHART_DEFAULTS } from '../constants.js';
import { state } from '../state.js';
import { shortModel, providerMeta, providerChip, fmtTimestamp, fmtTimestampShort, destroyChart, modelColor, escHtml } from '../helpers.js';
import { openModal } from '../modal.js';

const RESPONSE_AVG_WINDOW = 12;

function rollingAverage(values, windowSize) {
  let sum = 0;
  let count = 0;
  return values.map((v, i) => {
    if (v != null) {
      sum += v;
      count++;
    }
    const expired = values[i - windowSize];
    if (i >= windowSize && expired != null) {
      sum -= expired;
      count--;
    }
    return count ? sum / count : null;
  });
}

export function populateExplorerSelect() {
  const sel = document.getElementById('explorer-select');
  const sorted = [...state.modelNames].sort((a,b) => state.modelStats[b].score - state.modelStats[a].score);
  sel.innerHTML = sorted.map(m =>
    `<option value="${m}"${m === state.explorerModel ? ' selected' : ''}>${shortModel(m)} (${providerMeta(m).name})</option>`
  ).join('');
  sel.addEventListener('change', e => {
    state.explorerModel = e.target.value;
    renderExplorer();
  });
}

export function renderExplorer() {
  const model = state.explorerModel;
  const s = state.modelStats[model];
  const pm = providerMeta(model);
  if (!s) return;

  const sel = document.getElementById('explorer-select');
  if (sel.value !== model) sel.value = model;

  document.getElementById('explorer-header').innerHTML = `
    ${providerChip(model)}
    <h2>${shortModel(model)}</h2>
    <span style="font-size:12px;color:var(--text-dim);margin-left:auto">
      Last seen: ${s.lastSeen ? fmtTimestamp(s.lastSeen) : '--'}
    </span>
  `;

  const uptimeColor = s.uptime >= 0.7 ? 'var(--success)' : s.uptime >= 0.4 ? 'var(--warning)' : 'var(--danger)';
  document.getElementById('explorer-stats').innerHTML = `
    <div class="stat-card"><div class="stat-val" style="color:${uptimeColor}">${(s.uptime*100).toFixed(1)}%</div><div class="stat-label">Uptime</div><div class="stat-sub">${s.successCount}/${s.totalRuns} runs</div></div>
    <div class="stat-card"><div class="stat-val">${s.avgTime ? (s.avgTime/1000).toFixed(2)+'s' : '--'}</div><div class="stat-label">Avg Response</div></div>
    <div class="stat-card"><div class="stat-val text-accent">${s.bestTime ? (s.bestTime/1000).toFixed(2)+'s' : '--'}</div><div class="stat-label">Best Response</div></div>
    <div class="stat-card"><div class="stat-val" style="color:var(--blue)">${s.avgTps ? s.avgTps.toFixed(1)+' t/s' : '--'}</div><div class="stat-label">Avg Throughput</div></div>
  `;

  // Response time chart
  const labels = state.runs.map(r => fmtTimestampShort(r.timestamp));
  const timeData = s.responseTimes.map(v => v != null ? v / 1000 : null);
  const avgTimeData = rollingAverage(timeData, RESPONSE_AVG_WINDOW);
  const rawColor = modelColor(model);

  destroyChart('explorerTime');
  state.charts.explorerTime = new Chart(document.getElementById('chart-explorer-time'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `${RESPONSE_AVG_WINDOW}-run average`,
        data: avgTimeData,
        borderColor: '#8bd11f',
        backgroundColor: '#8bd11f1f',
        fill: true,
        tension: 0.45,
        spanGaps: true,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 8,
        borderWidth: 3,
      }, {
        label: 'Raw runs',
        data: timeData,
        borderColor: rawColor + '66',
        backgroundColor: rawColor + '14',
        fill: false,
        hidden: true,
        tension: 0.18,
        spanGaps: false,
        pointRadius: timeData.map(v => v != null ? 2 : 0),
        pointHoverRadius: 5,
        borderWidth: 1.5,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: {
        display: true,
        align: 'end',
        labels: {
          boxWidth: 22,
          color: '#c7d1bf',
          font: { size: 11 },
          usePointStyle: true,
          pointStyle: 'line'
        }
      }, tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
        label: (item) => {
          if (item.raw == null) return item.dataset.label === 'Raw runs' ? 'Raw runs: failed' : `${item.dataset.label}: no successes`;
          return `${item.dataset.label}: ${item.raw.toFixed(2)}s`;
        }
      }}},
      scales: {
        x: { display: false },
        y: { grid: { color: '#2b3627' }, ticks: { callback: v => v + 's' } }
      }
    }
  });

  // Error donut
  destroyChart('explorerErrors');
  const errorCanvas = document.getElementById('chart-explorer-errors');
  const noErrors = document.getElementById('explorer-no-errors');
  const errorKeys = Object.keys(s.errors);
  if (errorKeys.length === 0) {
    errorCanvas.style.display = 'none';
    noErrors.style.display = 'block';
  } else {
    errorCanvas.style.display = 'block';
    noErrors.style.display = 'none';
    const errorColors = ['#ff6f61','#f2b84b','#b98cff','#5ca7f2','#5fd3df','#8a9584'];
    state.charts.explorerErrors = new Chart(errorCanvas, {
      type: 'doughnut',
      data: {
        labels: errorKeys,
        datasets: [{
          data: errorKeys.map(k => s.errors[k]),
          backgroundColor: errorColors.slice(0, errorKeys.length).map(c => c + 'cc'),
          borderColor: errorColors.slice(0, errorKeys.length),
          borderWidth: 1,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: CHART_DEFAULTS.tooltip,
        }
      }
    });
  }

  // Heatmap
  const hm = document.getElementById('explorer-heatmap');
  const reversed = [...s.results].reverse();
  const hmCols = Math.ceil(Math.sqrt(reversed.length));
  hm.style.gridTemplateColumns = `repeat(${hmCols}, 1fr)`;
  hm.innerHTML = reversed.map((r, i) => {
    const runIdx = s.results.length - 1 - i;
    if (!r) return `<div class="heatmap-cell miss" title="Run ${runIdx+1}: No data"></div>`;
    const ts = fmtTimestamp(state.runs[runIdx]?.timestamp || '');
    if (r.success) return `<div class="heatmap-cell pass" title="${ts}: OK ${(r.responseTime/1000).toFixed(2)}s"></div>`;
    return `<div class="heatmap-cell fail" title="${ts}: FAIL ${r.error||'Error'}"></div>`;
  }).join('');

  // Run history table
  const tbody = document.getElementById('explorer-run-table');
  const last20 = s.results.map((r, i) => ({ r, i })).slice(-20).reverse();
  tbody.innerHTML = last20.map(({ r, i }) => {
    if (!r) return `<tr><td class="mono text-dim">${fmtTimestamp(state.runs[i]?.timestamp||'')}</td><td>--</td><td>--</td><td>--</td><td>--</td></tr>`;
    const tps = (r.success && r.responseTime > 0) ? (r.tokensGenerated / (r.responseTime / 1000)).toFixed(1) : null;
    const actionBtn = r.success
      ? `<button class="btn-view" data-run="${i}">View</button>` : '--';
    return `<tr>
      <td class="mono" style="font-size:11px">${fmtTimestamp(state.runs[i]?.timestamp||'')}</td>
      <td><span class="status-badge ${r.success?'ok':'fail'}">${r.success?'OK':'Fail'}</span></td>
      <td class="mono">${r.success ? (r.responseTime/1000).toFixed(2)+'s' : '--'}</td>
      <td class="mono">${tps ? tps+' t/s' : '--'}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-view[data-run]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.run);
      const run = state.runs[idx];
      if (!run) return;
      const q = state.db.exec(
        'SELECT response FROM model_results WHERE run_id = ? AND model = ?',
        [run._dbId, model]
      );
      const response = q[0]?.values[0]?.[0] || '';
      openModal(model, response);
    });
  });
}
