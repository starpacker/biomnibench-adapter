#!/bin/bash
# BioDSBench 快速启动 - 测试小规模母任务

cd /home/yjh/my_claude

echo "========================================"
echo "BioDSBench 小规模测试"
echo "========================================"
echo "测试 3 个最小的母任务："
echo "  - 34819518 (6 个子任务)"
echo "  - 32864625 (6 个子任务)"
echo "  - 29713087 (7 个子任务)"
echo "========================================"
echo "开始时间: $(date)"
echo ""

# 设置环境变量
export ANTHROPIC_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
export ANTHROPIC_BASE_URL="https://api.gpugeek.com"
export ANTHROPIC_MODEL="Vendor2/Claude-4.7-opus"
export ANTHROPIC_SMALL_FAST_MODEL="Vendor2/Claude-4.7-opus"

# 运行小规模测试
python3 batch_serial_executor.py \
    --studies 34819518 32864625 29713087 \
    --output-dir /data/yjh/biodsbench-serial-results \
    --max-rounds 3 \
    --timeout 3600 \
    2>&1 | tee /data/yjh/biodsbench-serial-results/small_test.log

echo ""
echo "========================================"
echo "测试完成"
echo "结束时间: $(date)"
echo "========================================"
echo ""
echo "查看结果:"
echo "  日志: /data/yjh/biodsbench-serial-results/small_test.log"
echo "  状态: /data/yjh/biodsbench-serial-results/batch_*/batch_state.json"
