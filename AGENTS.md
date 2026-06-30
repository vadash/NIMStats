# Repository Guidelines

## Project Structure & Module Organization

NIMStats is a static-site dashboard for benchmarking NVIDIA NIM models. No build step; everything runs directly in the browser.

```
index.html          — App shell (nav, sections, modal)
styles.css          — All CSS (dark theme, CSS custom properties)
js/
  app.js            — Entry point: loads sql.js DB, wires events
  state.js          — Global reactive state object
  constants.js      — Provider metadata, chart config, time helpers
  data.js           — DB queries, data processing
  helpers.js        — Formatting utilities
  charts.js         — Chart.js chart factory functions
  nav.js            — Tab switching
  modal.js          — Response viewer modal
  tabs/             — Per-tab render modules (overview, leaderboard, explorer, timeline, compare)
scripts/
  test_models.py    — Benchmark runner (calls NIM API, writes results)
  db_utils.py       — SQLite read/write utilities for history.db
  merge_results.py  — Merges parallel worker JSON into single DB run
  benchmark_dispatch.sh — Dynamic parallel dispatch of models
  pre-commit        — Git hook: blocks CDN/external URL references
vendor/             — Bundled deps (Chart.js, sql.js WASM, fonts)
docs/               — Feature design documents (date-prefixed)
```

Data flow: GitHub Actions runs `benchmark_dispatch.sh` → `test_models.py` per model → `merge_results.py` writes `history.db` → `gzip` → committed as `history.db.gz` → browser loads and queries it client-side via sql.js.

## Build, Test, and Development Commands

```bash
# Serve dashboard locally
python3 -m http.server 8000          # Open http://localhost:8000

# Run benchmarks manually (requires NIM_API_KEY)
NIM_API_KEY=your_key python3 scripts/test_models.py

# Run single model by index
NIM_API_KEY=your_key MODEL_INDEX=0 python3 scripts/test_models.py

# Run all models in parallel (2 workers)
NIM_API_KEY=your_key PARALLEL=2 bash scripts/benchmark_dispatch.sh

# Merge worker results after parallel run
python3 scripts/merge_results.py

# Pre-commit hook (blocks external CDN refs)
bash scripts/pre-commit
```

There is no test framework. The Python scripts are the only server-side code; the frontend is untested beyond manual review.

## Coding Style & Naming Conventions

- **JavaScript**: ES modules (`import`/`export`), 2-space indent, camelCase for variables/functions, PascalCase not used (no classes). String literals prefer single quotes.
- **CSS**: CSS custom properties in `:root`, kebab-case class names, compact one-liner resets, dark theme with green accent (`#8bd11f`).
- **Python**: Python 3.10+ syntax (`list[str]`, `dict[str, Any]`), type hints on function signatures, double-quote strings, `pathlib.Path` for file paths.
- **Shell**: `set -euo pipefail`, bash-specific features (assoc arrays), snake_case for variables.

Pre-commit hook enforces **no external CDN/ESM references** in source files. All dependencies must be vendored locally under `vendor/`.

## Commit & Pull Request Guidelines

Commit messages follow conventional prefixes visible in git history:

- `Update benchmark results` — automated CI commits
- `feat: add amazing feature` — new features
- Use imperative mood, lowercase after the prefix

Benchmarks are triggered via `workflow_dispatch` on GitHub Actions. CI auto-commits updated `history.db.gz` with the standard message above.

For PRs: fork, create a `feat/` or `fix/` branch, and open against `main`. Include a clear description of what changed and why.

## Architecture Overview

The dashboard is a vanilla JS single-page app with five tabs (Overview, Leaderboard, Explorer, Timeline, Compare). It loads a gzipped SQLite database client-side via WebAssembly (sql.js) and queries it for all chart data. Chart.js renders all visualizations. No framework, no bundler, no package.json.

The benchmark pipeline is Python + bash, running on GitHub Actions. It dynamically dispatches models across parallel workers, collects per-worker JSON results, merges them, and writes a single run row into `history.db`. The database is capped at 30 days of hourly runs (~1440 rows) and auto-pruned on each write.
