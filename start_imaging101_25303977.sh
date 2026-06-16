#!/bin/bash
# BioDSBench-imaging101-format 串行测评 - 25303977_0~7
# 启动脚本

cat << 'EOF'

╔═══════════════════════════════════════════════════════════════╗
║   BioDSBench-Imaging101 串行测评 - 25303977 系列             ║
╚═══════════════════════════════════════════════════════════════╝

📋 配置信息
──────────────────────────────────────────────────────────────
  模型:          claude-4.7-opus
  任务系列:      25303977_0 ~ 25303977_7 (共8个子任务)
  测评方式:      串行执行，上下文累积
  任务目录:      /data/yjh/BioDSBench_imaging101_format/tasks
  结果目录:      /data/yjh/imaging101_serial_results
  每任务重试:    最多3次
  单次超时:      1800秒（30分钟）

🎯 测评特点
──────────────────────────────────────────────────────────────
  ✓ 上下文承接：前面任务的代码和输出会传递给后续任务
  ✓ 串行执行：按 0→1→2→3→4→5→6→7 顺序依次执行
  ✓ 自动重试：每个任务失败后自动重试，最多3次
  ✓ 完整记录：保存所有执行轨迹、代码和日志

⏱️  预计耗时
──────────────────────────────────────────────────────────────
  正常情况: 2-4 小时
  最坏情况: 8-12 小时（所有任务都重试3次）

EOF

# 检查环境
echo ""
echo "🔍 环境检查"
echo "──────────────────────────────────────────────────────────────"

# 检查 Python
if command -v python3 &> /dev/null; then
    echo "✅ Python3: $(python3 --version)"
else
    echo "❌ Python3 未安装"
    exit 1
fi

# 检查 bun
if [ -x "/home/yjh/.bun/bin/bun" ]; then
    echo "✅ bun: $(/home/yjh/.bun/bin/bun --version)"
else
    echo "❌ bun 未找到"
    exit 1
fi

# 检查任务目录
if [ -d "/data/yjh/BioDSBench_imaging101_format/tasks" ]; then
    TASK_COUNT=$(ls -1d /data/yjh/BioDSBench_imaging101_format/tasks/25303977_* 2>/dev/null | wc -l)
    echo "✅ 任务目录存在: $TASK_COUNT 个 25303977 系列任务"
else
    echo "❌ 任务目录不存在"
    exit 1
fi

# 检查脚本
if [ -f "/home/yjh/my_claude/run_imaging101_25303977_serial.py" ]; then
    echo "✅ 测评脚本已就绪"
else
    echo "❌ 测评脚本不存在"
    exit 1
fi

# 检查 my_claude 目录
if [ -d "/home/yjh/my_claude/src" ]; then
    echo "✅ BioDSBench CLI 已就绪"
else
    echo "❌ BioDSBench CLI 未找到"
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "环境检查通过！准备开始测评..."
echo "═══════════════════════════════════════════════════════════════"
echo ""

# 询问是否继续
read -p "是否开始测评? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "已取消"
    exit 0
fi

echo ""
echo "🚀 开始测评..."
echo ""

# 切换到 my_claude 目录
cd /home/yjh/my_claude

# 运行测评（带日志）
timestamp=$(date +%Y%m%d_%H%M%S)
log_file="/data/yjh/imaging101_serial_results/run_${timestamp}.log"

python3 run_imaging101_25303977_serial.py \
    --study-id 25303977 \
    --start 0 \
    --end 7 \
    --max-rounds 3 \
    --timeout 1800 \
    2>&1 | tee "$log_file"

exit_code=${PIPESTATUS[0]}

echo ""
echo "═══════════════════════════════════════════════════════════════"
if [ $exit_code -eq 0 ]; then
    echo "✅ 测评完成！所有任务通过"
else
    echo "⚠️  测评完成，但部分任务失败"
fi
echo "═══════════════════════════════════════════════════════════════"
echo "日志文件: $log_file"
echo "结果目录: /data/yjh/imaging101_serial_results/"
echo ""
echo "查看详细结果:"
echo "  ls -la /data/yjh/imaging101_serial_results/"
echo ""

exit $exit_code
