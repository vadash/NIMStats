import { state } from './state.js';
import { loadFromDb, processData } from './data.js';
import { renderOverview } from './tabs/overview.js';
import { initLeaderboardSort } from './tabs/leaderboard.js';
import { populateExplorerSelect, renderExplorer } from './tabs/explorer.js';
import { renderTimeline } from './tabs/timeline.js';
import { populateCompareSelects, renderCompare } from './tabs/compare.js';
import { closeModal } from './modal.js';
import { switchTab } from './nav.js';

async function init() {
  try {
    const SQL = await initSqlJs({
      locateFile: file => `vendor/${file}`
    });

    const res = await fetch('history.db.gz');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ds = new DecompressionStream('gzip');
    const buf = await new Response(res.body.pipeThrough(ds)).arrayBuffer();
    state.db = new SQL.Database(new Uint8Array(buf));

    const data = loadFromDb(state.db);

    const processed = processData(data);
    state.runs = processed.runs;
    state.modelNames = processed.modelNames;
    state.modelStats = processed.modelStats;

    // Nav status
    document.getElementById('nav-status').textContent =
      `${state.runs.length} runs | ${state.modelNames.length} models`;

    // Populate selects
    populateExplorerSelect();
    populateCompareSelects();

    // Init leaderboard sort
    initLeaderboardSort();

    // Timeline filters
    document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.timelineFilter = btn.dataset.filter;
        renderTimeline();
      });
    });

    // Nav tabs
    document.querySelectorAll('.nav-tab[data-goto]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.goto));
    });

    // Modal controls
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
    document.getElementById('modal-copy').addEventListener('click', () => {
      navigator.clipboard?.writeText(state.modalResponse).then(() => {
        const btn = document.getElementById('modal-copy');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 1500);
      });
    });

    // Initial render
    renderOverview();

    // Show app
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').classList.add('visible');

  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').classList.add('visible');
    document.getElementById('error-state').style.display = 'flex';
    document.getElementById('error-msg').textContent = `Error: ${err.message}. Make sure history.db.gz exists and you're serving via HTTP.`;
    console.error('Failed to load data:', err);
  }
}

init();
