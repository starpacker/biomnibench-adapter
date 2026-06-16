#!/bin/bash
# Re-run 29 failed tasks - each task runs sequentially (3 attempts),
# but different tasks run in parallel.
# This avoids run-dir timestamp collisions within a single task.

set -uo pipefail

WORKSPACE="/data/yjh/my_claude_biomnibench"
TASKS_DIR="/data/yjh/biomnibench-organized"
RUNS_DIR="/data/yjh/biomnibench-runs-v2"
LOG_DIR="/data/yjh/biomnibench-rerun-logs"
BUN="/home/yjh/.bun/bin/bun"

REPEATS_PER_TASK=3
MAX_ROUNDS=3
TIMEOUT_SECONDS=3000
PARALLEL_TASKS=4

export ANTHROPIC_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
export ANTHROPIC_BASE_URL="https://api.gpugeek.com"
export ANTHROPIC_MODEL="Vendor2/Claude-4.7-opus"
export QWEN_MODEL="Vendor3/qwen3.5-plus"

FAILED_TASKS=(
    da-1-3 da-1-4
    da-10-1 da-10-3
    da-11-1
    da-12-2 da-12-4
    da-13-1 da-13-3
    da-15-2
    da-17-3
    da-18-7
    da-19-4
    da-20-3 da-20-4
    da-26-2
    da-3-4 da-3-5
    da-4-1 da-4-6 da-4-7
    da-5-1 da-5-3
    da-6-2 da-6-5
    da-8-2 da-8-3
    da-9-1 da-9-7
)

mkdir -p "$LOG_DIR"
cd "$WORKSPACE"

run_task_all_attempts() {
    local task=$1
    for attempt in $(seq 1 $REPEATS_PER_TASK); do
        local ts=$(date '+%Y%m%d_%H%M%S')
        local log="$LOG_DIR/${task}_attempt${attempt}_${ts}.log"
        echo "[$(date '+%H:%M:%S')] [$task] START attempt $attempt -> $log"
        sleep 1
        "$BUN" run src/harness/evaluation/cli.ts \
            --task "$task" \
            --tasks-dir "$TASKS_DIR" \
            --runs-dir "$RUNS_DIR" \
            --max-rounds "$MAX_ROUNDS" \
            --timeout-seconds "$TIMEOUT_SECONDS" \
            > "$log" 2>&1
        local rc=$?
        echo "[$(date '+%H:%M:%S')] [$task] DONE  attempt $attempt (exit=$rc)"
        sleep 2
    done
    echo "[$(date '+%H:%M:%S')] [$task] ALL ATTEMPTS COMPLETE"
}

export -f run_task_all_attempts
export LOG_DIR WORKSPACE TASKS_DIR RUNS_DIR BUN MAX_ROUNDS TIMEOUT_SECONDS REPEATS_PER_TASK
export ANTHROPIC_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_MODEL QWEN_MODEL

TOTAL_RUNS=$((${#FAILED_TASKS[@]} * REPEATS_PER_TASK))
echo "============================================================"
echo "  BioMniBench Failed Task Re-run (sequential per task)"
echo "============================================================"
echo "  Tasks:           ${#FAILED_TASKS[@]}"
echo "  Repeats:         $REPEATS_PER_TASK per task (sequential)"
echo "  Total runs:      $TOTAL_RUNS"
echo "  Parallel tasks:  $PARALLEL_TASKS"
echo "  Max rounds:      $MAX_ROUNDS"
echo "  Timeout/run:     ${TIMEOUT_SECONDS}s"
echo "  Logs:            $LOG_DIR"
echo "============================================================"
echo ""
echo "Starting at $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

START_TIME=$(date +%s)
TASKS_FILE="$LOG_DIR/tasks_to_run.txt"
printf '%s\n' "${FAILED_TASKS[@]}" > "$TASKS_FILE"

cat "$TASKS_FILE" | xargs -P $PARALLEL_TASKS -I {} bash -c 'run_task_all_attempts "$@"' _ {}

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
echo ""
echo "============================================================"
echo "  All tasks done in $((ELAPSED / 60))m $((ELAPSED % 60))s"
echo "============================================================"

echo ""
echo "=== Results Summary ==="
python3 << 'PYEOF'
import json, glob
from collections import defaultdict

records = defaultdict(list)
for f in glob.glob('/data/yjh/biomnibench-runs-v2/*/logs/run_summary.json'):
    try:
        d = json.load(open(f))
        run_dir = f.split('/')[-3]
        task = run_dir.split('_')[0]
        status = d.get('status', '?')
        reward = d.get('reward', 0)
        records[task].append((run_dir, status, reward))
    except Exception:
        pass

RERUN_TASKS = set("""da-1-3 da-1-4 da-10-1 da-10-3 da-11-1 da-12-2 da-12-4
da-13-1 da-13-3 da-15-2 da-17-3 da-18-7 da-19-4 da-20-3 da-20-4 da-26-2
da-3-4 da-3-5 da-4-1 da-4-6 da-4-7 da-5-1 da-5-3 da-6-2 da-6-5 da-8-2
da-8-3 da-9-1 da-9-7""".split())

print(f"\n{'Task':12s} {'Total':>5s} {'Success':>7s} {'Failed':>7s} {'Timeout':>8s}")
print("-" * 50)
sv_count = 0
new_success = 0
for task in sorted(RERUN_TASKS):
    runs = records.get(task, [])
    succ = sum(1 for _, s, r in runs if s == 'success' or r >= 1)
    fail = sum(1 for _, s, _ in runs if s == 'failed')
    tout = sum(1 for _, s, _ in runs if s == 'timeout')
    print(f"{task:12s} {len(runs):>5d} {succ:>7d} {fail:>7d} {tout:>8d}")
    if succ > 0 and (fail + tout) > 0:
        sv_count += 1
    if succ > 0:
        new_success += succ

print("-" * 50)
print(f"\nTasks with success-vs-failure evidence: {sv_count}")
print(f"Total success runs in re-run set: {new_success}")
PYEOF
