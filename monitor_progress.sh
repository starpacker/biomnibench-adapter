#!/bin/bash
#
# 监控批量评估进度
#

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║                                                                    ║"
echo "║           BioDSBench 批量评估 - 实时监控                           ║"
echo "║                                                                    ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

# 检查进程
echo "=== 运行状态 ==="
if ps aux | grep -E "run_all_combined_tasks.sh" | grep -v grep > /dev/null; then
    echo "✅ 批量评估正在运行"
    PID=$(ps aux | grep -E "run_all_combined_tasks.sh" | grep -v grep | awk '{print $2}' | head -1)
    echo "   PID: $PID"
else
    echo "❌ 批量评估未运行"
fi
echo ""

# 检查批次日志
echo "=== 批次进度 ==="
BATCH_LOG=$(ls -t logs/batch_runs/batch_run_*.log 2>/dev/null | head -1)
if [ -f "$BATCH_LOG" ]; then
    echo "批次日志: $BATCH_LOG"
    echo ""
    echo "已完成任务:"
    grep "✅" "$BATCH_LOG" 2>/dev/null | tail -5
    echo ""
    echo "失败任务:"
    grep "❌" "$BATCH_LOG" 2>/dev/null | tail -5
else
    echo "批次日志尚未创建"
fi
echo ""

# 检查当前运行的任务
echo "=== 当前任务 ==="
if [ -f "batch_run.log" ]; then
    CURRENT_TASK=$(grep -E "\[.*\] 开始运行:" batch_run.log | tail -1)
    if [ -n "$CURRENT_TASK" ]; then
        echo "$CURRENT_TASK"
    else
        echo "正在初始化..."
    fi
else
    echo "主日志尚未创建"
fi
echo ""

# 显示最新日志
echo "=== 最新日志（最后20行）==="
if [ -f "batch_run.log" ]; then
    tail -20 batch_run.log
else
    echo "日志文件不存在"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "监控命令:"
echo "  实时日志: tail -f batch_run.log"
echo "  批次日志: tail -f $BATCH_LOG"
echo "  停止评估: kill $PID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
