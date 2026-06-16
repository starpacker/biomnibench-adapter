#!/bin/bash
# BioDSBench 完整串行测评脚本
# 13个母任务独立测评，每个母任务内子任务串行执行

cd /home/yjh/my_claude

echo "========================================"
echo "BioDSBench 批量串行测评"
echo "========================================"
echo "开始时间: $(date)"
echo ""

# 设置环境变量
export ANTHROPIC_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
export ANTHROPIC_BASE_URL="https://api.gpugeek.com"
export ANTHROPIC_MODEL="Vendor2/Claude-4.7-opus"
export ANTHROPIC_SMALL_FAST_MODEL="Vendor2/Claude-4.7-opus"

# 运行批量测评
python3 batch_serial_executor.py \
    --output-dir /data/yjh/biodsbench-serial-results \
    --max-rounds 3 \
    --timeout 3600 \
    2>&1 | tee /data/yjh/biodsbench-serial-results/batch_run.log

echo ""
echo "========================================"
echo "测评完成"
echo "结束时间: $(date)"
echo "========================================"
echo ""
echo "查看结果:"
echo "  日志: /data/yjh/biodsbench-serial-results/batch_run.log"
echo "  结果: /data/yjh/biodsbench-serial-results/batch_*/batch_state.json"
