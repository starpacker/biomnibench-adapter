# BioMniBench Adapter

> A reproducible evaluation harness for running coding agents (Claude Code style) against the
> [BioMniBench](https://github.com/snap-stanford/BioMni) DA (Data Analysis) task suite, with
> built-in **native skill-learning** support.

This repository packages three contributions on top of an open-source Claude Code style
agent:

| Module | Purpose |
| --- | --- |
| `src/harness/evaluation/` | A source-native evaluation runner that drives one in-process `QueryEngine` session per task, with judge feedback delivered as follow-up turns. |
| `src/skills-learning/` | A complete skill-learning loop: trajectory analysis → skill writing → critic → A/B validation → activation. |
| `scripts/rerun_failed_tasks.sh` | Massively-parallel rerunner that collects success/failure pairs for each task — the **evidence corpus** that skill-learning consumes. |

The dataset used by this harness — a re-organised, manifest-driven view of the BioMniBench
DA split — lives in a separate Hugging Face Dataset repository:

➡ **Dataset:** [`starpacker52/biomnibench-organized`](https://huggingface.co/datasets/starpacker52/biomnibench-organized)

---

## Table of Contents

1. [Motivation](#motivation)
2. [Repository layout](#repository-layout)
3. [Quick start](#quick-start)
4. [Re-running failed tasks (evidence collection)](#re-running-failed-tasks-evidence-collection)
5. [Skill-learning cycle](#skill-learning-cycle)
6. [Configuration](#configuration)
7. [Reproducing the headline results](#reproducing-the-headline-results)
8. [Citing](#citing)
9. [Acknowledgements](#acknowledgements)

---

## Motivation

Existing biomedical-coding benchmarks report a single pass/fail score per task, which makes
it hard to disentangle *capability* gaps (the model does not know how to do the task) from
*reliability* gaps (the model knows what to do but fails intermittently). To support **skill
learning from failures**, we needed:

- An evaluation loop that records the **full agent trajectory** (tool calls, code, judge
  feedback) for every attempt.
- An execution layer that can re-run the same task many times *with isolated working
  directories* so that we get genuine success/failure pairs rather than a single noisy roll.
- A learning loop that can ingest those pairs and propose, critique, validate and activate
  reusable skills.

This repository ties those three things together.

## Repository layout

```text
my_claude_biomnibench/
├── src/
│   ├── harness/
│   │   └── evaluation/         # CLI, runner, judge, metadata recorder
│   ├── skills-learning/        # index / learn / critic / refine-failed / validate / activate / cycle / report
│   │   ├── cli.ts
│   │   ├── skillLearningCycle.ts
│   │   ├── validationRunner.ts
│   │   ├── runScanner.ts
│   │   ├── agent/learningSubagentRunner.ts
│   │   └── prompts/            # skill-writer, trajectory-analyst, skill-critic, ...
│   └── … (full Claude Code style agent: QueryEngine, tools, commands, …)
├── scripts/
│   ├── rerun_failed_tasks.sh           # 29 tasks × N attempts, isolated per-task
│   ├── launch_rerun_detached.sh        # setsid + nohup wrapper (SIGHUP-safe)
│   ├── monitor_rerun.sh                # live progress monitor
│   ├── rerun_quickref.sh               # cheat sheet
│   └── test_biomnibench_adapter.ts     # smoke test for the adapter
├── config/
│   ├── skill-learning.json             # paths, model, prompt selection, budgets
│   ├── llm-config.sh                   # API endpoint / model / key (sourced)
│   └── task-batch-runner.json
├── docs/
│   ├── AUTOSKILL_HARNESS.md            # original AutoSkill harness notes
│   └── source-native-eval-stability-plan.md
└── *.md                                # historical progress reports
```

> `node_modules/` (≈258 MB) and `shared_venv/` (≈926 MB) are intentionally ignored. After
> cloning, recreate them with `bun install` and the venv recipe in
> [`docs/AUTOSKILL_HARNESS.md`](./docs/AUTOSKILL_HARNESS.md).

## Quick start

### Prerequisites

| Tool | Tested version |
| --- | --- |
| [Bun](https://bun.sh/) | ≥ 1.1 |
| Python | 3.10 / 3.11 (for the per-task evaluation envs) |
| An Anthropic-compatible LLM endpoint | e.g. `ANTHROPIC_BASE_URL` + `ANTHROPIC_MODEL` |

### Install everything (recommended one-liner)

```bash
git clone https://github.com/starpacker/biomnibench-adapter.git
cd biomnibench-adapter

# Get a HuggingFace token (free) — required because the upstream BioMniBench-DA
# dataset is licence-gated. Accept the licence once at:
#   https://huggingface.co/datasets/phylobio/BiomniBench-DA
export HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxxxxx

# If you are in mainland China, also set:
# export HF_ENDPOINT=https://hf-mirror.com

./scripts/bootstrap.sh                          # all 50 tasks (~40 GB)
# or, for a quick smoke test, only one tiny task:
# ./scripts/bootstrap.sh da-9-1                 # 0.1 MB, 3 files
```

What `bootstrap.sh` does, in order:

1. Verifies `bun`, `python3`, `git`.
2. Runs `bun install` and `pip install -r requirements.txt`.
3. Clones the dataset repo into `./biomnibench-data/`.
4. Calls `download_data.py --hydrate-from-hf`, which pulls each task's raw files
   from `phylobio/BiomniBench-DA` into `biomnibench-data/tasks/<id>/envs/data/`
   and hardlinks them into the runner-expected `data/` and `visible_data/`
   mirrors.

### Manual install (if you prefer step-by-step)

```bash
bun install
pip install -r requirements.txt
git clone https://huggingface.co/datasets/starpacker52/biomnibench-organized biomnibench-data
python biomnibench-data/download_data.py --hydrate-from-hf
```

### Configure your LLM endpoint

```bash
export ANTHROPIC_BASE_URL=https://your-gateway.example.com
export ANTHROPIC_MODEL=Vendor2/Claude-4.7-opus      # or your model id
export ANTHROPIC_API_KEY=sk-...
```

### Run a single task

```bash
bun src/harness/evaluation/cli.ts \
  --task-dir ./biomnibench-data/tasks/da-9-1 \
  --output-root /tmp/biomnibench-runs \
  --max-rounds 3
```

Each run writes a directory with `run_summary.json`, `trajectory.json`, judge transcripts
and the agent's working files — the same shape that the skill-learning loop expects.

## Re-running failed tasks (evidence collection)

`scripts/rerun_failed_tasks.sh` is the script we used to build the success/failure corpus
that drives skill learning. Key design points:

- **Per-task working-directory isolation** — attempts of the same task are serialised so
  the harness's `cp -r visible_data …` step never collides on a timestamp.
- **Cross-task parallelism** — up to `PARALLEL_TASKS` different tasks run concurrently.
- **SIGHUP-safe launching** — wrap with `scripts/launch_rerun_detached.sh` (setsid + nohup
  + `disown`) so a closed terminal does not kill the run.

```bash
# Typical invocation
PARALLEL_TASKS=4 MAX_ROUNDS=3 TIMEOUT_SECONDS=3000 \
  scripts/launch_rerun_detached.sh scripts/rerun_failed_tasks.sh

# Live monitoring
scripts/monitor_rerun.sh
```

Final headline from our run: **29 / 29 previously-failing tasks produced both a success
and a failure run**, yielding 58 success trajectories and a matching pool of failures —
the input to skill learning.

## Skill-learning cycle

The full loop lives under `src/skills-learning/` and is driven by one CLI:

```bash
bun src/skills-learning/cli.ts <command> [--config config/skill-learning.json]
```

| Command | What it does |
| --- | --- |
| `index` | Scans `run_summary.json` files under the configured `runsRoot` and builds an index of (task, attempt, status, reward, trajectory path). |
| `learn` | For each task with success-vs-failure evidence, calls the learning subagent (`skill-writer.md` + `trajectory-analyst.md`) to draft a skill. |
| `critic` | Runs `skill-critic.md` to filter low-quality drafts. |
| `refine-failed` | Targeted second pass on skills that the critic rejected. |
| `validate-train` | A/B-runs the held-out training shard with and without each skill; computes `success_delta`. |
| `activate` | Promotes skills whose `success_delta` clears the threshold. |
| `validate-valid` | Final validation on the validation shard. |
| `cycle` | Runs the full pipeline end-to-end. |
| `report` | Emits a markdown summary of activated skills and their measured uplift. |

The prompts in `src/skills-learning/prompts/` are intentionally checked in so the loop is
fully auditable.

## Configuration

`config/skill-learning.json` is the single source of truth for paths, model selection and
budgets. The shape is:

```jsonc
{
  "runsRoot":      "/data/biomnibench-runs-v2",
  "tasksRoot":     "/data/biomnibench-organized",
  "skillsDir":     "./skills",
  "model":         "Vendor2/Claude-4.7-opus",
  "maxActiveSkills": 8,
  "validation": {
    "trainShard":  ["da-1-3", "da-1-4", "..."],
    "validShard":  ["da-8-1", "da-10-1", "..."],
    "attemptsPerTask": 3
  }
}
```

`config/llm-config.sh` is sourced by the shell scripts and exports the standard
`ANTHROPIC_*` variables.

## Reproducing the headline results

1. **Install** (above).
2. **Fetch the dataset** to `/data/biomnibench-organized` (or set `BIOMNIBENCH_TASKS_ROOT`).
3. **Run the baseline batch** — single pass over all 50 DA tasks:

   ```bash
   PARALLEL_TASKS=4 scripts/launch_rerun_detached.sh scripts/rerun_failed_tasks.sh
   ```

4. **Index the runs** and **learn skills**:

   ```bash
   bun src/skills-learning/cli.ts index
   bun src/skills-learning/cli.ts cycle
   ```

5. **Compare** the activated-skills batch against the baseline using `report`:

   ```bash
   bun src/skills-learning/cli.ts report --out reports/skill-uplift.md
   ```

## Citing

If you use this harness, please cite both the underlying benchmark and this adapter:

```bibtex
@misc{biomnibench-adapter,
  title  = {BioMniBench Adapter: a source-native harness with native skill learning},
  author = {Ying, Jiahe},
  year   = {2026},
  url    = {https://github.com/starpacker/biomnibench-adapter}
}
```

## Acknowledgements

- The underlying agent code derives from publicly released Claude Code style sources.
- The DA task suite originates from the [BioMniBench](https://github.com/snap-stanford/BioMni)
  project at Stanford SNAP; please respect their original licence and citations.
- The skill-learning prompts and pipeline started from work in the
  [`Godlikegu/my_claude`](https://github.com/Godlikegu/my_claude) `feature/native-skill-learning`
  branch.

## License

Released under the MIT License — see [`LICENSE`](./LICENSE).
