"""
Centralized configuration for the V10 skill selector pipeline.

All server paths, API keys, model names, and evaluation parameters
are defined here. Single source of truth — import this everywhere.
"""

import os
from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class V10Config:
    # ── Server Paths ──────────────────────────────────────────────────────
    remote_base: str = "/data/yjh/skill-transfer-eval"
    generalized_skills_dir: str = field(init=False)
    skills_dir: str = field(init=False)
    similarity_path: str = field(init=False)
    results_index_path: str = field(init=False)
    v7_model_path: str = field(init=False)
    bio_dir: str = "/data/yjh/biomnibench-organized"
    runs_dir: str = field(init=False)
    transfer_dir: str = field(init=False)

    # ── Harness / CLI ────────────────────────────────────────────────────
    harness_dir: str = "/tmp/my_claude_biomnibench_fixed"
    bun_bin: str = "/tmp/bun_extract/bun-linux-x64/bun"

    # ── API ───────────────────────────────────────────────────────────────
    anthropic_api_key: str = field(default_factory=lambda: os.environ.get(
        "ANTHROPIC_API_KEY", "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"))
    anthropic_base_url: str = "https://api.gpugeek.com"
    worker_model: str = "Vendor3/DeepSeek-V4-Flash"

    qwen_api_key: str = field(default_factory=lambda: os.environ.get(
        "QWEN_API_KEY", "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"))
    qwen_base_url: str = "https://api.gpugeek.com/v1"
    judge_model: str = "Vendor2/Gemini-3-flash"

    # ── Evaluation ────────────────────────────────────────────────────────
    max_rounds: int = 5
    timeout_seconds: int = 7200
    concurrency: int = 1
    temperature: float = 1.0
    thinking: str = "disabled"

    # ── Selector Thresholds ───────────────────────────────────────────────
    # Same-type: very permissive (validation shows even V9 score=-0.17 can give +0.11)
    same_type_bonus: float = 0.15
    same_type_threshold: float = -0.15

    # Compatible: moderate
    compatible_bonus: float = 0.02
    compatible_threshold: float = 0.05

    # Incompatible: hard reject
    incompatible_penalty: float = -1.00

    # Baseline gating: skip targets with baseline > this
    bl_max: float = 0.80

    # P1 exempt from all thresholds, but must have delta > 0 after bonus
    # P2/P3 use tiered thresholds defined above

    # ── SSH ───────────────────────────────────────────────────────────────
    ssh_host: str = "server1"
    ssh_opts: str = "-o StrictHostKeyChecking=no -o ConnectTimeout=10"

    def __post_init__(self):
        self.generalized_skills_dir = f"{self.remote_base}/generalized_skills"
        self.skills_dir = f"{self.remote_base}/skills"
        self.similarity_path = f"{self.remote_base}/similarity/similarity_matrix.json"
        self.results_index_path = f"{self.remote_base}/results_index.json"
        self.v7_model_path = f"{self.remote_base}/skill_selector/v7_model.json"
        self.runs_dir = f"{self.remote_base}/generalized"
        self.transfer_dir = f"{self.remote_base}/transfer"

    def to_env(self) -> Dict[str, str]:
        """Return environment variables dict for subprocesses."""
        return {
            "ANTHROPIC_API_KEY": self.anthropic_api_key,
            "ANTHROPIC_BASE_URL": self.anthropic_base_url,
            "ANTHROPIC_MODEL": self.worker_model,
            "QWEN_API_KEY": self.qwen_api_key,
            "QWEN_BASE_URL": self.qwen_base_url,
            "QWEN_MODEL": self.judge_model,
        }

    def ssh_cmd(self, remote_command: str) -> str:
        """Build an SSH command string."""
        return f"ssh {self.ssh_opts} {self.ssh_host} {remote_command}"


# Global default config (singleton for convenience)
DEFAULT_CONFIG = V10Config()