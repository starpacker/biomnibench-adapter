#!/bin/bash
# 逐个运行所有 BioMniBench 任务，task-by-task

set -e

BASE_DIR="/data/yjh/biomnibench-organized"
RESULTS_DIR="/data/yjh/biomnibench-results"
SCRIPT_DIR="/home/yjh/my_claude"

# API 配置
export ANTHROPIC_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
export QWEN_MODEL="Vendor3/qwen3.5-plus"
export QWEN_BASE_URL="https://api.gpugeek.com/v1"
export QWEN_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"

# 获取所有任务
TASKS=($(ls "$BASE_DIR" | grep -E "^(da-|conventional)" | sort))
TOTAL=${#TASKS[@]}

echo "========================================================================"
echo "BioMniBench 批量测试 - Task-by-Task"
echo "========================================================================"
echo "总任务数: $TOTAL"
echo "开始时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================================================"
echo ""

# 创建总结文件
SUMMARY_FILE="$RESULTS_DIR/batch_summary_$(date '+%Y%m%d_%H%M%S').txt"
echo "批量测试总结" > "$SUMMARY_FILE"
echo "开始时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

COMPLETED=0
FAILED=0
SUCCESS_LIST=()
FAILED_LIST=()

# 逐个运行任务
for i in "${!TASKS[@]}"; do
    TASK="${TASKS[$i]}"
    TASK_NUM=$((i + 1))

    echo ""
    echo "========================================================================"
    echo "[$TASK_NUM/$TOTAL] 运行任务: $TASK"
    echo "========================================================================"
    echo "开始时间: $(date '+%H:%M:%S')"

    # 运行单个任务
    START_TIME=$(date +%s)

    if bash "$SCRIPT_DIR/test_single_biomnibench.sh" "$TASK" 2>&1 | tee "/tmp/test_${TASK}.log"; then
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))

        echo ""
        echo "✅ 任务完成: $TASK (耗时: ${DURATION}秒)"

        # 记录到总结
        echo "✅ [$TASK_NUM/$TOTAL] $TASK - 成功 (${DURATION}秒)" >> "$SUMMARY_FILE"

        COMPLETED=$((COMPLETED + 1))
        SUCCESS_LIST+=("$TASK")

        # 查找最新结果目录
        LATEST_DIR=$(ls -td "$RESULTS_DIR/$TASK"/*/ 2>/dev/null | head -1)

        if [ -n "$LATEST_DIR" ]; then
            # 检查输出文件
            if [ -f "$LATEST_DIR/trace.md" ] && [ -f "$LATEST_DIR/answer.txt" ]; then
                echo "  ✓ 输出文件已保存"

                # 运行 LLM Judge（如果有 rubric）
                RUBRIC="$BASE_DIR/$TASK/evaluation/rubric.txt"
                if [ -f "$RUBRIC" ]; then
                    echo "  运行 LLM Judge..."

                    if python3 "$SCRIPT_DIR/llm_judge_qwen.py" \
                        "$LATEST_DIR/trace.md" \
                        "$LATEST_DIR/answer.txt" \
                        "$RUBRIC" \
                        "$LATEST_DIR/judge_score.json" 2>&1 | grep -E "Total Score|Error"; then

                        # 提取分数
                        if [ -f "$LATEST_DIR/judge_score.json" ]; then
                            SCORE=$(python3 -c "import json; print(json.load(open('$LATEST_DIR/judge_score.json'))['total_score'])" 2>/dev/null || echo "N/A")
                            echo "  ✓ Judge 评分: $SCORE/100"
                            echo "    Judge 评分: $SCORE/100" >> "$SUMMARY_FILE"
                        fi
                    else
                        echo "  ⚠ Judge 评分失败"
                        echo "    Judge 评分: 失败" >> "$SUMMARY_FILE"
                    fi
                else
                    echo "  ⚠ 无 rubric 文件，跳过 Judge"
                fi
            else
                echo "  ⚠ 输出文件缺失"
                echo "    输出文件: 缺失" >> "$SUMMARY_FILE"
            fi
        fi

    else
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))

        echo ""
        echo "❌ 任务失败: $TASK (耗时: ${DURATION}秒)"

        # 记录到总结
        echo "❌ [$TASK_NUM/$TOTAL] $TASK - 失败 (${DURATION}秒)" >> "$SUMMARY_FILE"

        FAILED=$((FAILED + 1))
        FAILED_LIST+=("$TASK")
    fi

    echo "========================================================================"
    echo "当前进度: $COMPLETED 成功, $FAILED 失败 (剩余 $((TOTAL - TASK_NUM)) 个)"
    echo "========================================================================"

    # 短暂休息，避免 API 过载
    if [ $TASK_NUM -lt $TOTAL ]; then
        echo "等待 10 秒后继续..."
        sleep 10
    fi
done

# 最终总结
echo ""
echo "========================================================================"
echo "批量测试完成"
echo "========================================================================"
echo "总任务数: $TOTAL"
echo "成功: $COMPLETED"
echo "失败: $FAILED"
echo "完成时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================================================"

# 写入总结文件
echo "" >> "$SUMMARY_FILE"
echo "======================================================================" >> "$SUMMARY_FILE"
echo "最终统计" >> "$SUMMARY_FILE"
echo "======================================================================" >> "$SUMMARY_FILE"
echo "总任务数: $TOTAL" >> "$SUMMARY_FILE"
echo "成功: $COMPLETED" >> "$SUMMARY_FILE"
echo "失败: $FAILED" >> "$SUMMARY_FILE"
echo "完成时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

if [ ${#SUCCESS_LIST[@]} -gt 0 ]; then
    echo "成功任务列表:" >> "$SUMMARY_FILE"
    for task in "${SUCCESS_LIST[@]}"; do
        echo "  ✅ $task" >> "$SUMMARY_FILE"
    done
    echo "" >> "$SUMMARY_FILE"
fi

if [ ${#FAILED_LIST[@]} -gt 0 ]; then
    echo "失败任务列表:" >> "$SUMMARY_FILE"
    for task in "${FAILED_LIST[@]}"; do
        echo "  ❌ $task" >> "$SUMMARY_FILE"
    done
fi

echo ""
echo "总结报告已保存: $SUMMARY_FILE"
cat "$SUMMARY_FILE"
