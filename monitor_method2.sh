#!/bin/bash

echo "=== Method 2 批量测试监控 ==="
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 检查进程
echo "【进程状态】"
ps aux | grep -E "run_method2_batch|run_all_studies" | grep -v grep | awk '{print "  PID " $2 ": " $11 " " $12 " " $13 " " $14}'
echo ""

# 检查最新运行
echo "【最新运行目录】"
ls -lt output/Bio_runs/ | grep "20260528_23[12]" | head -5
echo ""

# 检查状态文件
echo "【运行状态】"
for dir in output/Bio_runs/32864625_incremental_20260528_23*; do
    if [ -f "$dir/study_state.json" ]; then
        echo "  $(basename $dir):"
        python3 << EOF
import json
with open('$dir/study_state.json') as f:
    data = json.load(f)
    print(f"    状态: {data['status']}")
    print(f"    进度: {data['completed_subtasks']}/{data['num_subtasks']}")
    print(f"    通过: {data['passed_subtasks']}, 失败: {data['failed_subtasks']}")
EOF
    fi
done
echo ""

# 检查日志
echo "【批量测试日志（最后10行）】"
if [ -f "batch_test_output_v2.log" ]; then
    tail -10 batch_test_output_v2.log
fi
