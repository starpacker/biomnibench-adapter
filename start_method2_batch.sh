#!/bin/bash
# 方法2批量执行启动脚本

set -e

cd /home/yjh/my_claude

echo "=========================================="
echo "方法2：增量执行 - 批量运行所有13个母任务"
echo "=========================================="
echo ""
echo "配置:"
echo "  - 母任务数: 13"
echo "  - 总子任务数: 118"
echo "  - 每个子任务最大重试: 3次"
echo "  - 超时时间: 7200秒/子任务"
echo ""
echo "执行策略:"
echo "  - 母任务之间相互独立"
echo "  - 母任务内部子任务增量执行、上下文累积"
echo ""
echo "输出目录: output/Bio_runs/"
echo "统计文件: output/Bio_runs/method2_batch_stats.json"
echo ""
echo "=========================================="
echo ""

# 询问是否继续
read -p "是否开始执行? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "已取消"
    exit 1
fi

# 执行
python run_method2_batch.py

echo ""
echo "=========================================="
echo "批量执行完成!"
echo "=========================================="
