#!/bin/bash

echo "==================================="
echo "28481359 Re-run Monitor"
echo "==================================="
echo ""

# 检查进程状态
if ps -p 2601377 > /dev/null 2>&1; then
    echo "✅ Process Status: RUNNING (PID: 2601377)"
else
    echo "⏹️  Process Status: COMPLETED or STOPPED"
fi
echo ""

# 查找最新的运行目录
LATEST_DIR=$(find /home/yjh/my_claude/output/Bio_runs -name "28481359_incremental_*" -type d | sort | tail -1)

if [ -z "$LATEST_DIR" ]; then
    echo "❌ No run directory found yet"
    exit 0
fi

echo "📁 Run Directory: $LATEST_DIR"
echo ""

# 检查study_state.json
if [ -f "$LATEST_DIR/study_state.json" ]; then
    echo "📊 Current Progress:"
    python3 -c "
import json
with open('$LATEST_DIR/study_state.json') as f:
    state = json.load(f)
    print(f\"  Status: {state.get('status', 'unknown')}\"
    print(f\"  Completed: {state.get('completed_subtasks', 0)}/{state.get('num_subtasks', '?')} subtasks\")
    print(f\"  Passed: {state.get('passed_subtasks', 0)}\")
    print(f\"  Failed: {state.get('failed_subtasks', 0)}\")
    print()

    # 显示每个子任务的状态
    for st in state.get('subtasks', []):
        idx = st['subtask_index']
        status = st['status']
        rounds = len(st.get('rounds', []))
        icon = '✅' if status == 'passed' else '❌' if status == 'failed' else '🔄'
        print(f\"  {icon} Subtask {idx}: {status.upper()} ({rounds} rounds)\")

        # 显示最后一轮的错误
        if status == 'failed' and st.get('rounds'):
            last_round = st['rounds'][-1]
            error = last_round.get('error', 'Unknown error')
            if len(error) > 80:
                error = error[:77] + '...'
            print(f\"      Error: {error}\")
" 2>/dev/null || echo "  (Unable to parse state file)"
else
    echo "⏳ Waiting for run to start..."
fi

echo ""
echo "-----------------------------------"
echo "Recent log output:"
tail -20 /tmp/28481359_rerun.log 2>/dev/null || echo "(No log yet)"
