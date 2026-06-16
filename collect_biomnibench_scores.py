#!/usr/bin/env python3
"""
collect_biomnibench_scores.py

Walk a runs directory produced by my_claude_biomnibench and emit a CSV summary:
  task_id, run_id, score, status, trace_bytes, answer_bytes, judge_result_path

Usage:
  python collect_biomnibench_scores.py /data/yjh/biomnibench-runs-v2 > scores.csv
"""
from __future__ import annotations

import csv
import json
import os
import sys
from glob import glob
from pathlib import Path


def find_judge_result(run_dir: Path) -> tuple[Path | None, dict]:
    """Look for the latest judge_result_round_N.json or judge_result_manual.json."""
    # Prefer the harness-produced result in .judge_private/<run_id>/
    runs_root = run_dir.parent
    run_id = run_dir.name
    judge_dir = runs_root / ".judge_private" / run_id
    candidates: list[Path] = []
    if judge_dir.exists():
        candidates.extend(sorted(judge_dir.glob("judge_result_round_*.json")))
    # Fall back to manual judge artifact placed under the run directory.
    manual = run_dir / "judge_result_manual.json"
    if manual.exists():
        candidates.append(manual)
    if not candidates:
        return None, {}
    latest = candidates[-1]
    try:
        with latest.open() as fh:
            return latest, json.load(fh)
    except Exception:
        return latest, {}


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: collect_biomnibench_scores.py <runs_dir>", file=sys.stderr)
        return 1
    runs_dir = Path(argv[1])
    if not runs_dir.is_dir():
        print(f"ERROR: runs_dir not a directory: {runs_dir}", file=sys.stderr)
        return 2

    writer = csv.writer(sys.stdout)
    writer.writerow(
        [
            "task_id",
            "run_id",
            "score",
            "trace_bytes",
            "answer_bytes",
            "judge_result_path",
        ]
    )

    for run_path in sorted(p for p in runs_dir.iterdir() if p.is_dir() and not p.name.startswith(".")):
        run_id = run_path.name
        # Task id is everything before the timestamp underscore.
        task_id = "_".join(run_id.split("_")[:-2]) if "_" in run_id else run_id
        outputs = run_path / "outputs"
        trace = outputs / "trace.md"
        answer = outputs / "answer.txt"
        trace_bytes = trace.stat().st_size if trace.exists() else 0
        answer_bytes = answer.stat().st_size if answer.exists() else 0

        judge_path, judge = find_judge_result(run_path)
        if isinstance(judge, dict):
            score = judge.get("total_score", judge.get("score", ""))
        else:
            score = ""
        writer.writerow(
            [
                task_id,
                run_id,
                score,
                trace_bytes,
                answer_bytes,
                str(judge_path) if judge_path else "",
            ]
        )

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
