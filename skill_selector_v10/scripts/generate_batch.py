#!/usr/bin/env python3
"""
Generate a batch run script (bash) for targeted V10 experiments.

This script generates a standalone bash script that can be uploaded to
the server and run independently. Useful for running specific pairs
without needing the Python package on the server.

Usage:
    python3 scripts/generate_batch.py --output run_batch.sh

    # Then upload and run on server:
    # scp run_batch.sh server1:/tmp/ && ssh server1 "bash /tmp/run_batch.sh"
"""

import argparse
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skill_selector_v10.config import V10Config


def generate_batch_script(
    pairs: list,
    output_path: str,
    batch_name: str = "v10_batch",
):
    """Generate a standalone bash script for a batch of experiments.

    Args:
        pairs: List of (source, target) tuples.
        output_path: Where to write the bash script.
        batch_name: Name for the batch (used in log dir).
    """
    cfg = V10Config()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    lines = []
    lines.append("#!/bin/bash")
    lines.append(f"# V10 Batch Experiment Script — generated {datetime.now().isoformat()}")
    lines.append(f"# Batch: {batch_name}")
    lines.append(f"# Pairs: {len(pairs)}")
    lines.append("")
    lines.append("# Config")
    lines.append(f'HARNESS_DIR="{cfg.harness_dir}"')
    lines.append(f'TASKS_DIR="{cfg.bio_dir}"')
    lines.append(f'TRANSFER_DIR="{cfg.transfer_dir}"')
    lines.append(f'SKILLS_BASE="{cfg.skills_dir}"')
    lines.append(f'GENERALIZED_SKILLS="{cfg.generalized_skills_dir}"')
    lines.append(f'BUN_BIN="{cfg.bun_bin}"')
    lines.append(f'MAX_ROUNDS={cfg.max_rounds}')
    lines.append(f'TIMEOUT_SECONDS={cfg.timeout_seconds}')
    lines.append("")
    lines.append("# API Config")
    lines.append(f'export ANTHROPIC_API_KEY="{cfg.anthropic_api_key}"')
    lines.append(f'export ANTHROPIC_BASE_URL="{cfg.anthropic_base_url}"')
    lines.append(f'export ANTHROPIC_MODEL="{cfg.worker_model}"')
    lines.append(f'export QWEN_API_KEY="{cfg.qwen_api_key}"')
    lines.append(f'export QWEN_BASE_URL="{cfg.qwen_base_url}"')
    lines.append(f'export QWEN_MODEL="{cfg.judge_model}"')
    lines.append("")
    lines.append(f'LOG_DIR="{cfg.remote_base}/logs/{batch_name}_{timestamp}"')
    lines.append("mkdir -p \"$LOG_DIR\"")
    lines.append("")
    lines.append(f'echo "=============================================="')
    lines.append(f'echo "V10 Batch: {batch_name}"')
    lines.append(f'echo "Pairs: {len(pairs)}"')
    lines.append(f'echo "Log dir: $LOG_DIR"')
    lines.append(f'echo "=============================================="')
    lines.append("")

    for i, (source, target) in enumerate(pairs):
        skill_name = f"v10-{batch_name}-{source}"
        ts = f"v10_{batch_name}_{i+1:03d}_{target}_{timestamp}"
        log_file = f"$LOG_DIR/{i+1:03d}_{target}_from_{source}.log"
        skills_dir = f"$SKILLS_BASE/{target}/skills"

        lines.append(f"# === [{i+1}/{len(pairs)}] {source} -> {target} ===")
        lines.append(f"echo \"[{i+1}/{len(pairs)}] Deploying: {source} -> {target}\"")
        lines.append(f"mkdir -p {skills_dir}")
        lines.append(f"rm -rf {skills_dir}/{skill_name}")
        lines.append(f"ln -s $GENERALIZED_SKILLS/{source} {skills_dir}/{skill_name}")
        lines.append("")
        lines.append(f"echo \"[{i+1}/{len(pairs)}] Running: {target} <- {source}\"")
        lines.append("(")
        lines.append(f"  cd $HARNESS_DIR")
        lines.append(f"  $BUN_BIN src/harness/evaluation/cli.ts \\")
        lines.append(f"    --task {target} \\")
        lines.append(f"    --tasks-dir $TASKS_DIR \\")
        lines.append(f"    --runs-dir $TRANSFER_DIR \\")
        lines.append(f"    --max-rounds $MAX_ROUNDS \\")
        lines.append(f"    --timeout-seconds $TIMEOUT_SECONDS \\")
        lines.append(f"    --concurrency 1 --temperature 1 --thinking disabled \\")
        lines.append(f'    --timestamp "{ts}" --quiet \\')
        lines.append(f"    --enable-skills \\")
        lines.append(f"    --skills-dir {skills_dir} \\")
        lines.append(f"    --skill-name {skill_name} \\")
        lines.append(f"    --max-active-skills 1")
        lines.append(f") > {log_file} 2>&1")
        lines.append(f"echo \"  DONE $?\"")
        lines.append("")

    lines.append(f'echo "=============================================="')
    lines.append(f'echo "All {len(pairs)} experiments complete!"')
    lines.append(f'echo "Logs: $LOG_DIR"')
    lines.append(f'echo "=============================================="')

    script = "\n".join(lines) + "\n"

    with open(output_path, "w") as f:
        f.write(script)

    os.chmod(output_path, 0o755)
    print(f"Batch script written to {output_path} ({len(pairs)} pairs)")
    return output_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate V10 batch run script")
    parser.add_argument("--output", "-o", default="run_v10_batch.sh", help="Output script path")
    parser.add_argument("--pairs", "-p", nargs="+", action="append", metavar=("SOURCE", "TARGET"),
                        help="Add a pair: -p da-18-1 da-25-1")
    parser.add_argument("--name", default="v10_batch", help="Batch name (for log dir)")
    args = parser.parse_args()

    if args.pairs:
        pairs = [(p[0], p[1]) for p in args.pairs if len(p) >= 2]
    else:
        # Default: the 23 pairs from V10 validation (for reproducibility)
        pairs = [
            ("da-18-5", "da-25-1"),
            ("da-18-1", "da-25-1"),
            ("da-20-3", "da-20-4"),
            ("da-13-5", "da-13-6"),
            ("da-19-3", "da-8-3"),
            ("da-13-1", "da-8-3"),
            ("da-15-1", "da-8-3"),
            ("da-19-1", "da-8-3"),
            ("da-4-6", "da-9-1"),
            ("da-6-2", "da-9-1"),
            ("da-19-4", "da-19-6"),
            ("da-19-3", "da-19-6"),
            ("da-26-2", "da-26-4"),
            ("da-5-1", "da-15-8"),
            ("da-14-3", "da-15-7"),
            ("da-8-1", "da-15-7"),
            ("da-8-2", "da-15-7"),
            ("da-26-2", "da-10-1"),
            ("da-20-3", "da-12-2"),
            ("da-18-1", "da-4-7"),
            ("da-13-3", "da-24-3"),
            ("da-14-3", "da-24-3"),
            ("da-8-1", "da-24-3"),
        ]

    generate_batch_script(pairs, args.output, args.name)