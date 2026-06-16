#!/bin/bash
# 自动化流程：等待测试完成后立即运行 LLM Judge

echo "=========================================="
echo "自动化测试 + LLM Judge 流程"
echo "=========================================="

# 配置
TASK_NAME="da-1-3"
TASK_DIR="/data/yjh/biomnibench-organized/da-1-3"
RESULTS_BASE="/data/yjh/biomnibench-results"
QWEN_MODEL="Vendor3/qwen3.5-plus"
QWEN_BASE_URL="https://api.gpugeek.com/v1"
QWEN_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"

echo ""
echo "配置:"
echo "  任务: $TASK_NAME"
echo "  Judge 模型: $QWEN_MODEL"
echo ""

# 等待测试完成
echo "等待测试完成..."
echo ""

# 监控测试进程
PYTHON_PID=$(ps aux | grep "run_task_with_output_save.py" | grep -v grep | awk '{print $2}')

if [ -z "$PYTHON_PID" ]; then
    echo "错误: 未找到测试进程"
    exit 1
fi

echo "测试进程 PID: $PYTHON_PID"
echo ""

# 等待进程完成
while kill -0 $PYTHON_PID 2>/dev/null; do
    sleep 30
    echo "$(date '+%H:%M:%S') - 测试仍在运行..."
done

echo ""
echo "✅ 测试已完成!"
echo ""

# 查找最新的结果目录
LATEST_RESULT_DIR=$(ls -td $RESULTS_BASE/$TASK_NAME/*/ 2>/dev/null | head -1)

if [ -z "$LATEST_RESULT_DIR" ]; then
    echo "❌ 错误: 未找到结果目录"
    exit 1
fi

echo "结果目录: $LATEST_RESULT_DIR"
echo ""

# 检查输出文件
TRACE_FILE="$LATEST_RESULT_DIR/trace.md"
ANSWER_FILE="$LATEST_RESULT_DIR/answer.txt"
RUBRIC_FILE="$TASK_DIR/evaluation/rubric.txt"

if [ ! -f "$TRACE_FILE" ]; then
    echo "❌ 错误: 未找到 trace.md"
    exit 1
fi

if [ ! -f "$ANSWER_FILE" ]; then
    echo "❌ 错误: 未找到 answer.txt"
    exit 1
fi

if [ ! -f "$RUBRIC_FILE" ]; then
    echo "❌ 错误: 未找到 rubric.txt"
    exit 1
fi

echo "✅ 输出文件已确认:"
echo "  trace.md: $(wc -l < "$TRACE_FILE") 行"
echo "  answer.txt: $(wc -l < "$ANSWER_FILE") 行"
echo ""

# 运行 LLM Judge
echo "=========================================="
echo "开始 LLM Judge 评分..."
echo "=========================================="
echo ""

JUDGE_OUTPUT="$LATEST_RESULT_DIR/judge_score.json"

export QWEN_MODEL="$QWEN_MODEL"
export QWEN_BASE_URL="$QWEN_BASE_URL"
export QWEN_API_KEY="$QWEN_API_KEY"

python3 /home/yjh/my_claude/llm_judge_qwen.py \
    "$TRACE_FILE" \
    "$ANSWER_FILE" \
    "$RUBRIC_FILE" \
    "$JUDGE_OUTPUT"

JUDGE_EXIT_CODE=$?

echo ""
if [ $JUDGE_EXIT_CODE -eq 0 ]; then
    echo "=========================================="
    echo "✅ LLM Judge 评分完成!"
    echo "=========================================="
    echo ""

    if [ -f "$JUDGE_OUTPUT" ]; then
        echo "评分结果:"
        cat "$JUDGE_OUTPUT" | python3 -m json.tool
        echo ""

        # 提取总分
        TOTAL_SCORE=$(cat "$JUDGE_OUTPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('total_score', 'N/A'))" 2>/dev/null)
        echo ""
        echo "=========================================="
        echo "总分: $TOTAL_SCORE / 100"
        echo "=========================================="
    fi
else
    echo "=========================================="
    echo "❌ LLM Judge 执行失败"
    echo "=========================================="
    exit 1
fi
