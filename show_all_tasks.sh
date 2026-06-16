#!/bin/bash
#
# 显示所有combined任务的详细信息
#

echo "======================================================================"
echo "BioDSBench Combined Tasks - 完整列表"
echo "======================================================================"
echo ""

cd /home/yjh/my_claude/tasks

for task in *_combined; do
    echo "📦 $task"
    
    # 统计子任务数（通过原始任务目录）
    study_id=${task%_combined}
    subtask_count=$(ls -d ${study_id}_* 2>/dev/null | grep -v "_combined" | wc -l)
    echo "   子任务数: $subtask_count"
    
    # 检查关键文件
    echo -n "   配置文件: "
    [ -f "$task/task_manifest.json" ] && echo -n "✅ " || echo -n "❌ "
    [ -f "$task/evaluation/judge.py" ] && echo -n "✅ " || echo -n "❌ "
    [ -f "$task/evaluation/test_cases.py" ] && echo -n "✅ " || echo -n "❌ "
    echo ""
    
    # 检查数据链接
    echo -n "   数据链接: "
    [ -L "$task/workdir" ] && echo -n "workdir✅ " || echo -n "workdir❌ "
    [ -L "$task/envs" ] && echo -n "envs✅ " || echo -n "envs❌ "
    echo ""
    
    echo ""
done

echo "======================================================================"
echo "统计汇总"
echo "======================================================================"

# 统计总数
total_combined=$(ls -d *_combined 2>/dev/null | wc -l)
total_subtasks=0

for task in *_combined; do
    study_id=${task%_combined}
    count=$(ls -d ${study_id}_* 2>/dev/null | grep -v "_combined" | wc -l)
    total_subtasks=$((total_subtasks + count))
done

echo "Combined任务总数: $total_combined"
echo "子任务总数: $total_subtasks"
echo ""

echo "======================================================================"
echo "快速开始命令"
echo "======================================================================"
echo ""
echo "1️⃣  运行单个任务:"
echo "   cd /home/yjh/my_claude"
echo "   ./run_biodsbench.sh 25303977_combined"
echo ""
echo "2️⃣  批量运行所有任务:"
echo "   cd /home/yjh/my_claude"
echo "   ./run_all_combined_tasks.sh"
echo ""
echo "3️⃣  后台批量运行:"
echo "   cd /home/yjh/my_claude"
echo "   nohup ./run_all_combined_tasks.sh > batch_run.log 2>&1 &"
echo "   tail -f batch_run.log"
echo ""
echo "4️⃣  查看详细文档:"
echo "   cat /home/yjh/my_claude/COMBINED_TASKS_README.md"
echo ""
echo "======================================================================"
