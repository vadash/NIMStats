import { state } from '../state.js';
import { shortModel, providerChip, fmtTimestamp, escHtml } from '../helpers.js';

export function renderTimeline() {
  const { runs } = state;
  const filter = state.timelineFilter;
  const now = new Date(runs[runs.length - 1]?.timestamp || Date.now());

  let filtered = [...runs].reverse();
  if (filter === '24h') {
    const cutoff = new Date(now); cutoff.setHours(cutoff.getHours() - 24);
    filtered = filtered.filter(r => new Date(r.timestamp) >= cutoff);
  } else if (filter === '48h') {
    const cutoff = new Date(now); cutoff.setHours(cutoff.getHours() - 48);
    filtered = filtered.filter(r => new Date(r.timestamp) >= cutoff);
  } else if (filter === '7d') {
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 7);
    filtered = filtered.filter(r => new Date(r.timestamp) >= cutoff);
  }

  document.getElementById('timeline-badge').textContent = `${filtered.length} runs`;

  const container = document.getElementById('run-cards');
  container.innerHTML = filtered.map((run) => {
    const total = run.summary?.totalModels || run.models.length;
    const succ = run.summary?.successCount ?? run.models.filter(m => m.success).length;
    const pct = succ / total;
    const badgeCls = pct >= 0.6 ? 'green' : pct >= 0.4 ? 'yellow' : 'red';
    const fastest = run.summary?.fastestModel ? shortModel(run.summary.fastestModel) : '--';
    const fastestTime = run.summary?.fastestTime ? (run.summary.fastestTime/1000).toFixed(2)+'s' : '';

    return `<div class="run-card" data-run-idx="">
      <div class="run-card-header">
        <span class="run-card-time">${fmtTimestamp(run.timestamp)}</span>
        <span class="run-success-badge ${badgeCls}">${succ}/${total}</span>
        <span class="run-fastest"><span>${fastest}</span>${fastestTime ? ' | '+fastestTime : ''}</span>
        <span class="run-expand-arrow">v</span>
      </div>
      <div class="run-card-body">
        <div class="run-prompt">Prompt: ${escHtml(run.prompt||'')}</div>
        <table class="run-detail-table">
          <thead><tr><th>Model</th><th>Status</th><th>Response Time</th><th>Tok/s</th><th>Error</th></tr></thead>
          <tbody>${run.models.map(m => {
            const tps = (m.success && m.responseTime > 0) ? (m.tokensGenerated / (m.responseTime / 1000)).toFixed(1) : null;
            const cls = m.success ? 'text-green' : 'text-red';
            return `<tr>
              <td>${providerChip(m.model, true)}<span style="font-size:12px">${shortModel(m.model)}</span></td>
              <td><span class="${cls}" style="font-size:12px;font-weight:600">${m.success ? 'OK' : 'Fail'}</span></td>
              <td class="mono">${m.success && m.responseTime ? (m.responseTime/1000).toFixed(2)+'s' : '--'}</td>
              <td class="mono">${tps ? tps+' t/s' : '--'}</td>
              <td style="font-size:11px;color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.error ? escHtml(m.error) : ''}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.run-card').forEach(card => {
    card.querySelector('.run-card-header').addEventListener('click', () => {
      card.classList.toggle('expanded');
    });
  });
}
