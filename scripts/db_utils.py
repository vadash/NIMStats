"""Shared SQLite utilities for reading/writing benchmark history."""

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
HISTORY_DB = REPO_ROOT / "history.db"
RETENTION_DAYS = 14


def init_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp     TEXT    NOT NULL,
            prompt        TEXT,
            success_count INTEGER,
            total_models  INTEGER,
            fastest_model TEXT,
            fastest_time  INTEGER
        );
        CREATE TABLE IF NOT EXISTS model_results (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id           INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            model            TEXT    NOT NULL,
            success          INTEGER NOT NULL DEFAULT 0,
            error            TEXT,
            response_time    INTEGER,
            tokens_generated INTEGER,
            total_tokens     INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mr_run   ON model_results(run_id);
        CREATE INDEX IF NOT EXISTS idx_mr_model ON model_results(model);
        CREATE INDEX IF NOT EXISTS idx_runs_ts  ON runs(timestamp);
    """)


def write_run(run: dict[str, Any], db_path: Path = HISTORY_DB) -> None:
    """Insert a benchmark run and prune any runs older than RETENTION_DAYS."""
    summary = run.get("summary", {})
    conn = sqlite3.connect(str(db_path))
    try:
        init_schema(conn)
        cur = conn.execute(
            """INSERT INTO runs (timestamp, prompt, success_count, total_models, fastest_model, fastest_time)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                run.get("timestamp"),
                run.get("prompt"),
                summary.get("successCount"),
                summary.get("totalModels"),
                summary.get("fastestModel"),
                summary.get("fastestTime"),
            ),
        )
        run_id = cur.lastrowid
        conn.executemany(
            """INSERT INTO model_results
               (run_id, model, success, error, response_time, tokens_generated, total_tokens)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    run_id,
                    m.get("model"),
                    1 if m.get("success") else 0,
                    m.get("error"),
                    m.get("responseTime"),
                    m.get("tokensGenerated"),
                    m.get("totalTokens"),
                )
                for m in run.get("models", [])
            ],
        )
        # Age-based retention: drop runs whose timestamp predates the cutoff.
        # `runs.timestamp` is ISO-8601 UTC ("YYYY-MM-DDTHH:MM:SSZ"); Lexicographic
        # comparison against a cutoff of the same shape yields correct date math.
        reference_ts = run.get("timestamp") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            ref_dt = datetime.strptime(reference_ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            ref_dt = datetime.now(timezone.utc)
        cutoff = (ref_dt - timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute("DELETE FROM runs WHERE timestamp < ?", (cutoff,))
        # FK ON DELETE CASCADE already removes model_results; this orphan sweep
        # is a backstop in case cascade wasn't applied (e.g. rows predating FK).
        conn.execute(
            "DELETE FROM model_results WHERE run_id NOT IN (SELECT id FROM runs)"
        )
        conn.commit()
        conn.execute("VACUUM")
    finally:
        conn.close()
