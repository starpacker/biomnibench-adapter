# SmartSelectorV10 — SOTA Skill Selector for BioDSBench

## Overview

SmartSelectorV10 is the best-performing skill selector for the BioDSBench transfer learning benchmark. It decides **which source task's generalized skill** to transfer to a **target task** to maximize performance improvement.

**Key results (23 experiments, 3 batches):**
- **65%** positive transfer rate (15/23)
- **87%** non-negative rate (20/23)
- **+1.18** total net delta across all experiments
- **76%** same-type positive rate (13/17)
- **94%** same-type non-negative rate (16/17)

## Architecture

```
skill_selector_v10/
├── __init__.py          # Package entry, exports
├── config.py            # V10Config dataclass (all paths, API keys, thresholds)
├── compatibility.py     # Compatibility groups & tier checking
├── data.py              # DataLoader (baselines, similarity, v7 model, task types)
├── selector.py          # SmartSelectorV10 (the core selection algorithm)
├── tools.py             # deploy_skill, run_evaluation, collect_result, run_experiment
└── scripts/
    ├── run_experiments.py    # Full experiment runner (select + deploy + evaluate)
    └── generate_batch.py     # Generate standalone bash batch scripts
```

## Selection Algorithm (3 Phases)

### Phase 1 — Direct Observation (P1)
If we have **ground-truth data** showing source→target works, use it directly. Exempt from all thresholds.

### Phase 2 — Nearest Neighbor (P2)
Find the most similar **known** target (via similarity matrix), use its best source. Score = `source_delta × similarity`. Tiered thresholds apply.

### Phase 2→3 Override
If P2 fails its tier threshold, check if a same-type/compatible P3 candidate exists that meets its threshold. This prevents false negatives.

### Phase 3 — v7 Fallback (P3)
When no direct or neighbor data exists, use the v7 model: `score = f_hat(baseline) + source_quality[source] + compatibility_bonus`.

## Tiered Thresholds

| Compatibility | Bonus | Threshold | Rationale |
|:-------------|:-----:|:---------:|:----------|
| **Same-type** | +0.15 | -0.15 | 76% positive rate → very permissive |
| **Compatible** | +0.02 | 0.05 | 50% positive rate → moderate |
| **Incompatible** | -1.00 | inf | 0% positive rate → hard reject |

Compatibility groups are defined in `compatibility.py` based on the `task_type` field in each task's `task.toml`.

## Quick Start

### 1. Local inspection (requires SSH access to server1)

```python
from skill_selector_v10 import SmartSelectorV10

# Load selector (fetches data from server1 via SSH)
selector = SmartSelectorV10(verbose=True)
selector.load(remote=True)

# Discover available skills
from skill_selector_v10.tools import discover_skills
available = discover_skills()

# Select skill for a target
source, score = selector.select_skill("da-25-1", available)
print(selector.describe_selection("da-25-1", source, score))
```

### 2. Run experiments (on server)

```bash
# Upload the package to server and run
scp -r skill_selector_v10 server1:/data/yjh/skill-transfer-eval/

# SSH in and run
ssh server1
cd /data/yjh/skill-transfer-eval

# Print all selections
python3 -m skill_selector_v10.scripts.run_experiments --print-selections

# Run experiments for all recommended targets
python3 -m skill_selector_v10.scripts.run_experiments

# Dry run first
python3 -m skill_selector_v10.scripts.run_experiments --dry-run
```

### 3. Generate a standalone bash script

```bash
# Generate a batch script for specific pairs
python3 -m skill_selector_v10.scripts.generate_batch \
    --pairs da-18-1 da-25-1 \
    --pairs da-13-1 da-8-3 \
    --output run_my_batch.sh

# Upload to server and run
scp run_my_batch.sh server1:/tmp/
ssh server1 "bash /tmp/run_my_batch.sh"
```

## Reproducing V10 Results

To reproduce the full 23-pair V10 validation:

```bash
python3 -m skill_selector_v10.scripts.generate_batch \
    --name v10_reproduce \
    --output run_v10_repro.sh
```

This generates a bash script with all 23 V10-tested pairs. Upload and run.

## Configuration

All paths and thresholds are in `config.py` as a `V10Config` dataclass:

```python
from skill_selector_v10 import V10Config

cfg = V10Config(
    remote_base="/data/yjh/skill-transfer-eval",
    same_type_bonus=0.15,
    same_type_threshold=-0.15,
    bl_max=0.80,
    max_rounds=5,
    timeout_seconds=7200,
)
```

Override any field. Pass to any V10 component:

```python
selector = SmartSelectorV10(cfg=cfg)
```

## Dependencies

- **Python 3.8+**
- **SSH access** to a server with BioDSBench harness at `/tmp/my_claude_biomnibench_fixed`
- Server-side: **Bun** runtime at `/tmp/bun_extract/bun-linux-x64/bun`
- No external Python packages required (pure stdlib except for type hints)

## File Overview

| File | Purpose |
|:-----|:--------|
| `config.py` | Single source of truth for all paths, API keys, thresholds |
| `compatibility.py` | 7 compatibility groups, tier checking utilities |
| `data.py` | Loads baselines, similarity matrix, v7 model, task types |
| `selector.py` | Core `SmartSelectorV10` class with 3-phase selection |
| `tools.py` | Deploy, evaluate, collect, run_experiment utilities |
| `scripts/run_experiments.py` | CLI runner for full experiment pipeline |
| `scripts/generate_batch.py` | Generate standalone bash batch scripts |

## V10 Validation Report

See `V10_Selector_Report.md` in the project root for the full 23-pair validation report with detailed analysis and conclusions.