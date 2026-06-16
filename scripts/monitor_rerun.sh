#!/bin/bash
# Monitor the re-run progress

RUNS_DIR="/data/yjh/biomnibench-runs-v2"
LOG_DIR="/data/yjh/biomnibench-rerun-logs"

echo "============================================================"
echo "  BioMniBench Re-run Monitor"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# Check running processes
echo "=== Running processes ==="
PROCS=$(ps aux | grep -E "bun.*evaluation/cli" | grep -v grep | wc -l)
echo "  Bun processes: $PROCS"
if [ $PROCS -gt 0 ]; then
    ps aux | grep -E "bun.*evaluation/cli" | grep -v grep | awk '{print "    PID " $2 ": --task " $18}'
fi
echo ""

# Count runs created in last 2 hours
echo "=== Recent run directories (last 2 hours) ==="
find "$RUNS_DIR" -maxdepth 1 -type d -name "da-*_202606*" -mmin -120 | sort | while read dir; do
    if [ -f "$dir/logs/run_summary.json" ]; then
        summary=$(python3 -c "
import json
d = json.load(open('$dir/logs/run_summary.json'))
status = d.get('status', '?')
reward = d.get('reward', 0)
rounds = d.get('rounds', 0)
print(f'{status:8s} r={rounds} reward={reward:.2f}')
" 2>/dev/null || echo "parsing...")
        echo "  $(basename $dir): $summary"
    else
        echo "  $(basename $dir): (running...)"
    fi
done
echo ""

# Log files
echo "=== Active log files ==="
ls -lht "$LOG_DIR"/*.log 2>/dev/null | head -10 | awk '{print "  " $9 " (" $5 ")"}'
echo ""

# Quick stats
echo "=== Quick stats ==="
TOTAL_RUNS=$(find "$RUNS_DIR" -maxdepth 1 -type d -name "da-*_202606*" | wc -l)
RUNS_WITH_SUMMARY=$(find "$RUNS_DIR" -name "run_summary.json" -path "*/da-*_202606*/logs/*" | wc -l)
echo "  Total run dirs today: $TOTAL_RUNS"
echo "  With summary.json:    $RUNS_WITH_SUMMARY (completed)"
echo "  In progress:          $((TOTAL_RUNS - RUNS_WITH_SUMMARY))"
