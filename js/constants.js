export const PROVIDER_META = {
  'deepseek-ai': { name: 'DeepSeek', color: '#4d9de0' },
  'z-ai':        { name: 'Z-AI',     color: '#11a883' },
  'minimaxai':   { name: 'MiniMax',  color: '#7c3aed' },
  'nvidia':      { name: 'NVIDIA',   color: '#8bd11f' },
  'moonshotai':  { name: 'Moonshot', color: '#0891b2' },
  'openai':      { name: 'OpenAI',   color: '#2563eb' },
  'google':      { name: 'Google',   color: '#ea4335' },
  'qwen':        { name: 'Qwen',     color: '#d97706' },
  'mistralai':   { name: 'Mistral',  color: '#7e22ce' },
  'meta':        { name: 'Meta',     color: '#1877f2' },
};

export const MODEL_PALETTE = [
  '#8bd11f','#5ca7f2','#e07a46','#6d5bd0','#60d985',
  '#f2b84b','#b13570','#007c89','#6a8f00','#3d66d6',
  '#13856b','#3f6f95','#ff6f61','#7650a8','#0c8374',
  '#b99b2d','#b17ab0','#d07a3a','#d34a65','#8a9584'
];

// Best Timeslot picker — shared localStorage key + default list length.
export const TS_MODELS_KEY = 'nimstats:timeslot-models';
export const TS_TOP = 10;

export const CHART_DEFAULTS = {
  tooltip: {
    backgroundColor: '#151713',
    borderColor: '#46533e',
    borderWidth: 1,
    titleColor: '#f5f8ef',
    bodyColor: '#c7d1bf',
    padding: 12,
    cornerRadius: 8,
    displayColors: true
  }
};

export const CN_PEAK_UTC_WINDOWS = [
  { start: 1, end: 4 },
  { start: 6, end: 10 }
];

export const EU_NA_PEAK_UTC_WINDOWS = [
  { start: 12, end: 15 }
];

export function wrapHour(hour) {
  return ((hour % 24) + 24) % 24;
}

export function getPeakReferenceDate(runs) {
  const latestRun = runs[runs.length - 1];
  const latestDate = latestRun?.timestamp ? new Date(latestRun.timestamp) : null;
  return latestDate && !Number.isNaN(latestDate.getTime()) ? latestDate : new Date();
}

export function utcBoundaryToLocalHour(utcHour, referenceDate) {
  const utcMidnight = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  );
  const localDate = new Date(utcMidnight + utcHour * 60 * 60 * 1000);
  return localDate.getHours() + (localDate.getMinutes() / 60);
}

export function formatHourBoundary(hour) {
  const totalMinutes = Math.round(wrapHour(hour) * 60) % (24 * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function splitHourWindow(start, end) {
  const s = wrapHour(start);
  const e = wrapHour(end);
  if (Math.abs(s - e) < 0.001) return [{ start: 0, end: 24 }];
  return e > s ? [{ start: s, end: e }] : [{ start: s, end: 24 }, { start: 0, end: e }];
}

export function getCnPeakLocalWindows(runs) {
  const referenceDate = getPeakReferenceDate(runs);
  return CN_PEAK_UTC_WINDOWS.map(w => {
    const localStart = utcBoundaryToLocalHour(w.start, referenceDate);
    const localEnd = utcBoundaryToLocalHour(w.end, referenceDate);
    const localLabel = `${formatHourBoundary(localStart)}-${formatHourBoundary(localEnd)}`;
    const utcLabel = `${formatHourBoundary(w.start)}-${formatHourBoundary(w.end)} UTC`;
    return { ...w, localStart, localEnd, localLabel, utcLabel };
  });
}

export function cnPeakWindowsForHour(hour, windows) {
  return windows.filter(w => splitHourWindow(w.localStart, w.localEnd).some(seg =>
    seg.start < hour + 1 && seg.end > hour
  ));
}

export function getEuNaPeakLocalWindows(runs) {
  const referenceDate = getPeakReferenceDate(runs);
  return EU_NA_PEAK_UTC_WINDOWS.map(w => {
    const localStart = utcBoundaryToLocalHour(w.start, referenceDate);
    const localEnd = utcBoundaryToLocalHour(w.end, referenceDate);
    const localLabel = `${formatHourBoundary(localStart)}-${formatHourBoundary(localEnd)}`;
    const utcLabel = `${formatHourBoundary(w.start)}-${formatHourBoundary(w.end)} UTC`;
    return { ...w, localStart, localEnd, localLabel, utcLabel };
  });
}

export function euNaPeakWindowsForHour(hour, windows) {
  return windows.filter(w => splitHourWindow(w.localStart, w.localEnd).some(seg =>
    seg.start < hour + 1 && seg.end > hour
  ));
}

export const euNaPeakOverlayPlugin = {
  id: 'euNaPeakOverlay',
  beforeDatasetsDraw(chart, args, options) {
    const windows = options?.windows || [];
    const { ctx, chartArea } = chart;
    if (!windows.length || !chartArea) return;

    const width = chartArea.right - chartArea.left;
    ctx.save();
    for (const w of windows) {
      for (const seg of splitHourWindow(w.localStart, w.localEnd)) {
        const left = chartArea.left + (seg.start / 24) * width;
        const right = chartArea.left + (seg.end / 24) * width;
        ctx.fillStyle = 'rgba(96,167,242,0.09)';
        ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
        ctx.strokeStyle = 'rgba(96,167,242,0.48)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(left, chartArea.top);
        ctx.lineTo(left, chartArea.bottom);
        ctx.moveTo(right, chartArea.top);
        ctx.lineTo(right, chartArea.bottom);
        ctx.stroke();
      }
    }
    ctx.restore();
  },
  afterDatasetsDraw(chart, args, options) {
    const windows = options?.windows || [];
    const { ctx, chartArea } = chart;
    if (!windows.length || !chartArea) return;

    const width = chartArea.right - chartArea.left;
    ctx.save();
    ctx.font = '700 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const w of windows) {
      for (const seg of splitHourWindow(w.localStart, w.localEnd)) {
        const left = chartArea.left + (seg.start / 24) * width;
        const right = chartArea.left + (seg.end / 24) * width;
        const segWidth = right - left;
        ctx.strokeStyle = 'rgba(96,167,242,0.75)';
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(left, chartArea.top + 1);
        ctx.lineTo(right, chartArea.top + 1);
        ctx.stroke();
        if (segWidth >= 32) {
          ctx.fillStyle = 'rgba(96,167,242,0.92)';
          ctx.fillText(segWidth >= 54 ? 'EU+NA PEAK' : 'EU+NA', left + segWidth / 2, chartArea.top + 5);
        }
      }
    }
    ctx.restore();
  }
};

export const cnPeakOverlayPlugin = {
  id: 'cnPeakOverlay',
  beforeDatasetsDraw(chart, args, options) {
    const windows = options?.windows || [];
    const { ctx, chartArea } = chart;
    if (!windows.length || !chartArea) return;

    const width = chartArea.right - chartArea.left;
    ctx.save();
    for (const w of windows) {
      for (const seg of splitHourWindow(w.localStart, w.localEnd)) {
        const left = chartArea.left + (seg.start / 24) * width;
        const right = chartArea.left + (seg.end / 24) * width;
        ctx.fillStyle = 'rgba(242,184,75,0.09)';
        ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
        ctx.strokeStyle = 'rgba(242,184,75,0.48)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(left, chartArea.top);
        ctx.lineTo(left, chartArea.bottom);
        ctx.moveTo(right, chartArea.top);
        ctx.lineTo(right, chartArea.bottom);
        ctx.stroke();
      }
    }
    ctx.restore();
  },
  afterDatasetsDraw(chart, args, options) {
    const windows = options?.windows || [];
    const { ctx, chartArea } = chart;
    if (!windows.length || !chartArea) return;

    const width = chartArea.right - chartArea.left;
    ctx.save();
    ctx.font = '700 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const w of windows) {
      for (const seg of splitHourWindow(w.localStart, w.localEnd)) {
        const left = chartArea.left + (seg.start / 24) * width;
        const right = chartArea.left + (seg.end / 24) * width;
        const segWidth = right - left;
        ctx.strokeStyle = 'rgba(242,184,75,0.75)';
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(left, chartArea.top + 1);
        ctx.lineTo(right, chartArea.top + 1);
        ctx.stroke();
        if (segWidth >= 32) {
          ctx.fillStyle = 'rgba(242,184,75,0.92)';
          ctx.fillText(segWidth >= 54 ? 'CN PEAK' : 'CN', left + segWidth / 2, chartArea.top + 5);
        }
      }
    }
    ctx.restore();
  }
};

export const currentTimeLinePlugin = {
  id: 'currentTimeLine',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;

    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;
    const x = scales.x.getPixelForValue(Math.floor(currentHour));

    ctx.save();
    ctx.strokeStyle = 'rgba(139,209,31,0.65)';
    ctx.setLineDash([6, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();

    ctx.fillStyle = 'rgba(139,209,31,0.9)';
    ctx.font = '700 9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('NOW', x, chartArea.top - 4);
    ctx.restore();
  }
};
