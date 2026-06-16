#!/bin/bash
# 查看BioDSBench测试结果的脚本

RESULT_DIR="/data/yjh/biodsbench-test-results/25303977_20260607_013212"

echo "========================================"
echo "BioDSBench 测试结果总结"
echo "========================================"
echo ""

# 查找study_summary.json
if [ -f "$RESULT_DIR/study_summary.json" ]; then
    echo "📊 母任务总结:"
    cat "$RESULT_DIR/study_summary.json" | jq '{
        study_id,
        total_subtasks,
        passed,
        failed,
        success_rate
    }'
    echo ""
fi

# 统计子任务
echo "📋 子任务详情:"
echo ""
completed=0
for subtask in $(ls -1d $RESULT_DIR/25303977_* 2>/dev/null | sort); do
    task_name=$(basename $subtask)

    if [ -f "$subtask/result.json" ]; then
        completed=$((completed + 1))
        echo "[$completed] $task_name"

        # 提取关键信息
        cat "$subtask/result.json" | jq '{
            status,
            iterations,
            tokens: .total_tokens,
            time: (.wall_time_seconds | tostring + "s"),
            files: (.files_created | length)
        }'
        echo ""
    fi
done

echo "========================================"
echo "总计: $completed / 8 子任务完成"
echo "========================================"
echo ""

# 统计Token使用
if [ $completed -gt 0 ]; then
    echo "💰 Token使用统计:"
    total_tokens=0
    for subtask in $(ls -1d $RESULT_DIR/25303977_* 2>/dev/null); do
        if [ -f "$subtask/result.json" ]; then
            tokens=$(cat "$subtask/result.json" | jq '.total_tokens')
            total_tokens=$((total_tokens + tokens))
        fi
    done
    echo "  总Token数: $total_tokens"
    echo "  平均每任务: $((total_tokens / completed))"
    echo ""
fi

# 统计时间
if [ $completed -gt 0 ]; then
    echo "⏱️  时间统计:"
    total_time=0
    for subtask in $(ls -1d $RESULT_DIR/25303977_* 2>/dev/null); do
        if [ -f "$subtask/result.json" ]; then
            time=$(cat "$subtask/result.json" | jq '.wall_time_seconds')
            total_time=$(echo "$total_time + $time" | bc)
        fi
    done
    echo "  总时间: ${total_time}秒 ($(echo "scale=1; $total_time / 60" | bc)分钟)"
    avg_time=$(echo "scale=1; $total_time / $completed" | bc)
    echo "  平均每任务: ${avg_time}秒"
    echo ""
fi

echo "========================================"
echo "详细结果位置: $RESULT_DIR"
echo "========================================"
