"""
Tools and utilities for running V10-selected transfer experiments.

Provides:
- deploy_skill(): copy a generalized skill to a target's skills directory
- run_evaluation(): execute the bun CLI harness on a target task
- collect_result(): parse run_summary.json for reward / delta
- run_experiment(): full end-to-end (select + deploy + evaluate + collect)
"""

import json
import os
import subprocess
import time
from typing import Dict, Optional, Tuple

from .config import DEFAULT_CONFIG, V10Config


def discover_skills(cfg: V10Config = None, remote: bool = True) -> Dict[str, str]:
    """Discover all available generalized skills.

    Args:
        cfg: Config with server paths.
        remote: If True, use SSH to discover on remote server.
                If False, use local filesystem (for server-side execution).

    Returns:
        Dict mapping source_task_id -> path to SKILL.md
    """
    cfg = cfg or DEFAULT_CONFIG
    skills = {}

    if remote:
        result = subprocess.run(
            [
                "ssh", cfg.ssh_host, "-o", "StrictHostKeyChecking=no",
                "-o", "ConnectTimeout=10",
                f"for d in {cfg.generalized_skills_dir}/*/; do "
                f"  task=$(basename $d); "
                f"  if [ -f \"{cfg.generalized_skills_dir}/$task/SKILL.md\" ]; then "
                f"    echo \"$task\"; "
                f"  fi; "
                f"done"
            ],
            capture_output=True, text=True, timeout=30,
        )
        for line in result.stdout.strip().split("\n"):
            line = line.strip()
            if line:
                skills[line] = f"{cfg.generalized_skills_dir}/{line}/SKILL.md"
    else:
        base = cfg.generalized_skills_dir
        if os.path.isdir(base):
            for d in sorted(os.listdir(base)):
                dpath = os.path.join(base, d)
                skill_file = os.path.join(dpath, "SKILL.md")
                if os.path.isdir(dpath) and os.path.isfile(skill_file):
                    skills[d] = skill_file

    return skills


def deploy_skill(
    source_task: str,
    target_task: str,
    skill_name: str = "v10-selector",
    cfg: V10Config = None,
) -> str:
    """Deploy a skill from source to target via symlink (fast).

    Args:
        source_task: Source task ID with the generalized skill.
        target_task: Target task ID to deploy to.
        skill_name: Name for the deployed skill (e.g., 'v10-selector').
        cfg: Config with server paths.

    Returns:
        The full skill name (e.g., 'v10-selector-da-18-1').
    """
    cfg = cfg or DEFAULT_CONFIG
    full_skill_name = f"{skill_name}-{source_task}"

    src_dir = f"{cfg.generalized_skills_dir}/{source_task}"
    dst_link = f"{cfg.skills_dir}/{target_task}/skills/{full_skill_name}"

    cmd = (
        f"mkdir -p {cfg.skills_dir}/{target_task}/skills && "
        f"rm -rf {dst_link} && "
        f"ln -s {src_dir} {dst_link} && "
        f"echo 'Deployed: {source_task} -> {target_task} as {full_skill_name}'"
    )

    result = subprocess.run(
        ["ssh", cfg.ssh_host, "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=10", cmd],
        capture_output=True, text=True, timeout=30,
    )
    print(result.stdout.strip())
    if result.returncode != 0:
        print(f"Deploy error: {result.stderr[:200]}")
    return full_skill_name


def run_evaluation(
    target_task: str,
    skill_name: str,
    timestamp: str = None,
    cfg: V10Config = None,
) -> Tuple[int, str]:
    """Run evaluation on the target task with the deployed skill.

    Args:
        target_task: Target task ID.
        skill_name: The deployed skill name (e.g., 'v10-selector-da-18-1').
        timestamp: Optional run tag. Auto-generated if None.
        cfg: Config with harness paths and evaluation parameters.

    Returns:
        Tuple of (returncode, stdout).
    """
    cfg = cfg or DEFAULT_CONFIG
    ts = timestamp or f"v10-{target_task}-{int(time.time())}"

    skills_dir = f"{cfg.skills_dir}/{target_task}/skills"

    cmd = (
        f"cd {cfg.harness_dir} && "
        f"{cfg.bun_bin} src/harness/evaluation/cli.ts "
        f"--task {target_task} "
        f"--tasks-dir {cfg.bio_dir} "
        f"--runs-dir {cfg.transfer_dir} "
        f"--max-rounds {cfg.max_rounds} "
        f"--timeout-seconds {cfg.timeout_seconds} "
        f"--concurrency {cfg.concurrency} "
        f"--temperature {cfg.temperature} "
        f"--thinking {cfg.thinking} "
        f"--timestamp {ts} --quiet "
        f"--enable-skills "
        f"--skills-dir {skills_dir} "
        f"--skill-name {skill_name} "
        f"--max-active-skills 1"
    )

    env = cfg.to_env()
    env_cmd = " ".join(f'{k}="{v}"' for k, v in env.items())

    full_cmd = (
        f"cd {cfg.harness_dir} && "
        f"{env_cmd} {cfg.bun_bin} src/harness/evaluation/cli.ts "
        f"--task {target_task} "
        f"--tasks-dir {cfg.bio_dir} "
        f"--runs-dir {cfg.transfer_dir} "
        f"--max-rounds {cfg.max_rounds} "
        f"--timeout-seconds {cfg.timeout_seconds} "
        f"--concurrency {cfg.concurrency} "
        f"--temperature {cfg.temperature} "
        f"--thinking {cfg.thinking} "
        f"--timestamp {ts} --quiet "
        f"--enable-skills "
        f"--skills-dir {skills_dir} "
        f"--skill-name {skill_name} "
        f"--max-active-skills 1"
    )

    print(f"Evaluating {target_task} with skill '{skill_name}'...")
    result = subprocess.run(
        ["ssh", cfg.ssh_host, "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=10", full_cmd],
        capture_output=True, text=True,
        timeout=cfg.timeout_seconds + 120,
    )
    return result.returncode, result.stdout


def collect_result(
    target_task: str,
    timestamp: str,
    cfg: V10Config = None,
) -> Optional[dict]:
    """Collect the evaluation result from run_summary.json.

    Args:
        target_task: Target task ID.
        timestamp: The run tag used in run_evaluation.
        cfg: Config with server paths.

    Returns:
        Dict with reward, baseline, delta, status, rounds or None if not found.
    """
    cfg = cfg or DEFAULT_CONFIG

    # Try to find the result in the transfer runs directory
    result = subprocess.run(
        ["ssh", cfg.ssh_host, "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=10",
         f"for d in {cfg.transfer_dir}/{target_task}_{timestamp}_*/logs/run_summary.json; do "
         f"  if [ -f \"$d\" ]; then cat \"$d\"; break; fi; "
         f"done"],
        capture_output=True, text=True, timeout=30,
    )

    if result.stdout.strip():
        summary = json.loads(result.stdout)
        reward = summary.get("reward", 0) / 100.0
        baseline = DATA.get(target_task, 0.5) if hasattr(DATA, "get") else 0.5

        # Try to get baseline from the selector's data
        try:
            from .data import DataLoader
            loader = DataLoader(cfg=cfg)
            loader.load_all()
            baseline = loader.baselines.get(target_task, 0.5)
        except Exception:
            pass

        return {
            "reward": reward,
            "baseline": baseline,
            "delta": reward - baseline,
            "status": summary.get("status", "unknown"),
            "rounds": summary.get("rounds", 0),
        }

    # Try the generalized runs directory as fallback
    result2 = subprocess.run(
        ["ssh", cfg.ssh_host, "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=10",
         f"for d in {cfg.runs_dir}/{target_task}_{timestamp}_*/logs/run_summary.json; do "
         f"  if [ -f \"$d\" ]; then cat \"$d\"; break; fi; "
         f"done"],
        capture_output=True, text=True, timeout=30,
    )

    if result2.stdout.strip():
        summary = json.loads(result2.stdout)
        reward = summary.get("reward", 0) / 100.0
        return {
            "reward": reward,
            "baseline": 0.5,
            "delta": reward - 0.5,
            "status": summary.get("status", "unknown"),
            "rounds": summary.get("rounds", 0),
        }

    return None


def run_experiment(
    target_task: str,
    source_task: str,
    skill_name: str = "v10-selector",
    cfg: V10Config = None,
) -> dict:
    """Run a full end-to-end transfer experiment.

    Args:
        target_task: Target task ID.
        source_task: Source task ID with the generalized skill.
        cfg: Config.

    Returns:
        Dict with experiment results.
    """
    cfg = cfg or DEFAULT_CONFIG
    ts = f"v10_{int(time.time())}"

    print(f"\n{'='*60}")
    print(f"Experiment: {source_task} -> {target_task}")
    print(f"{'='*60}")

    # Deploy
    full_name = deploy_skill(source_task, target_task, skill_name, cfg)

    # Evaluate
    start = time.time()
    returncode, stdout = run_evaluation(target_task, full_name, ts, cfg)
    elapsed = time.time() - start

    print(f"Completed in {elapsed:.0f}s (exit={returncode})")

    # Collect result
    result = collect_result(target_task, ts, cfg)
    if result:
        delta_str = f"{result['delta']:+.3f}" if result["delta"] else "N/A"
        print(f"Reward: {result['reward']:.3f}, Baseline: {result['baseline']:.3f}, "
              f"Delta: {delta_str}")
    else:
        print("Result not found (may still be running or failed)")

    return {
        "target": target_task,
        "source": source_task,
        "timestamp": ts,
        "skill_name": full_name,
        "elapsed_seconds": elapsed,
        "returncode": returncode,
        "result": result,
    }


# Cache for lazy baseline loading in collect_result
DATA = {}