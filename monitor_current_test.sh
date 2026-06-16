#!/bin/bash
# 监控当前测试进度

OUTPUT_FILE="/tmp/claude-1046/-home-yjh/cef0d5ca-0963-45ba-81f1-627967a68987/tasks/bk2k5wihs.output"

echo "监控测试进度: da-1-3"
echo "输出文件: $OUTPUT_FILE"
echo ""

while true; do
    if [ ! -f "$OUTPUT_FILE" ]; then
        echo "等待测试启动..."
        sleep 5
        continue
    fi

    LINES=$(wc -l < "$OUTPUT_FILE" 2>/dev/null || echo 0)
    SIZE=$(du -h "$OUTPUT_FILE" 2>/dev/null | cut -f1 || echo "0")

    # 检查是否完成
    if grep -q "========================================" "$OUTPUT_FILE" | tail -1 | grep -q "结果:"; then
        echo ""
        echo "✅ 测试完成!"
        tail -20 "$OUTPUT_FILE"
        break
    fi

    # 显示进度
    echo "$(date '+%H:%M:%S') - 进度: $LINES 行, $SIZE"

    # 显示最新内容
    tail -3 "$OUTPUT_FILE" | head -1

    sleep 30
done

echo ""
echo "查看完整输出:"
echo "  cat $OUTPUT_FILE"
