import { state } from '../state.js';
import { shortModel, providerChip, sparklineSVG, modelColor, sortModelsByLiveScore, compareLiveStatus } from '../helpers.js';
import { switchTab } from '../nav.js';

export function renderLeaderboard() {
  const { modelNames, modelStats } = state;
  const scores = sortModelsByLiveScore(modelNames, modelStats, state.runs);
  const ranks = {};
  scores.forEach((m, i) => { ranks[m] = i + 1; });

  state.lbData = modelNames.map(m => ({ model: m, rank: ranks[m], ...modelStats[m] }));
  renderLbTable();
}

export function renderLbTable() {
  const { lbData, lbSort, lbFilter } = state;
  if (!lbData) return;

  let rows = [...lbData];
  if (lbFilter) {
    rows = rows.filter(r => r.model.toLowerCase().includes(lbFilter.toLowerCase()));
  }

  rows.sort((a, b) => {
    const liveSort = compareLiveStatus(a, b);
    if (liveSort) return liveSort;
    let av = a[lbSort.col], bv = b[lbSort.col];
    if (av == null) av = lbSort.dir === 'asc' ? Infinity : -Infinity;
    if (bv == null) bv = lbSort.dir === 'asc' ? Infinity : -Infinity;
    const valueSort = lbSort.dir === 'asc' ? av - bv : bv - av;
    return valueSort || a.model.localeCompare(b.model);
  });

  const tbody = document.getElementById('lb-body');
  tbody.innerHTML = rows.map((r) => {
    const uptimePct = (r.uptime * 100).toFixed(1);
    const uptimeColor = r.uptime >= 0.7 ? '#60d985' : r.uptime >= 0.4 ? '#f2b84b' : '#ff6f61';
    const scoreColor = r.score >= 60 ? '#60d985' : r.score >= 40 ? '#f2b84b' : '#ff6f61';
    const trendHtml = r.trend === 'up'
      ? `<span class="trend-indicator trend-up" title="Improving">^</span>`
      : r.trend === 'down'
      ? `<span class="trend-indicator trend-down" title="Declining">v</span>`
      : `<span class="trend-indicator trend-flat" title="Stable">-></span>`;
    const last10 = r.responseTimes.slice(-10);
    const spark = sparklineSVG(last10, 72, 22, modelColor(r.model));
    const isTop3 = r.rank <= 3;

    return `<tr data-model="${r.model}">
      <td><span class="rank-num${isTop3?' top3':''}">${r.rank}</span></td>
      <td><div class="model-name-cell">${providerChip(r.model, true)}<span class="model-name-text" title="${r.model}">${shortModel(r.model)}</span>${trendHtml}</div></td>
      <td><div class="score-cell"><span class="score-num" style="color:${scoreColor}">${r.score}</span></div></td>
      <td><div class="uptime-cell"><span class="uptime-val" style="color:${uptimeColor}">${uptimePct}%</span><div class="uptime-bar"><div class="uptime-fill" style="width:${uptimePct}%;background:${uptimeColor}"></div></div></div></td>
      <td class="mono">${r.avgTime ? (r.avgTime/1000).toFixed(2)+'s' : '--'}</td>
      <td class="mono">${r.bestTime ? (r.bestTime/1000).toFixed(2)+'s' : '--'}</td>
      <td class="mono">${r.avgTps ? r.avgTps.toFixed(1)+' t/s' : '--'}</td>
      <td class="mono text-accent">${r.wins}</td>
      <td>${spark}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-model]').forEach(row => {
    row.addEventListener('click', () => {
      state.explorerModel = row.dataset.model;
      switchTab('explorer');
    });
  });
}

export function initLeaderboardSort() {
  document.querySelectorAll('#lb-table thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (col === 'model' || col === 'trend') return;
      if (state.lbSort.col === col) {
        state.lbSort.dir = state.lbSort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        state.lbSort.col = col;
        state.lbSort.dir = 'desc';
      }
      document.querySelectorAll('#lb-table thead th').forEach(t => t.classList.remove('sorted'));
      th.classList.add('sorted');
      th.querySelector('.sort-arrow').textContent = state.lbSort.dir === 'desc' ? 'v' : '^';
      renderLbTable();
    });
  });

  document.getElementById('lb-search').addEventListener('input', e => {
    state.lbFilter = e.target.value;
    renderLbTable();
  });
}
