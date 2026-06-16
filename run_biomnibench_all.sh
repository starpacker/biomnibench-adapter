#!/bin/bash
# run_biomnibench_all.sh
#
# Run my_claude_biomnibench bun CLI sequentially against all BioMniBench da-*
# tasks. Each task gets its own subdirectory under $RUNS_DIR and a per-task
# log file. After each task we look up the qwen judge score and print it.
#
# Usage:
#   ./run_biomnibench_all.sh [max_rounds] [timeout_seconds] [hard_timeout_sec]
#     max_rounds          (default 2)    - max judge rounds per task
#     timeout_seconds     (default 1500) - per-round agent inference timeout
#     hard_timeout_sec    (default 4500) - wall-clock kill for entire task (75min)
#
# Env overrides:
#   HARNESS_DIR, TASKS_DIR, RUNS_DIR     - paths
#   SKIP_IF_SCORED=1                     - skip tasks with prior judge_result
#   ONLY_TASKS="da-1-3 da-2-1"           - restrict subset

set -uo pipefail

HARNESS_DIR="${HARNESS_DIR:-/data/yjh/my_claude_biomnibench}"
TASKS_DIR="${TASKS_DIR:-/data/yjh/biomnibench-organized}"
RUNS_DIR="${RUNS_DIR:-/data/yjh/biomnibench-runs-v2}"
MAX_ROUNDS="${1:-2}"
TIMEOUT_SECONDS="${2:-1500}"
HARD_TIMEOUT_SEC="${3:-4500}"

SKIP_IF_SCORED="${SKIP_IF_SCORED:-1}"
ONLY_TASKS="${ONLY_TASKS:-}"

MASTER_LOG="$RUNS_DIR/_master.log"
mkdir -p "$RUNS_DIR"

if [[ -n "$ONLY_TASKS" ]]; then
  TASK_IDS="$ONLY_TASKS"
else
  TASK_IDS=$(ls "$TASKS_DIR" 2>/dev/null | grep '^da-' | sort -V)
fi
N_TASKS=$(echo "$TASK_IDS" | wc -w)

{
  echo "=============================================="
  echo "BioMniBench Batch Run started at $(date)"
  echo "Total tasks:      $N_TASKS"
  echo "Max rounds:       $MAX_ROUNDS"
  echo "Round timeout:    ${TIMEOUT_SECONDS}s"
  echo "Hard timeout:     ${HARD_TIMEOUT_SEC}s (per task)"
  echo "Runs dir:         $RUNS_DIR"
  echo "Skip if scored:   $SKIP_IF_SCORED"
  echo "=============================================="
} | tee -a "$MASTER_LOG"

existing_score() {
  local tid="$1"
  local judge_dir="$RUNS_DIR/.judge_private"
  [[ -d "$judge_dir" ]] || { echo ""; return; }
  local best=""
  shopt -s nullglob
  for f in "$judge_dir"/${tid}_*/judge_result_round_*.json; do
    [[ -f "$f" ]] || continue
    local s
    s=$(python3 -c "import json; d=json.load(open('$f')); v=d.get('total_score') or d.get('score'); print(v if v is not None else '')" 2>/dev/null)
    if [[ -n "$s" ]]; then
      if [[ -z "$best" ]] || (( s > best )); then best="$s"; fi
    fi
  done
  shopt -u nullglob
  echo "$best"
}

latest_score() {
  local tid="$1"
  local judge_dir="$RUNS_DIR/.judge_private"
  [[ -d "$judge_dir" ]] || { echo ""; return; }
  local newest
  newest=$(ls -1dt "$judge_dir"/${tid}_* 2>/dev/null | head -1)
  [[ -n "$newest" ]] || { echo ""; return; }
  local f
  f=$(ls -1t "$newest"/judge_result_round_*.json 2>/dev/null | head -1)
  [[ -f "$f" ]] || { echo ""; return; }
  python3 -c "import json; d=json.load(open('$f')); v=d.get('total_score') or d.get('score'); print(v if v is not None else '')" 2>/dev/null
}

OK_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
i=0

for TASK_ID in $TASK_IDS; do
  i=$((i + 1))

  if [[ "$SKIP_IF_SCORED" == "1" ]]; then
    prev=$(existing_score "$TASK_ID")
    if [[ -n "$prev" ]]; then
      SKIP_COUNT=$((SKIP_COUNT + 1))
      echo "[$i/$N_TASKS] SKIP $TASK_ID (already scored: $prev)" | tee -a "$MASTER_LOG"
      continue
    fi
  fi

  STAMP=$(date +%Y%m%d_%H%M%S)
  TASK_LOG="$RUNS_DIR/_${TASK_ID}_${STAMP}.log"
  START_EPOCH=$(date +%s)

  echo "[$i/$N_TASKS] [$STAMP] START $TASK_ID  log=$TASK_LOG" | tee -a "$MASTER_LOG"

  # Hard wall-clock timeout via `timeout` command to defend against bun hangs.
  set +e
  timeout --kill-after=30 --signal=TERM "$HARD_TIMEOUT_SEC" \
      "$HARNESS_DIR/run_biomnibench.sh" "$TASK_ID" "$MAX_ROUNDS" "$TIMEOUT_SECONDS" \
      > "$TASK_LOG" 2>&1
  rc=$?
  set -e

  END_EPOCH=$(date +%s)
  ELAPSED=$((END_EPOCH - START_EPOCH))
  SCORE=$(latest_score "$TASK_ID")
  SCORE_DISPLAY="${SCORE:-N/A}"

  case $rc in
    0)
      OK_COUNT=$((OK_COUNT + 1))
      echo "  OK [$TASK_ID] rc=0 score=$SCORE_DISPLAY elapsed=${ELAPSED}s" | tee -a "$MASTER_LOG"
      ;;
    124|137)
      FAIL_COUNT=$((FAIL_COUNT + 1))
      echo "  TIMEOUT [$TASK_ID] rc=$rc score=$SCORE_DISPLAY elapsed=${ELAPSED}s log=$TASK_LOG" | tee -a "$MASTER_LOG"
      ;;
    *)
      FAIL_COUNT=$((FAIL_COUNT + 1))
      echo "  FAIL [$TASK_ID] rc=$rc score=$SCORE_DISPLAY elapsed=${ELAPSED}s log=$TASK_LOG" | tee -a "$MASTER_LOG"
      ;;
  esac

  # Defensive: kill any zombie bun process for this task
  pkill -KILL -f "cli\.ts --task $TASK_ID" 2>/dev/null || true
done

{
  echo "=============================================="
  echo "Done at $(date)."
  echo "OK=$OK_COUNT  FAIL=$FAIL_COUNT  SKIP=$SKIP_COUNT  TOTAL=$N_TASKS"
  echo "=============================================="
} | tee -a "$MASTER_LOG"
