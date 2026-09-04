#!/usr/bin/env python3
"""
V10 Experiment Runner — Run SmartSelectorV10 selected transfers.

This script runs on the SERVER (not locally). Upload it to the server
and execute with:

    python3 scripts/run_experiments.py [--dry-run] [--print-selections]

Arguments:
    --dry-run         Only print what would be done, don't run anything
    --print-selections  Print V10 selection results for all targets and exit
    --target TASK     Only run for a specific target task (repeatable)
    --source TASK     Only use a specific source skill (repeatable)
"""

import argparse
import json
import os
import sys
import time

# Add parent dir to path so we can import skill_selector_v10
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from skill_selector_v10 import SmartSelectorV10, V10Config
from skill_selector_v10.tools import (
    deploy_skill,
    run_evaluation,
    collect_result,
    discover_skills,
)


def print_selections(cfg: V10Config, target_filter=None, source_filter=None, remote=True):
    """Print V10 selection results for all targets."""
    print("=" * 70)
    print("  SmartSelectorV10 — Selection Results")
    print("=" * 70)

    selector = SmartSelectorV10(cfg=cfg, verbose=True)
    selector.load(remote=remote)

    available = discover_skills(cfg, remote=remote)
    if source_filter:
        available = {k: v for k, v in available.items() if k in source_filter}

    results = []
    for target in sorted(selector.data.baselines.keys()):
        if target_filter and target not in target_filter:
            continue
        source, score = selector.select_skill(target, available)
        bl = selector.data.baselines.get(target, 0.5)
        src_type = selector.data.task_types.get(target, "?")
        results.append((target, source, score, bl, src_type))

    print(f"\n{'Target':<15} {'Source':<15} {'Score':<8} {'BL':<6} {'Type':<25} {'Tier':<12}")
    print("-" * 85)
    for target, source, score, bl, src_type in results:
        if source:
            tier, _, _ = selector._compatibility_info(source, target)
            src_t = selector.data.task_types.get(source, "?")
            source_str = f"{source}({src_t})"
            score_str = f"{score:+.4f}"
        else:
            tier = "NONE"
            source_str = "(none)"
            score_str = "N/A"
        print(f"{target:<15} {source_str:<15} {score_str:<8} {bl:.3f}  {src_type:<25} {tier:<12}")

    # Summary
    total = len(results)
    selected = sum(1 for _, s, _, _, _ in results if s)
    print(f"\nSummary: {selected}/{total} targets get a skill recommendation")


def run_experiments(
    cfg: V10Config,
    target_filter=None,
    source_filter=None,
    dry_run: bool = False,
    remote: bool = True,
):
    """Run V10-selected transfer experiments."""
    print("=" * 70)
    print("  SmartSelectorV10 — Experiment Runner")
    print("=" * 70)

    # Load selector
    selector = SmartSelectorV10(cfg=cfg, verbose=True)
    selector.load(remote=remote)

    # Discover available skills
    available = discover_skills(cfg, remote=remote)
    if source_filter:
        available = {k: v for k, v in available.items() if k in source_filter}
    print(f"\nAvailable skills: {len(available)}")

    # Select skills for each target
    experiments = []
    for target in sorted(selector.data.baselines.keys()):
        if target_filter and target not in target_filter:
            continue
        source, score = selector.select_skill(target, available)
        if source:
            experiments.append((target, source, score))

    print(f"\nSelected {len(experiments)} experiments:")
    for target, source, score in experiments:
        bl = selector.data.baselines.get(target, 0.5)
        tier, bonus, thresh = selector._compatibility_info(source, target)
        print(f"  {target} ← {source} [bl={bl:.3f}, score={score:.4f}, tier={tier}]")

    if dry_run:
        print("\n[Dry run] Would execute the above experiments. Exiting.")
        return

    if not experiments:
        print("\nNo experiments to run. Exiting.")
        return

    # Run experiments sequentially
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    log_dir = f"{cfg.remote_base}/logs/v10_batch_{timestamp}"
    os.makedirs(log_dir, exist_ok=True)

    results = []
    for i, (target, source, score) in enumerate(experiments):
        print(f"\n{'='*60}")
        print(f"  [{i+1}/{len(experiments)}] {target} ← {source}")
        print(f"{'='*60}")

        ts = f"v10_batch_{i+1:03d}_{target}_{timestamp}"

        # Deploy skill
        skill_name = deploy_skill(source, target, cfg=cfg)

        # Run evaluation
        start = time.time()
        rc, stdout = run_evaluation(target, skill_name, ts, cfg)
        elapsed = time.time() - start

        # Save log
        log_file = f"{log_dir}/{i+1:03d}_{target}_from_{source}.log"
        with open(log_file, "w") as f:
            f.write(f"CMD: {ts}\n\nSTDOUT:\n{stdout}\n")

        # Collect result
        result = collect_result(target, ts, cfg)
        reward = result["reward"] if result else None
        bl = selector.data.baselines.get(target, 0.5)

        delta = reward - bl if reward is not None else None
        delta_str = f"{delta:+.3f}" if delta is not None else "N/A"
        print(f"  DONE in {elapsed:.0f}s exit={rc} Reward={reward} Delta={delta_str}")

        results.append({
            "target": target,
            "source": source,
            "reward": reward,
            "baseline": bl,
            "delta": delta,
            "elapsed_seconds": elapsed,
            "returncode": rc,
            "log_file": log_file,
        })

    # Summary
    print(f"\n{'='*60}")
    print(f"  All {len(results)} experiments complete!")
    print(f"  Logs: {log_dir}")
    print(f"{'='*60}")

    positives = sum(1 for r in results if r["delta"] and r["delta"] > 0)
    non_negatives = sum(1 for r in results if r["delta"] is not None and r["delta"] >= 0)
    total_delta = sum(r["delta"] for r in results if r["delta"] is not None)

    print(f"\n{'Target':<15} {'Source':<15} {'BL':<6} {'Reward':<8} {'Delta':<8} {'Status':<8}")
    print("-" * 65)
    for r in results:
        d = r["delta"]
        status = "✅" if d and d > 0 else ("⚪" if d is not None and d >= 0 else "❌")
        d_str = f"{d:+.3f}" if d is not None else "N/A"
        r_str = f"{r['reward']:.3f}" if r["reward"] else "N/A"
        print(f"{r['target']:<15} {r['source']:<15} {r['baseline']:.3f}  {r_str:<8} {d_str:<8} {status:<8}")
    print(f"\nTotal: {positives}/{len(results)} positive, {non_negatives}/{len(results)} non-negative")
    print(f"Total delta: {total_delta:+.3f}")

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="V10 Experiment Runner")
    parser.add_argument("--dry-run", action="store_true", help="Only print what would be done")
    parser.add_argument("--print-selections", action="store_true",
                        help="Print V10 selection results and exit")
    parser.add_argument("--target", action="append", dest="targets", help="Only run for specific target")
    parser.add_argument("--source", action="append", dest="sources", help="Only use specific source")
    parser.add_argument("--local", action="store_true", help="Run locally (no SSH)")
    args = parser.parse_args()

    cfg = V10Config()
    is_remote = not args.local

    if args.print_selections:
        print_selections(cfg, args.targets, args.sources, remote=is_remote)
    else:
        run_experiments(cfg, args.targets, args.sources, args.dry_run, remote=is_remote)