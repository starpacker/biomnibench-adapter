#!/bin/bash
# 运行 BioMniBench 任务测评

echo "=========================================="
echo "BioMniBench 任务测评"
echo "=========================================="
echo ""
echo "任务目录: /data/yjh/biomnibench-organized"
echo "结果目录: /data/yjh/biomnibench-results"
echo ""

# 确保 Python 环境正确
export PATH="/home/yjh/.conda/envs/ragas/bin:$PATH"

# 设置 API Key（如果环境变量未设置）
if [ -z "$ANTHROPIC_API_KEY" ]; then
    export ANTHROPIC_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
fi

# 运行测试
cd /home/yjh/my_claude
python3 test_biomnibench_tasks.py 2>&1 | tee /data/yjh/biomnibench-results/test_run.log

echo ""
echo "=========================================="
echo "测评完成！"
echo "=========================================="
echo "查看结果: ls -la /data/yjh/biomnibench-results/"
echo "查看日志: cat /data/yjh/biomnibench-results/test_run.log"
