import { PROVIDER_META, MODEL_PALETTE } from './constants.js';
import { state } from './state.js';

export function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function fmtMs(ms) {
  if (ms == null) return '--';
  return (ms / 1000).toFixed(2) + 's';
}

export function fmtTps(tps) {
  if (tps == null || tps <= 0) return '--';
  return tps.toFixed(1) + ' t/s';
}

export function fmtPct(v) {
  return (v * 100).toFixed(1) + '%';
}

export function shortModel(m) {
  return m.split('/')[1] || m;
}

export function getProvider(m) {
  return m.split('/')[0];
}

export function providerMeta(m) {
  const p = getProvider(m);
  return PROVIDER_META[p] || { name: p, color: '#666688' };
}

export function providerChip(m, small) {
  const pm = providerMeta(m);
  const s = small ? 'font-size:10px;padding:1px 6px' : 'font-size:11px;padding:2px 8px';
  return `<span class="provider-chip" style="background:${pm.color}22;color:${pm.color};border:1px solid ${pm.color}44;${s}">${pm.name}</span>`;
}

export function fmtTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtTimestampShort(ts) {
  const d = new Date(ts);
  const mo = d.toLocaleString('en', { month: 'short' });
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${mo}${day} ${hh}:${mm}`;
}

export function categorizeError(err) {
  if (!err) return 'Unknown';
  if (err.includes('timed out')) return 'Timeout';
  if (err.includes('JSON')) return 'JSON Error';
  if (err.includes('404')) return 'Not Found (404)';
  if (err.includes('410')) return 'Gone (410)';
  if (err.includes('closed connection')) return 'Connection Closed';
  return 'Other Error';
}

export function modelColor(model) {
  const idx = state.modelNames.indexOf(model);
  return MODEL_PALETTE[idx % MODEL_PALETTE.length];
}

export function destroyChart(key) {
  if (state.charts[key]) {
    state.charts[key].destroy();
    delete state.charts[key];
  }
}

export const RESPONSE_AVG_WINDOW = 12;
export const EXPLORER_RESPONSE_COLORS = ['#8bd11f', '#5ca7f2'];
export const COMPARE_RESPONSE_COLORS = ['#8bd11f', '#5ca7f2', '#f2b84b', '#b98cff'];

function latestRunTime(runs = state.runs) {
  return runs.reduce((latest, run) => {
    const ts = Date.parse(run.timestamp);
    return Number.isNaN(ts) ? latest : Math.max(latest, ts);
  }, 0);
}

export function hasRecentData(model, modelStats = state.modelStats, runs = state.runs) {
  const latest = latestRunTime(runs);
  if (!latest) return false;

  const results = modelStats[model]?.results || [];
  for (let i = results.length - 1; i >= 0; i--) {
    if (!results[i]) continue;
    const tested = Date.parse(runs[i]?.timestamp);
    return !Number.isNaN(tested) && latest - tested <= 24 * 60 * 60 * 1000;
  }

  const seen = Date.parse(modelStats[model]?.lastSeen || '');
  return !Number.isNaN(seen) && latest - seen <= 24 * 60 * 60 * 1000;
}

export function compareLiveStatus(a, b, modelStats = state.modelStats, runs = state.runs) {
  const aLive = hasRecentData(a.model || a, modelStats, runs);
  const bLive = hasRecentData(b.model || b, modelStats, runs);
  return Number(bLive) - Number(aLive);
}

export function sortModelsByLiveScore(models, modelStats = state.modelStats, runs = state.runs) {
  return [...models].sort((a, b) => {
    const liveSort = compareLiveStatus(a, b, modelStats, runs);
    if (liveSort) return liveSort;
    const scoreSort = (modelStats[b]?.score ?? -Infinity) - (modelStats[a]?.score ?? -Infinity);
    return scoreSort || a.localeCompare(b);
  });
}

export function rollingAverage(values, windowSize = RESPONSE_AVG_WINDOW) {
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

export function responseTimeSeconds(responseTimes) {
  return responseTimes.map(v => v != null ? v / 1000 : null);
}

export function responseTimeDatasets(series, colors) {
  return series.flatMap((item, i) => {
    const rawData = responseTimeSeconds(item.responseTimes);
    const smoothColor = colors[i];
    const rawColor = colors[i + series.length];
    return [{
      label: item.label,
      data: rollingAverage(rawData),
      borderColor: smoothColor,
      backgroundColor: smoothColor + '1f',
      fill: item.fill ?? false,
      tension: 0.45,
      spanGaps: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHitRadius: 8,
      borderWidth: 3,
    }, {
      label: `${item.label} raw`,
      data: rawData,
      borderColor: rawColor + '8a',
      backgroundColor: rawColor + '14',
      fill: false,
      hidden: true,
      tension: 0.18,
      spanGaps: false,
      pointRadius: rawData.map(v => v != null ? 2 : 0),
      pointHoverRadius: 5,
      borderWidth: 1.5,
    }];
  });
}

export function responseTimeTooltipLabel(item) {
  if (item.raw == null) {
    return item.dataset.label.endsWith(' raw')
      ? `${item.dataset.label}: failed`
      : `${item.dataset.label}: no successes`;
  }
  return `${item.dataset.label}: ${item.raw.toFixed(2)}s`;
}

export function animateCounter(el, target, duration = 1200, decimals = 0, suffix = '') {
  const start = performance.now();
  const update = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const val = target * ease;
    el.textContent = (decimals ? val.toFixed(decimals) : Math.round(val)) + suffix;
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

export function sparklineSVG(values, width = 80, height = 24, color = '#8bd11f') {
  const valid = values.filter(v => v !== null);
  if (valid.length < 2) return `<svg width="${width}" height="${height}"></svg>`;
  const min = Math.min(...valid), max = Math.max(...valid);
  const range = max - min || 1;
  const pts = [];
  let lastX = 0, lastY = 0;
  values.forEach((v, i) => {
    if (v === null) return;
    const x = (i / (values.length - 1)) * width;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    pts.push([x, y]);
    lastX = x; lastY = y;
  });
  if (pts.length < 2) return `<svg width="${width}" height="${height}"></svg>`;
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return `<svg width="${width}" height="${height}" style="overflow:visible"><path d="${d}" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.5" fill="${color}"/></svg>`;
}

export function renderMarkdown(text) {
  if (!text) return '';
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="lang-${lang}">${escHtml(code.trimEnd())}</code></pre>`;
  });
  text = text.replace(/`([^`]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`);
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const lines = text.split('\n');
  const out = [];
  let inPre = false;
  for (const line of lines) {
    if (line.startsWith('<pre>')) inPre = true;
    if (line.endsWith('</pre>')) { inPre = false; out.push(line); continue; }
    if (inPre) { out.push(line); continue; }
    if (line.trim() === '') { out.push(''); continue; }
    out.push(`<p>${line}</p>`);
  }
  return out.join('\n');
}

export function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
