import { state } from './state.js';
import { renderOverview } from './tabs/overview.js';
import { renderLeaderboard } from './tabs/leaderboard.js';
import { renderExplorer } from './tabs/explorer.js';
import { renderTimeline } from './tabs/timeline.js';
import { renderCompare } from './tabs/compare.js';

export function switchTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll('section[data-tab]').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`section[data-tab="${tabName}"]`)?.classList.add('active');
  document.querySelector(`.nav-tab[data-goto="${tabName}"]`)?.classList.add('active');

  if (tabName === 'overview') renderOverview();
  if (tabName === 'leaderboard') renderLeaderboard();
  if (tabName === 'explorer') renderExplorer();
  if (tabName === 'timeline') renderTimeline();
  if (tabName === 'compare') renderCompare();
}
