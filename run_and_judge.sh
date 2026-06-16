#!/bin/bash
# 完整的任务测试和评分自动化脚本

set -e  # 遇到错误立即退出

TASK_NAME="$1"
if [ -z "$TASK_NAME" ]; then
    echo "用法: $0 <task_name>"
    echo "示例: $0 da-1-3"
    exit 1
fi

echo "=========================================="
echo "自动化测试和评分: $TASK_NAME"
echo "=========================================="

# 配置
TASK_DIR="/data/yjh/biomnibench-organized/$TASK_NAME"
RESULTS_DIR="/data/yjh/biomnibench-results/$TASK_NAME"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RUN_DIR="$RESULTS_DIR/$TIMESTAMP"

# 环境变量
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-00gcclg9l39y9p01000dhjzolag1q2hk00901kh1}"
export QWEN_API_KEY="${QWEN_API_KEY:-00gcclg9l39y9p01000dhjzolag1q2hk00901kh1}"
export QWEN_BASE_URL="${QWEN_BASE_URL:-https://api.gpugeek.com/v1}"
export QWEN_MODEL="${QWEN_MODEL:-Qwen/Qwen2.5-72B-Instruct}"

echo ""
echo "配置信息:"
echo "  任务目录: $TASK_DIR"
echo "  结果目录: $RUN_DIR"
echo "  QWEN 模型: $QWEN_MODEL"
echo "  API 端点: $QWEN_BASE_URL"
echo ""

# 检查任务目录
if [ ! -d "$TASK_DIR" ]; then
    echo "❌ 错误: 任务目录不存在: $TASK_DIR"
    exit 1
fi

# 创建结果目录
mkdir -p "$RUN_DIR"

# ========================================
# 第一步: 运行任务
# ========================================
echo "=========================================="
echo "步骤 1: 运行任务"
echo "=========================================="

cd /home/yjh/my_claude

python3 run_task_with_output_save.py > "$RUN_DIR/task_execution.log" 2>&1

if [ $? -ne 0 ]; then
    echo "❌ 任务执行失败"
    cat "$RUN_DIR/task_execution.log"
    exit 1
fi

echo "✅ 任务执行完成"

# ========================================
# 第二步: 查找输出文件
# ========================================
echo ""
echo "=========================================="
echo "步骤 2: 查找输出文件"
echo "=========================================="

# 查找最新的结果目录
LATEST_RUN=$(ls -td "$RESULTS_DIR"/*/ 2>/dev/null | head -1)

if [ -z "$LATEST_RUN" ]; then
    echo "❌ 错误: 未找到结果目录"
    exit 1
fi

echo "结果目录: $LATEST_RUN"

TRACE_FILE="$LATEST_RUN/trace.md"
ANSWER_FILE="$LATEST_RUN/answer.txt"
RUBRIC_FILE="$TASK_DIR/evaluation/rubric.txt"
JUDGE_OUTPUT="$LATEST_RUN/judge_score.json"

echo "  trace.md: $TRACE_FILE"
echo "  answer.txt: $ANSWER_FILE"
echo "  rubric.txt: $RUBRIC_FILE"

# 检查文件是否存在
if [ ! -f "$TRACE_FILE" ]; then
    echo "⚠️  警告: trace.md 未找到"
fi

if [ ! -f "$ANSWER_FILE" ]; then
    echo "⚠️  警告: answer.txt 未找到"
fi

if [ ! -f "$RUBRIC_FILE" ]; then
    echo "❌ 错误: rubric.txt 未找到"
    exit 1
fi

if [ ! -f "$TRACE_FILE" ] && [ ! -f "$ANSWER_FILE" ]; then
    echo "❌ 错误: 没有输出文件可供评估"
    exit 1
fi

# ========================================
# 第三步: 运行 LLM Judge
# ========================================
echo ""
echo "=========================================="
echo "步骤 3: 运行 LLM Judge"
echo "=========================================="
echo "使用模型: $QWEN_MODEL"
echo ""

python3 /home/yjh/my_claude/llm_judge_qwen.py \
    "$TRACE_FILE" \
    "$ANSWER_FILE" \
    "$RUBRIC_FILE" \
    "$JUDGE_OUTPUT"

if [ $? -ne 0 ]; then
    echo "❌ LLM Judge 执行失败"
    exit 1
fi

# ========================================
# 第四步: 显示结果
# ========================================
echo ""
echo "=========================================="
echo "最终结果"
echo "=========================================="

if [ -f "$JUDGE_OUTPUT" ]; then
    echo ""
    cat "$JUDGE_OUTPUT"
    echo ""

    # 提取分数
    SCORE=$(grep -o '"total_score": [0-9]*' "$JUDGE_OUTPUT" | head -1 | grep -o '[0-9]*')

    if [ ! -z "$SCORE" ]; then
        echo "=========================================="
        echo "🎯 总分: $SCORE / 100"
        echo "=========================================="

        if [ "$SCORE" -ge 80 ]; then
            echo "✅ 优秀!"
        elif [ "$SCORE" -ge 70 ]; then
            echo "✅ 良好"
        elif [ "$SCORE" -ge 60 ]; then
            echo "⚠️  及格"
        else
            echo "❌ 需要改进"
        fi
    fi
else
    echo "❌ 评分结果文件未生成"
    exit 1
fi

echo ""
echo "所有文件保存在: $LATEST_RUN"
echo "  - task_execution.log (任务执行日志)"
echo "  - trace.md (分析追踪)"
echo "  - answer.txt (最终答案)"
echo "  - judge_score.json (评分结果)"
echo ""
