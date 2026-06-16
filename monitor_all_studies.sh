#!/bin/bash
# 监控全部13个母任务的测评进度

OUTPUT_DIR="/data/yjh/biodsbench-all-studies"

while true; do
    clear
    echo "========================================"
    echo "BioDSBench 全部13个母任务测评进度"
    echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "========================================"
    echo ""

    # 查找最新的总结文件
    SUMMARY_FILE=$(ls -t "$OUTPUT_DIR"/all_studies_summary_*.json 2>/dev/null | head -1)

    if [ -z "$SUMMARY_FILE" ]; then
        echo "⏳ 等待测评开始..."
    else
        echo "📊 总结文件: $(basename $SUMMARY_FILE)"
        echo ""

        # 读取进度
        completed=$(cat "$SUMMARY_FILE" | jq '.completed')
        total=$(cat "$SUMMARY_FILE" | jq '.total_studies')

        echo "总进度: $completed/$total"
        echo ""

        # 显示已完成的母任务
        echo "已完成的母任务:"
        cat "$SUMMARY_FILE" | jq -r '.results[] | "\(.index). \(.study_id): \(if .success then "✅" else "❌" end)"'

        echo ""
        echo "========================================"

        # 检查是否全部完成
        if [ $completed -eq $total ]; then
            succeeded=$(cat "$SUMMARY_FILE" | jq '.succeeded // (.results | map(select(.success)) | length)')
            failed=$(cat "$SUMMARY_FILE" | jq '.failed // (.results | map(select(.success | not)) | length)')

            echo "🎉 测评完成！"
            echo "成功: $succeeded/$total"
            echo "失败: $failed/$total"

            if [ $failed -gt 0 ]; then
                echo ""
                echo "失败的母任务:"
                cat "$SUMMARY_FILE" | jq -r '.results[] | select(.success | not) | "\(.study_id)"'
            fi

            break
        fi

        # 检查是否有失败并停止
        last_success=$(cat "$SUMMARY_FILE" | jq -r '.results[-1].success')
        if [ "$last_success" = "false" ]; then
            stopped_at=$(cat "$SUMMARY_FILE" | jq -r '.stopped_at // .results[-1].study_id')
            echo ""
            echo "⚠️  在母任务 $stopped_at 处停止"
            break
        fi
    fi

    echo ""
    echo "按 Ctrl+C 退出监控"
    sleep 30
done
