#!/bin/bash
# Re-run launcher with setsid + nohup for true session detachment
# This script kicks off the full 87-run batch in a detached session

set -uo pipefail

WORKSPACE="/data/yjh/my_claude_biomnibench"
SCRIPT="$WORKSPACE/scripts/rerun_failed_tasks.sh"
LOG="/data/yjh/biomnibench-rerun-logs/MAIN_$(date '+%Y%m%d_%H%M%S').log"
PIDFILE="/tmp/biomnibench_rerun.pid"

mkdir -p /data/yjh/biomnibench-rerun-logs

if [ -f "$PIDFILE" ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then
    echo "ERROR: rerun already running with PID $(cat $PIDFILE)"
    exit 1
fi

echo "Launching full re-run in detached session..."
echo "  Main log: $LOG"
echo "  PID file: $PIDFILE"

# setsid creates a new session fully detached from current TTY
# nohup ignores SIGHUP
# </dev/null prevents stdin issues
setsid nohup bash "$SCRIPT" </dev/null > "$LOG" 2>&1 &
PID=$!
echo $PID > "$PIDFILE"
disown $PID 2>/dev/null || true

sleep 3
if kill -0 $PID 2>/dev/null; then
    echo "  Started PID: $PID (running)"
else
    echo "  WARNING: PID $PID exited quickly, check log"
fi

echo ""
echo "Monitor with:"
echo "  tail -f $LOG"
echo "  $WORKSPACE/scripts/monitor_rerun.sh"
echo ""
echo "Stop with:"
echo "  kill -TERM $PID"
echo "  (then kill any leftover bun processes)"
