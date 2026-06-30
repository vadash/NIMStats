#!/usr/bin/env python3
"""Merge parallel worker results and append a single run to history.db."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from db_utils import write_run  # noqa: E402

SCRIPT_DIR = Path(__file__).resolve().parent


def main() -> int:
    all_models: list[dict] = []
    timestamp: str | None = None
    prompt: str | None = None
    worker_files = sorted(SCRIPT_DIR.glob("results-worker*.json"))

    if not worker_files:
        print("No worker result files found!", file=sys.stderr)
        return 1

    for path in worker_files:
        with open(path) as f:
            data = json.load(f)
        all_models.extend(data.get("models", []))
        if not timestamp:
            timestamp = data.get("timestamp")
            prompt = data.get("prompt")

    if not all_models:
        print("No model results found in worker files!", file=sys.stderr)
        return 1

    success_count = sum(1 for m in all_models if m.get("success"))
    total_count = len(all_models)
    fastest_model = "N/A"
    fastest_time = 0

    successful = [m for m in all_models if m.get("success")]
    if successful:
        fastest = min(successful, key=lambda x: x.get("responseTime") or float("inf"))
        fastest_model = fastest.get("model", "N/A")
        fastest_time = fastest.get("responseTime", 0) or 0

    merged_run = {
        "timestamp": timestamp,
        "prompt": prompt,
        "models": all_models,
        "summary": {
            "successCount": success_count,
            "totalModels": total_count,
            "fastestModel": fastest_model,
            "fastestTime": fastest_time,
        },
    }

    write_run(merged_run)
    print(f"Updated history.db with new run ({success_count}/{total_count} models passed)")

    for path in worker_files:
        path.unlink()
    print("Cleaned up temporary worker files")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
