#!/bin/bash

# 方法2 - 自动批量测试所有母任务
# 自动依次运行所有待测试的母任务

LOG_FILE="batch_test_$(date +%Y%m%d_%H%M%S).log"

echo "=== 方法2 批量自动测试 ===" | tee -a "$LOG_FILE"
echo "开始时间: $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 所有待测试的母任务（按子任务数量排序，从少到多）
STUDIES=(
    "32864625:6"
    "34819518:6"
    "29713087:7"
    "30742119:8"
    "28481359:9"
    "28985567:9"
    "27959731:10"
    "28472509:10"
    "30867592:10"
    "37699004:10"
    "33765338:12"
    "32437664:13"
)

TOTAL=${#STUDIES[@]}
COMPLETED=0
PASSED=0
FAILED=0

echo "总共 $TOTAL 个母任务待测试" | tee -a "$LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

for study_info in "${STUDIES[@]}"; do
    STUDY_ID=$(echo "$study_info" | cut -d: -f1)
    SUBTASK_COUNT=$(echo "$study_info" | cut -d: -f2)
    COMPLETED=$((COMPLETED + 1))
    
    echo "" | tee -a "$LOG_FILE"
    echo "╔══════════════════════════════════════════════════════════════╗" | tee -a "$LOG_FILE"
    echo "║  测试 $COMPLETED/$TOTAL: 母任务 $STUDY_ID ($SUBTASK_COUNT 个子任务)" | tee -a "$LOG_FILE"
    echo "╚══════════════════════════════════════════════════════════════╝" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    
    START_TIME=$(date +%s)
    echo "开始时间: $(date '+%H:%M:%S')" | tee -a "$LOG_FILE"
    
    # 运行方法2
    python3 run_method2_batch.py --study "$STUDY_ID" --max-rounds 3 2>&1 | tee -a "$LOG_FILE"
    
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    MINUTES=$((DURATION / 60))
    SECONDS=$((DURATION % 60))
    
    echo "" | tee -a "$LOG_FILE"
    echo "结束时间: $(date '+%H:%M:%S')" | tee -a "$LOG_FILE"
    echo "耗时: ${MINUTES}分${SECONDS}秒" | tee -a "$LOG_FILE"
    
    # 检查结果
    LATEST_RUN=$(ls -td output/Bio_runs/${STUDY_ID}_incremental_* 2>/dev/null | head -1)
    if [ -f "$LATEST_RUN/study_state.json" ]; then
        RESULT=$(python3 << EOF
import json
try:
    with open('$LATEST_RUN/study_state.json') as f:
        s = json.load(f)
        passed = s.get('passed_subtasks', 0)
        total = s.get('num_subtasks', 0)
        rate = (passed / total * 100) if total > 0 else 0
        print(f"{passed}/{total} ({rate:.1f}%)")
        if passed == total:
            print("SUCCESS")
        else:
            print("PARTIAL")
except:
    print("ERROR")
    print("ERROR")
EOF
)
        PASS_RATE=$(echo "$RESULT" | head -1)
        STATUS=$(echo "$RESULT" | tail -1)
        
        echo "结果: $PASS_RATE" | tee -a "$LOG_FILE"
        
        if [ "$STATUS" = "SUCCESS" ]; then
            PASSED=$((PASSED + 1))
            echo "✅ 全部通过！" | tee -a "$LOG_FILE"
        elif [ "$STATUS" = "PARTIAL" ]; then
            echo "⚠️  部分通过" | tee -a "$LOG_FILE"
        else
            FAILED=$((FAILED + 1))
            echo "❌ 失败" | tee -a "$LOG_FILE"
        fi
    else
        FAILED=$((FAILED + 1))
        echo "❌ 无法读取结果" | tee -a "$LOG_FILE"
    fi
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
    
    # 短暂休息，避免系统过载
    if [ $COMPLETED -lt $TOTAL ]; then
        echo "" | tee -a "$LOG_FILE"
        echo "等待5秒后继续下一个任务..." | tee -a "$LOG_FILE"
        sleep 5
    fi
done

echo "" | tee -a "$LOG_FILE"
echo "╔══════════════════════════════════════════════════════════════╗" | tee -a "$LOG_FILE"
echo "║                    批量测试完成                              ║" | tee -a "$LOG_FILE"
echo "╚══════════════════════════════════════════════════════════════╝" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "总结:" | tee -a "$LOG_FILE"
echo "  测试总数: $TOTAL" | tee -a "$LOG_FILE"
echo "  全部通过: $PASSED" | tee -a "$LOG_FILE"
echo "  部分通过: $((TOTAL - PASSED - FAILED))" | tee -a "$LOG_FILE"
echo "  失败: $FAILED" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "结束时间: $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "详细日志: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 生成汇总报告
python3 << 'PYTHON_EOF'
import json
import os
from datetime import datetime

print("\n=== 生成汇总报告 ===\n")

studies = [
    "32864625", "34819518", "29713087", "30742119",
    "28481359", "28985567", "27959731", "28472509",
    "30867592", "37699004", "33765338", "32437664"
]

results = []

for study_id in studies:
    # 查找最新的运行目录
    run_dirs = []
    base_dir = "output/Bio_runs"
    if os.path.exists(base_dir):
        for d in os.listdir(base_dir):
            if d.startswith(f"{study_id}_incremental_"):
                run_dirs.append(os.path.join(base_dir, d))
    
    if not run_dirs:
        continue
    
    latest_run = max(run_dirs, key=os.path.getmtime)
    state_file = os.path.join(latest_run, "study_state.json")
    
    if os.path.exists(state_file):
        try:
            with open(state_file) as f:
                state = json.load(f)
                results.append({
                    'study_id': study_id,
                    'num_subtasks': state.get('num_subtasks', 0),
                    'passed': state.get('passed_subtasks', 0),
                    'failed': state.get('failed_subtasks', 0),
                    'completed': state.get('completed_subtasks', 0),
                    'status': state.get('status', 'unknown')
                })
        except:
            pass

# 生成Markdown报告
report_file = f"BATCH_TEST_REPORT_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"

with open(report_file, 'w') as f:
    f.write("# 方法2 批量测试报告\n\n")
    f.write(f"**生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
    
    f.write("## 📊 测试结果汇总\n\n")
    f.write("| 母任务ID | 子任务数 | 通过 | 失败 | 通过率 | 状态 |\n")
    f.write("|----------|----------|------|------|--------|------|\n")
    
    total_passed = 0
    total_subtasks = 0
    
    for r in results:
        total_passed += r['passed']
        total_subtasks += r['num_subtasks']
        rate = (r['passed'] / r['num_subtasks'] * 100) if r['num_subtasks'] > 0 else 0
        status = "✅" if r['passed'] == r['num_subtasks'] else "⚠️" if r['passed'] > 0 else "❌"
        f.write(f"| {r['study_id']} | {r['num_subtasks']} | {r['passed']} | {r['failed']} | {rate:.1f}% | {status} |\n")
    
    f.write("\n## 📈 总体统计\n\n")
    f.write(f"- **测试母任务数**: {len(results)}\n")
    f.write(f"- **总子任务数**: {total_subtasks}\n")
    f.write(f"- **通过子任务数**: {total_passed}\n")
    f.write(f"- **总体通过率**: {(total_passed/total_subtasks*100):.1f}%\n")
    
    full_pass = sum(1 for r in results if r['passed'] == r['num_subtasks'])
    partial_pass = sum(1 for r in results if 0 < r['passed'] < r['num_subtasks'])
    full_fail = sum(1 for r in results if r['passed'] == 0)
    
    f.write(f"- **全部通过**: {full_pass}/{len(results)}\n")
    f.write(f"- **部分通过**: {partial_pass}/{len(results)}\n")
    f.write(f"- **全部失败**: {full_fail}/{len(results)}\n")

print(f"汇总报告已生成: {report_file}")

PYTHON_EOF

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "批量测试全部完成！"
