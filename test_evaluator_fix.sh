#!/bin/bash
# 测试所有失败任务，验证评测器修复效果

echo "=========================================="
echo "测试修复后的评测器"
echo "测试所有11个失败任务"
echo "=========================================="
echo ""

# 定义失败任务列表（母任务ID_子任务索引）
tasks=(
    "29713087_2"
    "25303977_5"
    "32864625_2"
    "34819518_3"
    "28481359_2"
    "28985567_8"
    "27959731_1"
    "28472509_4"
    "37699004_2"
    "33765338_3"
    "32437664_10"
)

# 结果统计
total=0
pass_count=0
fail_count=0
error_count=0

# 创建结果目录
result_dir="/tmp/evaluator_test_results"
mkdir -p "$result_dir"

# 测试每个任务
for task in "${tasks[@]}"; do
    total=$((total + 1))
    echo "=========================================="
    echo "[$total/11] 测试任务: $task"
    echo "=========================================="

    # 提取母任务ID和子任务索引
    parent_id=$(echo $task | cut -d'_' -f1)
    subtask_idx=$(echo $task | cut -d'_' -f2)

    # 查找最新的运行目录
    run_dir=$(find /home/yjh/my_claude/output/Bio_runs -name "${parent_id}_incremental_*" -type d | sort -r | head -1)

    if [ -z "$run_dir" ]; then
        echo "❌ 未找到运行目录"
        error_count=$((error_count + 1))
        continue
    fi

    # 查找该子任务的最后一轮输出（直接在运行目录下）
    subtask_dir=$(find "$run_dir" -maxdepth 1 -name "${task}_*" -type d | sort -r | head -1)

    if [ -z "$subtask_dir" ]; then
        echo "❌ 未找到子任务目录"
        error_count=$((error_count + 1))
        continue
    fi

    outputs_dir="$subtask_dir/outputs"

    if [ ! -d "$outputs_dir" ]; then
        echo "❌ 未找到outputs目录: $outputs_dir"
        error_count=$((error_count + 1))
        continue
    fi

    echo "运行目录: $subtask_dir"

    # 运行评测器
    result_file="$result_dir/${task}_result.json"

    python /home/yjh/my_claude/incremental_evaluator.py \
        --task-dir "/home/yjh/my_claude/tasks/$task" \
        --outputs-dir "$outputs_dir" \
        --result "$result_file" 2>&1 | tail -20

    # 检查结果
    if [ -f "$result_file" ]; then
        status=$(python -c "import json; print(json.load(open('$result_file'))['status'])" 2>/dev/null)

        case "$status" in
            "pass")
                echo "✅ PASS"
                pass_count=$((pass_count + 1))
                ;;
            "fail")
                echo "❌ FAIL (逻辑错误)"
                fail_count=$((fail_count + 1))
                ;;
            "error")
                echo "⚠️  ERROR (环境错误)"
                error_count=$((error_count + 1))
                ;;
            *)
                echo "❓ UNKNOWN"
                error_count=$((error_count + 1))
                ;;
        esac

        # 显示反馈信息（前100字符）
        feedback=$(python -c "import json; print(json.load(open('$result_file'))['feedback'][:100])" 2>/dev/null)
        echo "反馈: $feedback..."
    else
        echo "❌ 未生成结果文件"
        error_count=$((error_count + 1))
    fi

    echo ""
done

# 输出统计
echo "=========================================="
echo "测试完成"
echo "=========================================="
echo "总数: $total"
echo "通过: $pass_count"
echo "失败(逻辑错误): $fail_count"
echo "错误(环境错误): $error_count"
echo ""
echo "结果文件保存在: $result_dir"
echo ""

# 生成详细报告
report_file="$result_dir/summary.txt"
echo "详细测试报告" > "$report_file"
echo "生成时间: $(date)" >> "$report_file"
echo "" >> "$report_file"
echo "任务状态:" >> "$report_file"

for task in "${tasks[@]}"; do
    result_file="$result_dir/${task}_result.json"
    if [ -f "$result_file" ]; then
        status=$(python -c "import json; print(json.load(open('$result_file'))['status'])" 2>/dev/null)
        feedback=$(python -c "import json; print(json.load(open('$result_file'))['feedback'])" 2>/dev/null)
        echo "----------------------------------------" >> "$report_file"
        echo "任务: $task" >> "$report_file"
        echo "状态: $status" >> "$report_file"
        echo "反馈: $feedback" >> "$report_file"
        echo "" >> "$report_file"
    fi
done

echo "详细报告已保存: $report_file"
