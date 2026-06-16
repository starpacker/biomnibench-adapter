#!/bin/bash
# 监控重新运行的进度

echo "=========================================="
echo "监控重新运行进度"
echo "=========================================="
echo ""

# 检查日志文件
if [ -f /tmp/rerun_failed_studies.log ]; then
    echo "最新日志（最后30行）："
    echo "----------------------------------------"
    tail -30 /tmp/rerun_failed_studies.log
    echo ""
else
    echo "日志文件尚未生成"
fi

# 检查统计文件
if [ -f /home/yjh/my_claude/rerun_stats.json ]; then
    echo "=========================================="
    echo "统计信息："
    echo "----------------------------------------"
    python3 -c "
import json
with open('/home/yjh/my_claude/rerun_stats.json') as f:
    stats = json.load(f)
    print(f\"总母任务数: {stats.get('total_studies', 0)}\")
    print(f\"完成: {stats.get('completed_studies', 0)}\")
    print(f\"通过: {stats.get('passed_studies', 0)}\")
    print(f\"失败: {stats.get('failed_studies', 0)}\")
    print(f\"总子任务数: {stats.get('total_subtasks', 0)}\")
    print(f\"通过子任务: {stats.get('passed_subtasks', 0)}\")
    print(f\"失败子任务: {stats.get('failed_subtasks', 0)}\")
    print()
    print('详细结果:')
    for result in stats.get('results', []):
        status_icon = '✅' if result.get('status') == 'passed' else '❌'
        print(f\"  {status_icon} {result.get('study_id')}: {result.get('passed_subtasks', 0)}/{result.get('num_subtasks', 0)} 通过\")
"
else
    echo "统计文件尚未生成（任务可能还在运行）"
fi

echo ""
echo "=========================================="
echo "提示: 运行 'bash monitor_rerun.sh' 查看最新进度"
echo "=========================================="
