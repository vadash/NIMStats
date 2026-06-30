# Split index.html into modular files

## Problem
`index.html` grew to 86KB (1872 lines) mixing CSS, HTML structure, and JS logic in a single file.

## Solution
Split into separate CSS and JS files using native ES modules. No build step required; works directly with GitHub Pages.

## File structure
```
styles.css                  - All CSS (root vars, components, responsive, utilities)
js/constants.js             - PROVIDER_META, MODEL_PALETTE, CHART_DEFAULTS, CN_PEAK config, cnPeakOverlayPlugin
js/state.js                 - Shared mutable state object
js/helpers.js               - Utility functions (avg, fmtMs, providerMeta, sparklineSVG, renderMarkdown, etc.)
js/data.js                  - loadFromDb(), processData(), computeHourlyStats(), computeBestTimeslots()
js/charts.js                - renderBestTimeslot(), destroyChart(), modelColor()
js/tabs/overview.js         - renderOverview(), KPIs, top-10 charts, reliability
js/tabs/leaderboard.js      - renderLeaderboard(), renderLbTable(), initLeaderboardSort()
js/tabs/explorer.js         - populateExplorerSelect(), renderExplorer(), heatmap, run table
js/tabs/timeline.js         - renderTimeline(), filter logic
js/tabs/compare.js          - populateCompareSelects(), renderCompare(), H2H table, overlay/win charts
js/modal.js                 - openModal(), closeModal()
js/nav.js                   - switchTab()
js/app.js                   - init(), event wiring, entry point
index.html                  - HTML structure + <link> + <script type="module">
```

## Key decisions
- **ES Modules**: `<script type="module" src="js/app.js">`. Clean import/export. GitHub Pages serves .js with correct MIME type.
- **CDN scripts** (Chart.js, sql-wasm.js): Remain as global `<script>` tags in `<head>`. Modules reference the globals (`Chart`, `initSqlJs`).
- **State sharing**: `js/state.js` exports a mutable object; all modules import and mutate it.
- **No bundler/transpiler**: Pure browser-native ES modules.
