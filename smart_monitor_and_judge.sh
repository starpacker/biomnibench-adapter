#!/bin/bash
# 智能监控：等待测试完成，提取输出文件，运行 LLM Judge

set -e

echo "=========================================="
echo "智能监控 + 自动评分流程"
echo "=========================================="
echo ""

TASK_NAME="da-1-3"
RESULTS_DIR="/data/yjh/biomnibench-results/da-1-3/20260607_170927"
LOG_FILE="$RESULTS_DIR/da-1-3_log.md"
TASK_DIR="/data/yjh/biomnibench-organized/da-1-3"
RUBRIC_FILE="$TASK_DIR/evaluation/rubric.txt"

# QWEN 配置
export QWEN_MODEL="Vendor3/qwen3.5-plus"
export QWEN_BASE_URL="https://api.gpugeek.com/v1"
export QWEN_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"

echo "配置:"
echo "  任务: $TASK_NAME"
echo "  日志: $LOG_FILE"
echo "  Judge 模型: $QWEN_MODEL"
echo ""

# 等待测试完成
echo "监控测试进度..."
PREV_SIZE=0
STABLE_COUNT=0

while true; do
    if [ ! -f "$LOG_FILE" ]; then
        echo "等待日志文件创建..."
        sleep 10
        continue
    fi

    CURRENT_SIZE=$(wc -c < "$LOG_FILE")

    if [ $CURRENT_SIZE -eq $PREV_SIZE ]; then
        STABLE_COUNT=$((STABLE_COUNT + 1))
        echo "$(date '+%H:%M:%S') - 日志大小稳定 ($STABLE_COUNT/6): $CURRENT_SIZE 字节"

        # 如果大小连续 6 次（1 分钟）没变化，认为完成
        if [ $STABLE_COUNT -ge 6 ]; then
            echo ""
            echo "✅ 测试已完成（日志大小稳定）"
            break
        fi
    else
        STABLE_COUNT=0
        echo "$(date '+%H:%M:%S') - 测试进行中: $CURRENT_SIZE 字节"
    fi

    PREV_SIZE=$CURRENT_SIZE
    sleep 10
done

echo ""
echo "=========================================="
echo "从日志中提取输出内容"
echo "=========================================="
echo ""

# 创建临时目录存放提取的文件
EXTRACT_DIR="$RESULTS_DIR/extracted"
mkdir -p "$EXTRACT_DIR"

# 从日志中提取 trace.md 和 answer.txt 的内容
# 这些内容在日志中以特定格式记录

# 方法：查找工作空间路径
WORKSPACE=$(grep -o "/tmp/imaging101-local-[a-z0-9]*" "$LOG_FILE" | head -1)

if [ -n "$WORKSPACE" ] && [ -d "$WORKSPACE" ]; then
    echo "找到工作空间: $WORKSPACE"

    if [ -f "$WORKSPACE/trace.md" ]; then
        cp "$WORKSPACE/trace.md" "$EXTRACT_DIR/"
        echo "✅ 复制 trace.md ($(wc -l < "$WORKSPACE/trace.md") 行)"
    fi

    if [ -f "$WORKSPACE/answer.txt" ]; then
        cp "$WORKSPACE/answer.txt" "$EXTRACT_DIR/"
        echo "✅ 复制 answer.txt ($(wc -l < "$WORKSPACE/answer.txt") 行)"
    fi
fi

# 检查是否成功提取
TRACE_FILE="$EXTRACT_DIR/trace.md"
ANSWER_FILE="$EXTRACT_DIR/answer.txt"

if [ ! -f "$TRACE_FILE" ]; then
    echo ""
    echo "⚠️  未找到 trace.md，尝试从日志中重建..."

    # 尝试从日志提取（如果文件格式允许）
    # 这里可以添加更复杂的提取逻辑
    echo "❌ 无法自动提取 trace.md"
    echo "请手动检查工作空间: $WORKSPACE"
    exit 1
fi

if [ ! -f "$ANSWER_FILE" ]; then
    echo "❌ 无法自动提取 answer.txt"
    exit 1
fi

echo ""
echo "✅ 输出文件已准备:"
echo "  trace.md: $(wc -l < "$TRACE_FILE") 行, $(wc -c < "$TRACE_FILE") 字节"
echo "  answer.txt: $(wc -l < "$ANSWER_FILE") 行, $(wc -c < "$ANSWER_FILE") 字节"
echo ""

# 运行 LLM Judge
echo "=========================================="
echo "开始 LLM Judge 评分..."
echo "=========================================="
echo ""

JUDGE_OUTPUT="$RESULTS_DIR/judge_score.json"

python3 /home/yjh/my_claude/llm_judge_qwen.py \
    "$TRACE_FILE" \
    "$ANSWER_FILE" \
    "$RUBRIC_FILE" \
    "$JUDGE_OUTPUT"

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✅ 评分完成！"
    echo "=========================================="
    echo ""

    if [ -f "$JUDGE_OUTPUT" ]; then
        cat "$JUDGE_OUTPUT" | python3 -m json.tool
    fi
else
    echo ""
    echo "❌ LLM Judge 执行失败"
    exit 1
fi
