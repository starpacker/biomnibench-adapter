#!/bin/bash
# BioMniBench-Organized 测评 - 快速启动指南

cat << 'EOF'

╔═══════════════════════════════════════════════════════════════╗
║     BioMniBench-Organized 测评系统已就绪                      ║
╚═══════════════════════════════════════════════════════════════╝

📋 配置信息
──────────────────────────────────────────────────────────────
  模型:          claude-4.7-opus
  LLM Judge:     qwen3.5-plus
  任务目录:      /data/yjh/biomnibench-organized
  结果目录:      /data/yjh/biomnibench-organized-results
  任务数量:      50 个
  预计时间:      4-12 小时

🚀 使用方法
──────────────────────────────────────────────────────────────

1️⃣  运行完整测评（推荐在 tmux 中运行）
   
   tmux new -s biomnibench
   cd /home/yjh/my_claude
   ./run_biomnibench_organized.sh

2️⃣  从指定任务继续（如果中断了）
   
   cd /home/yjh/my_claude
   ./run_biomnibench_organized.sh da-10-1

3️⃣  监控测评进度（在另一个终端）
   
   cd /home/yjh/my_claude
   ./monitor_biomnibench_organized.sh

4️⃣  查看详细指南
   
   cat /home/yjh/my_claude/BIOMNIBENCH_ORGANIZED_GUIDE.md

📁 输出文件
──────────────────────────────────────────────────────────────
  summary_*.json          - 测评总结（包含所有结果）
  run_*.log               - 完整运行日志
  da-X-Y_*/               - 各任务运行目录
    ├── workspace_*/      - 工作空间（含 trace.md, answer.txt）
    └── judge_result.json - Judge 评分结果

💡 提示
──────────────────────────────────────────────────────────────
  • 使用 tmux 避免终端断开导致中断
  • 每个任务间有 5 秒间隔，避免 API 限流
  • 可以随时中断，从任意任务继续
  • 监控脚本实时显示进度和统计信息

📊 tmux 常用命令
──────────────────────────────────────────────────────────────
  tmux new -s biomnibench    # 创建新会话
  Ctrl+B, D                  # 分离会话（不中断运行）
  tmux attach -t biomnibench # 重新连接会话
  tmux ls                    # 查看所有会话

EOF

# 检查环境
echo ""
echo "🔍 环境检查"
echo "──────────────────────────────────────────────────────────────"

# 检查 bun
if [ -x "/home/yjh/.bun/bin/bun" ]; then
    echo "✅ bun 已安装: $(/home/yjh/.bun/bin/bun --version)"
else
    echo "❌ bun 未找到，请先安装 bun"
fi

# 检查任务目录
if [ -d "/data/yjh/biomnibench-organized" ]; then
    TASK_COUNT=$(ls -1d /data/yjh/biomnibench-organized/da-* 2>/dev/null | wc -l)
    echo "✅ 任务目录存在: $TASK_COUNT 个任务"
else
    echo "❌ 任务目录不存在: /data/yjh/biomnibench-organized"
fi

# 检查脚本
if [ -x "/home/yjh/my_claude/run_biomnibench_organized.sh" ]; then
    echo "✅ 测评脚本已就绪"
else
    echo "❌ 测评脚本不可执行"
fi

# 检查 Python
if command -v python3 &> /dev/null; then
    echo "✅ Python3 已安装: $(python3 --version)"
else
    echo "❌ Python3 未安装"
fi

echo ""
echo "准备开始测评？运行以下命令："
echo "  cd /home/yjh/my_claude"
echo "  ./run_biomnibench_organized.sh"
echo ""
