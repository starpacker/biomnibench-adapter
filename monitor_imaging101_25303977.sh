#!/bin/bash
# 监控 BioDSBench-imaging101 串行测评进度

RESULTS_DIR="/data/yjh/imaging101_serial_results"

echo "=========================================="
echo "BioDSBench-Imaging101 串行测评进度监控"
echo "=========================================="
echo ""

# 查找最新的运行目录
LATEST_RUN=$(ls -td "$RESULTS_DIR"/25303977_serial_* 2>/dev/null | head -1)

if [ -z "$LATEST_RUN" ]; then
    echo "❌ 未找到测评运行记录"
    echo ""
    echo "请先运行测评:"
    echo "  cd /home/yjh/my_claude"
    echo "  ./start_imaging101_25303977.sh"
    exit 1
fi

echo "📂 运行目录: $(basename "$LATEST_RUN")"
echo ""

# 查看状态文件
STATE_FILE="$LATEST_RUN/evaluation_state.json"

if [ ! -f "$STATE_FILE" ]; then
    echo "❌ 状态文件不存在，测评可能尚未开始"
    exit 1
fi

echo "统计信息:"
echo "----------------------------------------"

# 使用 Python 解析 JSON
python3 << 'EOF' "$STATE_FILE"
import json
import sys
from datetime import datetime

with open(sys.argv[1]) as f:
    state = json.load(f)

print(f"模型: {state.get('model', 'N/A')}")
print(f"母任务: {state.get('study_id', 'N/A')}")
print(f"任务范围: {state.get('start_idx', 0)} ~ {state.get('end_idx', 7)}")
print(f"状态: {state.get('status', 'unknown')}")
print()

total = state.get('end_idx', 7) - state.get('start_idx', 0) + 1
completed = state.get('completed_tasks', 0)
passed = state.get('passed_tasks', 0)
failed = state.get('failed_tasks', 0)

print(f"已完成: {completed}/{total}")
print(f"通过: {passed}/{total}")
print(f"失败: {failed}/{total}")
if completed > 0:
    print(f"成功率: {passed/completed*100:.1f}%")

print()
print("任务详情:")
print("-" * 60)

for task in state.get('tasks', []):
    task_id = task.get('task_id', 'N/A')
    status = task.get('status', 'unknown')
    rounds = len(task.get('rounds', []))
    
    status_icon = "✅" if status == "passed" else "❌"
    print(f"{status_icon} {task_id} - {status} (尝试了 {rounds} 轮)")
    
    # 显示最后一轮的错误（如果有）
    if status != "passed" and task.get('rounds'):
        last_round = task['rounds'][-1]
        error = last_round.get('error', 'Unknown error')
        if error:
            # 只显示前100个字符
            error_preview = error[:100] + "..." if len(error) > 100 else error
            print(f"   错误: {error_preview}")

print()

# 计算运行时间
if state.get('start_time'):
    start = datetime.fromisoformat(state['start_time'])
    if state.get('end_time'):
        end = datetime.fromisoformat(state['end_time'])
    else:
        end = datetime.now()
    duration = end - start
    hours = duration.total_seconds() / 3600
    print(f"运行时间: {hours:.2f} 小时")

EOF

echo ""
echo "----------------------------------------"
echo "查看完整状态:"
echo "  cat $STATE_FILE | python3 -m json.tool"
echo ""
echo "查看最新日志:"
LATEST_LOG=$(ls -t "$RESULTS_DIR"/*.log 2>/dev/null | head -1)
if [ -n "$LATEST_LOG" ]; then
    echo "  tail -f $LATEST_LOG"
fi
echo ""
echo "查看任务目录:"
echo "  ls -la $LATEST_RUN/"
echo ""
