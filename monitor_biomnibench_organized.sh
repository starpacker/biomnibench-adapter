#!/bin/bash
# 监控 biomnibench-organized 测评进度

RESULTS_DIR="/data/yjh/biomnibench-organized-results"

echo "=========================================="
echo "BioMniBench-Organized 测评进度监控"
echo "=========================================="
echo ""

# 查找最新的 summary 文件
LATEST_SUMMARY=$(ls -t "$RESULTS_DIR"/summary_*.json 2>/dev/null | head -1)

if [ -z "$LATEST_SUMMARY" ]; then
    echo "❌ 未找到测评结果文件"
    echo ""
    echo "请先运行测评:"
    echo "  cd /home/yjh/my_claude"
    echo "  ./run_biomnibench_organized.sh"
    exit 1
fi

echo "📊 最新结果文件: $(basename "$LATEST_SUMMARY")"
echo ""

# 解析 JSON 并显示统计信息
if command -v jq &> /dev/null; then
    echo "统计信息:"
    echo "----------------------------------------"
    jq -r '
        "模型: \(.model)",
        "Judge: \(.judge)",
        "总任务数: \(.total)",
        "已完成: \(.completed)",
        "成功: \(.passed)",
        "失败: \(.failed)",
        "错误: \(.errors)",
        "进度: \((.completed / .total * 100) | floor)%",
        "成功率: \(if .completed > 0 then (.passed / .completed * 100) else 0 end | floor)%"
    ' "$LATEST_SUMMARY"
    echo ""
    
    echo "最近完成的任务:"
    echo "----------------------------------------"
    jq -r '.results[-5:] | .[] | 
        if .status == "success" then
            "✅ \(.task_name) - \(.duration | floor)秒 - 得分: \(.judge_result.total_score // "N/A")"
        elif .status == "failed" then
            "❌ \(.task_name) - \(.duration | floor)秒"
        elif .status == "timeout" then
            "⏱️  \(.task_name) - 超时"
        else
            "⚠️  \(.task_name) - \(.error)"
        end
    ' "$LATEST_SUMMARY"
    
else
    # 没有 jq，使用 Python
    python3 << 'EOF'
import json
import sys

with open(sys.argv[1]) as f:
    data = json.load(f)

print("统计信息:")
print("-" * 40)
print(f"模型: {data.get('model', 'N/A')}")
print(f"Judge: {data.get('judge', 'N/A')}")
print(f"总任务数: {data.get('total', 0)}")
print(f"已完成: {data.get('completed', 0)}")
print(f"成功: {data.get('passed', 0)}")
print(f"失败: {data.get('failed', 0)}")
print(f"错误: {data.get('errors', 0)}")
if data.get('total', 0) > 0:
    print(f"进度: {data.get('completed', 0) / data.get('total', 1) * 100:.0f}%")
if data.get('completed', 0) > 0:
    print(f"成功率: {data.get('passed', 0) / data.get('completed', 1) * 100:.0f}%")
print()

print("最近完成的任务:")
print("-" * 40)
for result in data.get('results', [])[-5:]:
    task_name = result.get('task_name', 'N/A')
    status = result.get('status', 'unknown')
    duration = result.get('duration', 0)
    
    if status == 'success':
        score = result.get('judge_result', {}).get('total_score', 'N/A')
        print(f"✅ {task_name} - {duration:.0f}秒 - 得分: {score}")
    elif status == 'failed':
        print(f"❌ {task_name} - {duration:.0f}秒")
    elif status == 'timeout':
        print(f"⏱️  {task_name} - 超时")
    else:
        error = result.get('error', 'Unknown error')
        print(f"⚠️  {task_name} - {error}")
EOF
    python3 -c "import sys; exec(open('/dev/stdin').read())" "$LATEST_SUMMARY"
fi

echo ""
echo "----------------------------------------"
echo "实时日志文件:"
LATEST_LOG=$(ls -t "$RESULTS_DIR"/*_output.log 2>/dev/null | head -1)
if [ -n "$LATEST_LOG" ]; then
    echo "  tail -f $(basename "$LATEST_LOG")"
fi

echo ""
echo "查看完整结果:"
echo "  cat $LATEST_SUMMARY | jq"
echo ""
