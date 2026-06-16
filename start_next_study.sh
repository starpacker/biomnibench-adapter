#!/bin/bash

# 方法2 - 快速启动下一个母任务
# 使用方法: ./start_next_study.sh <study_id>

if [ -z "$1" ]; then
    echo "=== 可用的母任务列表 ==="
    echo ""
    echo "推荐（子任务少，运行快）："
    echo "  ./start_next_study.sh 32864625  # 6个子任务，预计15-20分钟"
    echo "  ./start_next_study.sh 34819518  # 6个子任务，预计15-20分钟"
    echo "  ./start_next_study.sh 29713087  # 7个子任务，预计20-25分钟"
    echo ""
    echo "其他可用任务："
    echo "  ./start_next_study.sh 30742119  # 8个子任务"
    echo "  ./start_next_study.sh 28481359  # 9个子任务"
    echo "  ./start_next_study.sh 28985567  # 9个子任务"
    echo "  ./start_next_study.sh 27959731  # 10个子任务"
    echo "  ./start_next_study.sh 28472509  # 10个子任务"
    echo "  ./start_next_study.sh 30867592  # 10个子任务"
    echo "  ./start_next_study.sh 37699004  # 10个子任务"
    echo "  ./start_next_study.sh 33765338  # 12个子任务"
    echo "  ./start_next_study.sh 32437664  # 13个子任务"
    echo ""
    echo "已失败的任务："
    echo "  25303977  # 8个子任务，子任务4失败（任务描述歧义）"
    exit 1
fi

STUDY_ID=$1

# 检查任务是否存在
if [ ! -d "tasks/${STUDY_ID}_combined" ]; then
    echo "❌ 错误：母任务 $STUDY_ID 不存在"
    echo "请检查tasks目录中是否有 ${STUDY_ID}_combined"
    exit 1
fi

# 统计子任务数量
SUBTASK_COUNT=$(ls -d tasks/${STUDY_ID}_* 2>/dev/null | grep -v "_combined" | wc -l)

echo "=== 方法2 - 母任务 $STUDY_ID ==="
echo ""
echo "子任务数量: $SUBTASK_COUNT"
echo "最大轮数: 3"
echo "规则: 任何子任务失败立即停止"
echo "开始时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "预计耗时: $((SUBTASK_COUNT * 2))-$((SUBTASK_COUNT * 3)) 分钟"
echo ""
read -p "确认启动？(y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "已取消"
    exit 1
fi

echo ""
echo "🚀 启动运行..."
echo ""

# 运行方法2
python3 run_method2_batch.py --study $STUDY_ID --max-rounds 3

echo ""
echo "=== 运行完成 ==="
echo "结束时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "查看结果："
echo "  ls -lh output/Bio_runs/${STUDY_ID}_incremental_*/"
echo ""
echo "查看评估结果："
echo "  cat output/Bio_runs/${STUDY_ID}_incremental_*/study_state.json | python3 -m json.tool"
