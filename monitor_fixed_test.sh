#!/bin/bash
# 监控修复后的测试进度

RESULT_DIR="/data/yjh/biodsbench-test-results-fixed"

while true; do
    clear
    echo "========================================"
    echo "BioDSBench 测试进度监控（修复后）"
    echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "========================================"
    echo ""

    # 找到最新的测试目录
    LATEST_DIR=$(ls -td $RESULT_DIR/25303977_* 2>/dev/null | head -1)

    if [ -z "$LATEST_DIR" ]; then
        echo "⏳ 等待测试开始..."
    else
        echo "📁 测试目录: $LATEST_DIR"
        echo ""

        # 统计已完成的子任务
        completed=0
        errors=0

        for i in {0..7}; do
            task_dir="$LATEST_DIR/25303977_${i}"
            if [ -d "$task_dir" ]; then
                if [ -f "$task_dir/result.json" ]; then
                    completed=$((completed + 1))
                    status=$(cat "$task_dir/result.json" | jq -r '.status')
                    tokens=$(cat "$task_dir/result.json" | jq '.total_tokens')
                    files=$(cat "$task_dir/result.json" | jq '.files_created | length')
                    echo "✅ 任务 $i: $status (${tokens} tokens, ${files} 文件)"
                elif [ -f "$task_dir/error.json" ]; then
                    errors=$((errors + 1))
                    error=$(cat "$task_dir/error.json" | jq -r '.error' | head -c 50)
                    echo "❌ 任务 $i: ERROR - ${error}..."
                else
                    echo "⏳ 任务 $i: 执行中..."
                fi
            fi
        done

        echo ""
        echo "========================================"
        echo "进度: $completed/8 完成, $errors 错误"
        echo "========================================"

        # 如果有错误且stop_on_error，说明已停止
        if [ $errors -gt 0 ]; then
            echo ""
            echo "⚠️  检测到错误，测试已停止"
            echo "查看错误详情:"
            echo "  cat $LATEST_DIR/25303977_*/error.json"
            break
        fi

        # 如果全部完成，显示总结
        if [ $completed -eq 8 ]; then
            echo ""
            echo "🎉 测试完成！"
            if [ -f "$LATEST_DIR/study_summary.json" ]; then
                echo ""
                echo "总结:"
                cat "$LATEST_DIR/study_summary.json" | jq '{
                    total_subtasks,
                    passed,
                    failed,
                    success_rate
                }'
            fi
            break
        fi
    fi

    echo ""
    echo "按 Ctrl+C 退出监控"
    sleep 10
done
