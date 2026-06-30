# Localize All External CDN Dependencies

**Date:** 2026-06-30

## Problem
The app loads fonts (Inter, JetBrains Mono), Chart.js, and sql.js from external CDNs (Google Fonts, jsdelivr, cdnjs). ESM mirrors can be blocked, making the app non-functional in restricted networks.

## Solution
Vendor all external dependencies locally in `vendor/`, committed to the repo. Zero CDN requests at runtime.

### Changes
1. Created `vendor/` with:
   - `chart.umd.min.js` (Chart.js 4.4.0)
   - `sql-wasm.js` + `sql-wasm.wasm` (sql.js 1.10.3)
   - `fonts/fonts.css` + Inter & JetBrains Mono WOFF2 files
2. Removed `<link rel="preconnect">` hints from `index.html`
3. Replaced all CDN `<link>` and `<script>` URLs with local `vendor/` paths
4. Updated `js/app.js` `locateFile` to point to `vendor/` instead of cdnjs

### Before
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:..." rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js"></script>
```

### After
```html
<link rel="stylesheet" href="vendor/fonts/fonts.css">
<script src="vendor/chart.umd.min.js"></script>
<script src="vendor/sql-wasm.js"></script>
```

### Pre-commit hook
Added `scripts/pre-commit` that blocks commits containing CDN/ESM/Google external references in source files (excluding `vendor/`). The hook is committed and installed via `.git/hooks/pre-commit` which delegates to it. To install after a fresh clone: `cp scripts/pre-commit .git/hooks/pre-commit`
