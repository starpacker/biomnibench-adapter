#!/bin/bash
# 使用 my_claude 测评 biomnibench-organized
# 模型: claude-4.7-opus
# Judge: qwen3.5-plus

echo "=========================================="
echo "BioMniBench-Organized 任务测评"
echo "=========================================="
echo ""
echo "模型: claude-4.7-opus"
echo "Judge: qwen3.5-plus"
echo "任务目录: /data/yjh/biomnibench-organized"
echo "结果目录: /data/yjh/biomnibench-organized-results"
echo ""

# 设置环境变量
# Claude (Anthropic-compatible) 配置
export ANTHROPIC_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
export ANTHROPIC_BASE_URL="https://api.gpugeek.com"
export API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
export BASE_URL="https://api.gpugeek.com"
export MODEL_NAME="Vendor2/Claude-4.7-opus"
# Qwen (LLM Judge) 配置 - 同一个 API key
export QWEN_MODEL="Vendor3/qwen3.5-plus"
export QWEN_BASE_URL="https://api.gpugeek.com/v1"
export QWEN_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"

# 确保 bun 在 PATH 中
export PATH="/home/yjh/.bun/bin:$PATH"

# 切换到 my_claude 目录
cd /home/yjh/my_claude

# 运行测评脚本
echo "开始运行测评..."
echo ""

if [ -n "$1" ]; then
    echo "从任务 $1 开始运行"
    python3 run_biomnibench_organized.py "$1" 2>&1 | tee /data/yjh/biomnibench-organized-results/run_$(date +%Y%m%d_%H%M%S).log
else
    python3 run_biomnibench_organized.py 2>&1 | tee /data/yjh/biomnibench-organized-results/run_$(date +%Y%m%d_%H%M%S).log
fi

echo ""
echo "=========================================="
echo "测评完成！"
echo "=========================================="
echo "查看结果: ls -la /data/yjh/biomnibench-organized-results/"
