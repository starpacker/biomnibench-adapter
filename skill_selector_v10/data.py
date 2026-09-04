"""
Data loading utilities for the V10 skill selector.

Loads baselines, similarity matrix, results index, and v7 model
from the server. Designed to work both locally (via SSH) and on-server.
"""

import json
import os
import subprocess
from collections import defaultdict
from typing import Callable, Dict, List, Optional, Tuple

from .config import DEFAULT_CONFIG, V10Config


class DataLoader:
    """Loads all data needed by SmartSelectorV10."""

    def __init__(self, cfg: Optional[V10Config] = None, verbose: bool = False):
        self.cfg = cfg or DEFAULT_CONFIG
        self.verbose = verbose

        # Data containers (populated by load_all())
        self.baselines: Dict[str, float] = {}
        self.similarity_matrix: Dict[str, Dict[str, float]] = {}
        self.results_index: dict = {}
        self.target_lookup: Dict[str, dict] = {}  # P1: direct observation
        self.nearest_neighbor: Dict[str, dict] = {}  # P2: nearest neighbor
        self.source_quality: Dict[str, float] = {}  # P3: source quality
        self.f_hat: Callable[[float], float] = lambda bl: 0.0  # P3: isotonic
        self.task_types: Dict[str, str] = {}  # task_id -> task_type

    def _log(self, msg: str):
        if self.verbose:
            print(f"[V10Data] {msg}", flush=True)

    # ── Remote File Loading ────────────────────────────────────────────────

    def _load_json_remote(self, path: str) -> dict:
        """Load a JSON file from the remote server via SSH."""
        result = subprocess.run(
            ["ssh", self.cfg.ssh_host, "-o", "StrictHostKeyChecking=no",
             "-o", "ConnectTimeout=10", f"cat {path}"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            self._log(f"WARNING: Could not load {path}: {result.stderr[:200]}")
            return {}
        return json.loads(result.stdout)

    def _load_json_local(self, path: str) -> dict:
        """Load a JSON file from the local filesystem."""
        if not os.path.exists(path):
            self._log(f"WARNING: File not found: {path}")
            return {}
        with open(path) as f:
            return json.load(f)

    def _load_json(self, path: str, remote: bool = True) -> dict:
        """Load a JSON file, auto-detecting remote vs local."""
        if remote:
            return self._load_json_remote(path)
        return self._load_json_local(path)

    # ── Baseline Loading ──────────────────────────────────────────────────

    def _load_baselines(self, idx: dict) -> Dict[str, float]:
        """Extract baselines from results_index.json."""
        bl = {}
        for task, judges in idx.get("baselines", {}).items():
            if isinstance(judges, dict):
                bl[task] = judges.get("gemini", list(judges.values())[0]) / 100.0
            elif isinstance(judges, (int, float)):
                bl[task] = judges / 100.0
        return bl

    # ── Isotonic Function (P3) ────────────────────────────────────────────

    @staticmethod
    def _build_f_hat(iso_points: List[List[float]]) -> Callable[[float], float]:
        """Build a piecewise linear interpolation from isotonic points."""
        if not iso_points:
            return lambda bl: 0.0

        iso = sorted(iso_points, key=lambda x: x[0])

        def f_hat(bl: float) -> float:
            if bl <= iso[0][0]:
                return iso[0][1]
            if bl >= iso[-1][0]:
                return iso[-1][1]
            for i in range(len(iso) - 1):
                if iso[i][0] <= bl <= iso[i + 1][0]:
                    x_range = iso[i + 1][0] - iso[i][0]
                    if x_range <= 0:
                        return iso[i][1]
                    frac = (bl - iso[i][0]) / x_range
                    return iso[i][1] + frac * (iso[i + 1][1] - iso[i][1])
            return 0.0

        return f_hat

    # ── P1/P2 Lookup Building ─────────────────────────────────────────────

    def _build_lookup(self, idx: dict):
        """Build P1 (direct observation) and P2 (nearest neighbor) lookups."""
        # Extract ground-truth transfer results
        gt = [
            t for t in idx.get("transfers", [])
            if t.get("type") == "generalized-transfer" and t.get("source")
        ]

        # Group by target, find best source per target
        obs = defaultdict(list)
        for t in gt:
            delta = t.get("reward", 0) - self.baselines.get(t["target"], 0.5)
            obs[t["target"]].append((t["source"], delta))

        # P1: Direct observation (best source per target, must have delta > min_score)
        self.target_lookup = {}
        for tg, srcs in obs.items():
            srcs.sort(key=lambda x: -x[1])
            if srcs[0][1] > 0.05:  # P1 min_score = 0.05 (hardcoded from V8)
                self.target_lookup[tg] = {"source": srcs[0][0], "delta": srcs[0][1]}

        # P2: Nearest neighbor (find most similar known target)
        known = list(self.target_lookup.keys())
        self.nearest_neighbor = {}
        for target in self.baselines:
            if target in known:
                continue
            best = (0.0, None)
            for k in known:
                sim_matrix = self.similarity_matrix.get(k, {})
                if isinstance(sim_matrix, dict):
                    sim = sim_matrix.get(target, 0.0)
                else:
                    sim = 0.0
                if sim > best[0]:
                    best = (sim, k)

            sim, best_known = best
            if best_known and sim > 0.35:
                ref = self.target_lookup[best_known]
                if ref["source"] == target:
                    continue
                score = ref["delta"] * sim
                if score > 0.05:
                    self.nearest_neighbor[target] = {
                        "source": ref["source"],
                        "score": score,
                        "similar_to": best_known,
                        "sim_score": sim,
                    }

    # ── Task Type Loading ─────────────────────────────────────────────────

    def load_task_types(self, bio_dir: str = None, remote: bool = True) -> Dict[str, str]:
        """Load task_type from all task.toml files on the server."""
        bio_dir = bio_dir or self.cfg.bio_dir
        task_types = {}

        if remote:
            # Load via SSH
            try:
                result = subprocess.run(
                    ["ssh", self.cfg.ssh_host, "-o", "StrictHostKeyChecking=no",
                     "-o", "ConnectTimeout=10",
                     f"for d in {bio_dir}/*/; do "
                     f'  task=$(basename $d); '
                     f'  toml="{bio_dir}/$task/task.toml"; '
                     f"  if [ -f \"$toml\" ]; then "
                     f'    grep "^task_type" "$toml" | head -1 | sed "s/.*=\\s*//; s/\\"//g" | while read t; do '
                     f'      echo "$task $t"; '
                     f"    done; "
                     f"  fi; "
                     f"done"],
                    capture_output=True, text=True, timeout=30,
                )
                for line in result.stdout.strip().split("\n"):
                    line = line.strip()
                    if line:
                        parts = line.split(None, 1)
                        if len(parts) == 2:
                            task_types[parts[0]] = parts[1]
            except Exception as e:
                self._log(f"WARNING: Could not load task types via SSH: {e}")
        else:
            # Load locally
            if not os.path.isdir(bio_dir):
                self._log(f"WARNING: bio_dir not found: {bio_dir}")
                return task_types
            for task_id in sorted(os.listdir(bio_dir)):
                toml_path = os.path.join(bio_dir, task_id, "task.toml")
                if not os.path.isfile(toml_path):
                    continue
                try:
                    with open(toml_path) as f:
                        for line in f:
                            ls = line.strip()
                            if ls.startswith("task_type"):
                                ttype = ls.split("=")[1].strip().strip('"\'')
                                task_types[task_id] = ttype
                                break
                except Exception:
                    pass

        return task_types

    # ── Main Load ─────────────────────────────────────────────────────────

    def load_all(self, remote: bool = True) -> "DataLoader":
        """Load all data from server.

        Returns self for chaining.
        """
        self._log("Loading results_index.json...")
        self.results_index = self._load_json(self.cfg.results_index_path, remote)
        self.baselines = self._load_baselines(self.results_index)

        self._log("Loading similarity matrix...")
        self.similarity_matrix = self._load_json(self.cfg.similarity_path, remote)

        self._log("Loading v7 model...")
        try:
            v7 = self._load_json(self.cfg.v7_model_path, remote)
            self.source_quality = v7.get("source_shrink", {})
            self.f_hat = self._build_f_hat(v7.get("isotonic_points", []))
        except Exception as e:
            self._log(f"WARNING: Could not load v7 model: {e}")

        self._log("Building P1/P2 lookups...")
        self._build_lookup(self.results_index)

        self._log("Loading task types...")
        self.task_types = self.load_task_types(remote=remote)

        self._log(f"Loaded: {len(self.baselines)} baselines, "
                  f"{len(self.target_lookup)} P1, "
                  f"{len(self.nearest_neighbor)} P2, "
                  f"{len(self.source_quality)} source qualities, "
                  f"{len(self.task_types)} task types")
        return self

    # ── Skill Discovery ───────────────────────────────────────────────────

    def discover_skills(self, remote: bool = True) -> Dict[str, str]:
        """Discover all available generalized skills on the server.

        Returns:
            Dict mapping source_task_id -> path to SKILL.md
        """
        skills = {}
        if remote:
            result = subprocess.run(
                ["ssh", self.cfg.ssh_host, "-o", "StrictHostKeyChecking=no",
                 "-o", "ConnectTimeout=10",
                 f"for d in {self.cfg.generalized_skills_dir}/*/; do "
                 f"  task=$(basename $d); "
                 f"  if [ -f \"{self.cfg.generalized_skills_dir}/$task/SKILL.md\" ]; then "
                 f"    echo \"$task\"; "
                 f"  fi; "
                 f"done"],
                capture_output=True, text=True, timeout=30,
            )
            for line in result.stdout.strip().split("\n"):
                line = line.strip()
                if line:
                    skills[line] = f"{self.cfg.generalized_skills_dir}/{line}/SKILL.md"
        else:
            base = self.cfg.generalized_skills_dir
            if os.path.isdir(base):
                for d in sorted(os.listdir(base)):
                    dpath = os.path.join(base, d)
                    skill_file = os.path.join(dpath, "SKILL.md")
                    if os.path.isdir(dpath) and os.path.isfile(skill_file):
                        skills[d] = skill_file
        return skills