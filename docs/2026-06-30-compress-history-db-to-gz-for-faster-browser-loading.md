## Plan: Compress `history.db` to `history.db.gz` for faster browser loading

**Current state:** `index.html` fetches `history.db` (240KB SQLite) and loads it into sql.js. The CI workflow commits `history.db` directly.

**Target state:** Store only `history.db.gz` (single gz file). Browser fetches it, decompresses with `DecompressionStream`, then loads into sql.js. CI generates the gz after writing the db.

### Changes:

1. **`index.html`** - Update the `fetch('history.db')` in `init()`:
   - Change fetch URL to `history.db.gz`
   - Add `DecompressionStream('gzip')` pipeline to decompress the response before passing to sql.js
   - Update error message text accordingly

2. **`.github/workflows/benchmark.yml`** - After `merge_results.py` writes `history.db`:
   - Add a step to gzip `history.db` → `history.db.gz`
   - Delete `history.db` (so only `.gz` is committed)
   - Update `git add` to track `history.db.gz` instead of `history.db`

3. **`.gitignore`** - Add `history.db` to gitignore (only `.gz` is stored)

4. **`scripts/db_utils.py`** - No changes needed (it writes `history.db` locally during CI, which gets gzipped afterward)

### Decompression approach:
Use the native browser `DecompressionStream` API (supported in all modern browsers) with a streaming pipeline:
```js
const res = await fetch('history.db.gz');
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const ds = new DecompressionStream('gzip');
const decompressed = res.body.pipeThrough(ds);
const buf = await new Response(decompressed).arrayBuffer();
```