#!/bin/bash
# Quick test: 2 tasks x 1 attempt, parallel 2
# Verify the re-run pipeline works before full 87-run launch

set -uo pipefail

WORKSPACE="/data/yjh/my_claude_biomnibench"
TASKS_DIR="/data/yjh/biomnibench-organized"
RUNS_DIR="/data/yjh/biomnibench-runs-v2"
LOG_DIR="/data/yjh/biomnibench-rerun-logs"
BUN="/home/yjh/.bun/bin/bun"

export ANTHROPIC_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
export ANTHROPIC_BASE_URL="https://api.gpugeek.com"
export ANTHROPIC_MODEL="Vendor2/Claude-4.7-opus"
export QWEN_MODEL="Vendor3/qwen3.5-plus"

mkdir -p "$LOG_DIR"
cd "$WORKSPACE"

run_one() {
    local task=$1
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local log="$LOG_DIR/SMOKE_${task}_${timestamp}.log"
    echo "[$(date '+%H:%M:%S')] [SMOKE] Start $task -> $log"
    "$BUN" run src/harness/evaluation/cli.ts \
        --task "$task" \
        --tasks-dir "$TASKS_DIR" \
        --runs-dir "$RUNS_DIR" \
        --max-rounds 3 \
        --timeout-seconds 3000 \
        > "$log" 2>&1
    local rc=$?
    echo "[$(date '+%H:%M:%S')] [SMOKE] Done  $task (exit=$rc)"
}

echo "============================================================"
echo "  Smoke test: 2 tasks x 1 attempt, parallel 2"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"

# Run 2 tasks in parallel
run_one da-1-3 &
PID1=$!
run_one da-5-1 &
PID2=$!

wait $PID1
RC1=$?
wait $PID2
RC2=$?

echo ""
echo "============================================================"
echo "  Smoke test done"
echo "  da-1-3 exit=$RC1"
echo "  da-5-1 exit=$RC2"
echo "============================================================"

# Show results
echo ""
echo "=== New runs created ==="
ls -td "$RUNS_DIR"/da-1-3_* "$RUNS_DIR"/da-5-1_* 2>/dev/null | head -10

echo ""
echo "=== Latest run summaries ==="
for task in da-1-3 da-5-1; do
    latest=$(ls -td "$RUNS_DIR"/${task}_* 2>/dev/null | head -1)
    if [ -n "$latest" ] && [ -f "$latest/logs/run_summary.json" ]; then
        echo "--- $task ($(basename $latest)) ---"
        python3 -c "
import json
d = json.load(open('$latest/logs/run_summary.json'))
print(f'  status: {d.get(\"status\")}')
print(f'  reward: {d.get(\"reward\")}')
print(f'  rounds: {d.get(\"rounds\")}')
fr = d.get('final_result', {})
if 'total_score' in fr:
    print(f'  score:  {fr[\"total_score\"]}/{fr.get(\"max_score\", 100)}')
elif 'error' in fr:
    print(f'  error:  {fr[\"error\"]}')
"
    fi
done
