#!/bin/bash
# 测试单个母任务的串行执行

cd /home/yjh/my_claude

# 测试最小的母任务: 34819518 (6个子任务)
echo "测试母任务: 34819518 (6个子任务)"
python3 batch_serial_executor.py \
    --studies 34819518 \
    --output-dir /data/yjh/biodsbench-serial-results \
    --max-rounds 3 \
    --timeout 3600

echo "测试完成，检查结果..."
ls -la /data/yjh/biodsbench-serial-results/
