import { CHART_DEFAULTS, cnPeakOverlayPlugin, euNaPeakOverlayPlugin, currentTimeLinePlugin, getCnPeakLocalWindows, cnPeakWindowsForHour, getEuNaPeakLocalWindows, euNaPeakWindowsForHour, splitHourWindow, wrapHour, TS_MODELS_KEY } from './constants.js';
import { state } from './state.js';
import { avg, modelColor, destroyChart, sortModelsByLiveScore, shortModel } from './helpers.js';
import { computeHourlyStats, computeBestTimeslots } from './data.js';

Chart.defaults.color = '#aeb9a8';
Chart.defaults.borderColor = '#2b3627';
Chart.defaults.font.family = "'Inter', sans-serif";

export function renderBestTimeslot() {
  // Top-10 leaderboard models form the pickable pool; state.timeslotModels
  // holds the active selection (persisted in localStorage by app.js).
  const top10 = sortModelsByLiveScore(state.modelNames, state.modelStats, state.runs).slice(0, 10);
  const selectSet = new Set(state.timeslotModels.length ? state.timeslotModels : top10);
  const hourlyStats = computeHourlyStats(state.runs, selectSet);
  const bestSlots = computeBestTimeslots(hourlyStats);
  const { smoothed, weightedCounts, hourRealCount, hourFailCount } = hourlyStats;

  renderTimeslotModelPicker(top10, selectSet);
  const subEl = document.getElementById('timeslot-sub');
  if (subEl) {
    const count = selectSet.size;
    subEl.textContent = `Based on ${count} of 10 models · last 30 days`;
  }

  const labels = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  const dataSec = smoothed.map(v => v / 1000);
  const cnPeakWindows = getCnPeakLocalWindows(state.runs);
  const euNaPeakWindows = getEuNaPeakLocalWindows(state.runs);

  const minVal = Math.min(...smoothed);
  const maxVal = Math.max(...smoothed);
  const range = maxVal - minVal || 1;

  const barColorsFills = smoothed.map(v => {
    const t = (v - minVal) / range;
    const r = Math.round(118 + t * (239 - 118));
    const g = Math.round(185 - t * (185 - 68));
    const b = Math.round(0 + t * (68 - 0));
    return { r, g, b };
  });

  const highlightBorders = barColorsFills.map(() => null);
  const highlightBg = barColorsFills.map(() => null);
  for (let si = 0; si < bestSlots.length; si++) {
    const zone = bestSlots[si];
    for (const h of zone.hours) {
      const borderColor = si === 0 ? '#8bd11f' : si === 1 ? '#60d985' : '#5ca7f2';
      highlightBorders[h] = borderColor;
      highlightBg[h] = borderColor + 'cc';
    }
  }

  const finalBgColors = barColorsFills.map((c, h) =>
    highlightBg[h] ? highlightBg[h] : `rgba(${c.r},${c.g},${c.b},0.7)`
  );
  const finalBorderColors = barColorsFills.map((c, h) =>
    highlightBorders[h] ? highlightBorders[h] : `rgb(${c.r},${c.g},${c.b})`
  );

  destroyChart('bestTimeslot');
  state.charts.bestTimeslot = new Chart(document.getElementById('chart-best-timeslot'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Avg Response Time',
        data: dataSec,
        backgroundColor: finalBgColors,
        borderColor: finalBorderColors,
        borderWidth: 2,
        borderRadius: 3,
      }]
    },
    plugins: [cnPeakOverlayPlugin, euNaPeakOverlayPlugin, currentTimeLinePlugin],
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 16 } },
      plugins: { legend: { display: false }, cnPeakOverlay: { windows: cnPeakWindows }, euNaPeakOverlay: { windows: euNaPeakWindows }, tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
        title: (items) => `Hour ${items[0].label}:00`,
        label: (item) => {
          const h = item.dataIndex;
          const fails = hourFailCount[h];
          const failStr = fails > 0 ? ` | ${fails} failed` : '';
          const lines = [`Avg: ${item.raw.toFixed(2)}s · ${hourRealCount[h]} samples (${weightedCounts[h].toFixed(1)} weighted)${failStr}`];
          const peakHits = cnPeakWindowsForHour(h, cnPeakWindows);
          if (peakHits.length) {
            lines.push(`CN peak: ${peakHits.map(w => w.localLabel).join(', ')} local`);
          }
          const euNaHits = euNaPeakWindowsForHour(h, euNaPeakWindows);
          if (euNaHits.length) {
            lines.push(`EU+NA peak: ${euNaHits.map(w => w.localLabel).join(', ')} local`);
          }
          return lines;
        }
      }}},
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { grid: { color: '#2b3627' }, ticks: { callback: v => v + 's' }, beginAtZero: true }
      }
    }
  });

  // Recommendations
  const recsEl = document.getElementById('timeslot-recommendations');
  const cnPeakPills = cnPeakWindows.map(w => `<div class="timeslot-pill cn-peak" title="${w.utcLabel}">
      <span class="rank">CN</span>
      <span class="ts-range">${w.localLabel}</span>
      <span class="ts-conf">LOCAL</span>
    </div>`).join('');
  const euNaPeakPills = euNaPeakWindows.map(w => `<div class="timeslot-pill eu-na-peak" title="${w.utcLabel}">
      <span class="rank">EU+NA</span>
      <span class="ts-range">${w.localLabel}</span>
      <span class="ts-conf">LOCAL</span>
    </div>`).join('');
  if (!bestSlots.length) {
    recsEl.innerHTML = '<span class="no-data">Not enough data yet</span>' + cnPeakPills + euNaPeakPills;
    return;
  }
  const rankLabels = ['01', '02', '03'];
  recsEl.innerHTML = bestSlots.map((zone, i) => {
    const startH = String(zone.start).padStart(2, '0');
    const endH = String((zone.start + 4) % 24).padStart(2, '0');
    const confLabel = zone.realCount >= 3 ? 'high' : zone.realCount === 2 ? 'medium' : 'low';
    const confCls = zone.realCount >= 3 ? 'green' : zone.realCount === 2 ? 'yellow' : 'gray';
    const confidence = confLabel.toUpperCase();
    return `<div class="timeslot-pill ${confCls}">
      <span class="rank">${rankLabels[i]}</span>
      <span class="ts-range">${startH}:00-${endH}:00</span>
      <span class="ts-score">${zone.score}</span>
      <span class="ts-conf">${confidence}</span>
    </div>`;
  }).join('') + cnPeakPills + euNaPeakPills;
}

// Render the top-10 model picker above the chart. Toggle persists the
// selection to localStorage and re-renders only the Best Timeslot chart.
function renderTimeslotModelPicker(top10, selectSet) {
  const pickerEl = document.getElementById('timeslot-model-picker');
  if (!pickerEl) return;
  pickerEl.innerHTML = top10.map((m, i) => {
    const active = selectSet.has(m);
    const color = modelColor(m);
    const name = shortModel(m);
    return `<button type="button" class="ts-model-pill${active ? ' active' : ''}" data-idx="${i}" title="${m}">
      <span class="pv-dot" style="background:${active ? color : ''};"></span>
      <span class="pv-name">${name}</span>
    </button>`;
  }).join('');
  pickerEl.querySelectorAll('.ts-model-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = top10[+btn.dataset.idx];
      if (!m) return;
      const set = new Set(state.timeslotModels);
      if (set.has(m)) set.delete(m); else set.add(m);
      // Never allow empty — that would clear the chart.
      if (set.size === 0) set.add(m);
      state.timeslotModels = [...set];
      try { localStorage.setItem(TS_MODELS_KEY, JSON.stringify(state.timeslotModels)); } catch {}
      renderBestTimeslot();
    });
  });
}

