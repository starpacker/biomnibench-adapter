#!/bin/bash
# run_biomnibench.sh
#
# Run my_claude_biomnibench bun CLI against a single BioMniBench da-* task.
#
# Usage:
#   ./run_biomnibench.sh <task_id> [max_rounds] [timeout_seconds]
#
# Examples:
#   ./run_biomnibench.sh da-1-3                  # default: rounds=3, timeout=1800
#   ./run_biomnibench.sh da-1-3 1 1200           # 1 round, 20 min timeout
#   ./run_biomnibench.sh da-14-1 2 2400          # 2 rounds, 40 min timeout
#
# The run will be saved under $RUNS_DIR (default: /data/yjh/biomnibench-runs-v2).

set -euo pipefail

# === Paths ===
HARNESS_DIR="${HARNESS_DIR:-/data/yjh/my_claude_biomnibench}"
TASKS_DIR="${TASKS_DIR:-/data/yjh/biomnibench-organized}"
RUNS_DIR="${RUNS_DIR:-/data/yjh/biomnibench-runs-v2}"
BUN_BIN="${BUN_BIN:-/home/yjh/.bun/bin/bun}"

# === API / model config ===
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-00gcclg9l39y9p01000dhjzolag1q2hk00901kh1}"
export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-https://api.gpugeek.com}"
export ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-Vendor2/Claude-4.7-opus}"
export ANTHROPIC_SMALL_FAST_MODEL="${ANTHROPIC_SMALL_FAST_MODEL:-Vendor2/Claude-4.7-opus}"

# Qwen judge config
export QWEN_API_KEY="${QWEN_API_KEY:-$ANTHROPIC_API_KEY}"
export QWEN_BASE_URL="${QWEN_BASE_URL:-https://api.gpugeek.com/v1}"
export QWEN_MODEL="${QWEN_MODEL:-Vendor3/qwen3.5-plus}"

# === Args ===
TASK_ID="${1:?Usage: $0 <task_id> [max_rounds] [timeout_seconds]}"
MAX_ROUNDS="${2:-3}"
TIMEOUT_SECONDS="${3:-1800}"

# === Sanity ===
if [[ ! -d "$TASKS_DIR/$TASK_ID" ]]; then
  echo "ERROR: Task directory not found: $TASKS_DIR/$TASK_ID" >&2
  exit 2
fi
if [[ ! -d "$HARNESS_DIR/shared_venv" ]]; then
  echo "ERROR: shared_venv not found at $HARNESS_DIR/shared_venv" >&2
  echo "  Create it with: ln -sfn /home/yjh/.conda/envs/biodsbench $HARNESS_DIR/shared_venv" >&2
  exit 2
fi
if [[ ! -x "$BUN_BIN" ]]; then
  echo "ERROR: bun not found at $BUN_BIN" >&2
  exit 2
fi

mkdir -p "$RUNS_DIR"

cd "$HARNESS_DIR"

echo "=============================================="
echo "BioMniBench Evaluation"
echo "=============================================="
echo "Task:           $TASK_ID"
echo "Tasks dir:      $TASKS_DIR"
echo "Runs dir:       $RUNS_DIR"
echo "Harness dir:    $HARNESS_DIR"
echo "Agent model:    $ANTHROPIC_MODEL"
echo "Judge model:    $QWEN_MODEL"
echo "Max rounds:     $MAX_ROUNDS"
echo "Loop timeout:   ${TIMEOUT_SECONDS}s"
echo "=============================================="

exec "$BUN_BIN" src/harness/evaluation/cli.ts \
    --task "$TASK_ID" \
    --tasks-dir "$TASKS_DIR" \
    --runs-dir "$RUNS_DIR" \
    --max-rounds "$MAX_ROUNDS" \
    --timeout-seconds "$TIMEOUT_SECONDS" \
    --thinking disabled
