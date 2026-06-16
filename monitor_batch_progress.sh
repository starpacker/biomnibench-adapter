#!/bin/bash
# 监控批量测试进度

OUTPUT_FILE="/tmp/claude-1046/-home-yjh/cef0d5ca-0963-45ba-81f1-627967a68987/tasks/b2rzwhf8i.output"

echo "监控批量测试进度"
echo "===================="
echo ""

while true; do
    if [ ! -f "$OUTPUT_FILE" ]; then
        echo "等待输出文件..."
        sleep 10
        continue
    fi

    # 提取当前任务
    CURRENT=$(grep -o "\[.*\] 运行任务: .*" "$OUTPUT_FILE" | tail -1)

    # 统计完成情况
    COMPLETED=$(grep -c "✅ 任务完成:" "$OUTPUT_FILE" || echo 0)
    FAILED=$(grep -c "❌ 任务失败:" "$OUTPUT_FILE" || echo 0)

    # 显示进度
    clear
    echo "========================================================================"
    echo "BioMniBench 批量测试进度监控"
    echo "========================================================================"
    echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    echo "当前: $CURRENT"
    echo ""
    echo "统计:"
    echo "  ✅ 完成: $COMPLETED"
    echo "  ❌ 失败: $FAILED"
    echo "  📊 总计: $((COMPLETED + FAILED))/52"
    echo ""
    echo "========================================================================"
    echo ""
    echo "最近输出:"
    tail -20 "$OUTPUT_FILE" | grep -E "运行任务|任务完成|任务失败|Judge 评分|当前进度" | tail -10
    echo ""

    # 检查是否完成
    if grep -q "批量测试完成" "$OUTPUT_FILE"; then
        echo ""
        echo "✅ 所有任务已完成！"
        echo ""
        grep -A 20 "批量测试完成" "$OUTPUT_FILE"
        break
    fi

    sleep 30
done
