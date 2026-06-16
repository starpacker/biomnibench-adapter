# BioMniBench-Organized 测评系统 - 就绪报告

## ✅ 系统状态：就绪

所有组件已配置完成，可以开始测评。

---

## 📋 系统配置

| 项目 | 配置 |
|------|------|
| **测评模型** | claude-4.7-opus |
| **LLM Judge** | qwen3.5-plus |
| **任务目录** | `/data/yjh/biomnibench-organized` |
| **结果目录** | `/data/yjh/biomnibench-organized-results` |
| **任务数量** | 50 个 da- 任务 |
| **预计时间** | 4-12 小时 |
| **单任务限制** | 5 轮，3600 秒超时 |

---

## 🎯 创建的文件

### 1. 主测评脚本
- **`run_biomnibench_organized.py`** - Python 测评脚本
  - 自动遍历所有任务
  - 调用 bun CLI 执行测评
  - 运行 LLM Judge 评分
  - 保存详细结果

### 2. Shell 启动脚本
- **`run_biomnibench_organized.sh`** - 便捷启动脚本
  - 设置环境变量
  - 启动测评并记录日志
  - 支持从指定任务继续

### 3. 监控脚本
- **`monitor_biomnibench_organized.sh`** - 实时进度监控
  - 显示当前统计
  - 列出最近完成的任务
  - 显示成功率

### 4. 文档
- **`BIOMNIBENCH_ORGANIZED_GUIDE.md`** - 详细使用指南
- **`start_biomnibench_organized.sh`** - 快速启动和环境检查

---

## 🚀 快速开始

### 方法 1：直接运行（简单）

```bash
cd /home/yjh/my_claude
./run_biomnibench_organized.sh
```

### 方法 2：使用 tmux（推荐）

```bash
# 创建 tmux 会话
tmux new -s biomnibench

# 运行测评
cd /home/yjh/my_claude
./run_biomnibench_organized.sh

# 分离会话（Ctrl+B, 然后按 D）
# 测评会在后台继续运行

# 稍后重新连接
tmux attach -t biomnibench
```

### 方法 3：从指定任务继续

如果测评中断了，可以从任意任务继续：

```bash
cd /home/yjh/my_claude
./run_biomnibench_organized.sh da-10-1
```

---

## 📊 监控测评进度

在另一个终端运行：

```bash
cd /home/yjh/my_claude
./monitor_biomnibench_organized.sh
```

输出示例：
```
📊 最新结果文件: summary_20260608_123456.json

统计信息:
----------------------------------------
模型: claude-4.7-opus
Judge: qwen3.5-plus
总任务数: 50
已完成: 25
成功: 20
失败: 4
错误: 1
进度: 50%
成功率: 80%

最近完成的任务:
----------------------------------------
✅ da-1-3 - 245秒 - 得分: 85
✅ da-1-4 - 312秒 - 得分: 90
❌ da-10-1 - 180秒
✅ da-10-3 - 267秒 - 得分: 75
⏱️  da-11-1 - 超时
```

---

## 📁 输出结构

```
/data/yjh/biomnibench-organized-results/
│
├── summary_20260608_123456.json       # 总结文件（所有任务结果）
├── run_20260608_123456.log            # 完整运行日志
│
├── da-1-3_20260608_123500/            # 任务运行目录
│   ├── workspace_*/                   # 工作空间
│   │   ├── trace.md                   # AI 执行轨迹
│   │   ├── answer.txt                 # AI 生成的答案
│   │   └── *.py, *.csv, *.png         # AI 生成的其他文件
│   └── judge_result.json              # Judge 评分结果
│
├── da-1-3_20260608_123500_output.log  # 任务执行日志
│
├── da-1-4_20260608_124000/
├── da-10-1_20260608_125000/
└── ...
```

---

## 📈 结果分析

测评完成后，查看总结：

```bash
cd /data/yjh/biomnibench-organized-results
cat summary_*.json | jq
```

快速统计：

```bash
cd /data/yjh/biomnibench-organized-results
jq -r '
  "总任务数: \(.total)",
  "已完成: \(.completed)",
  "成功: \(.passed)",
  "失败: \(.failed)",
  "成功率: \((.passed / .total * 100) | floor)%"
' summary_*.json
```

查看得分最高的任务：

```bash
jq -r '.results[] | select(.status == "success") | 
  "\(.task_name): \(.judge_result.total_score)"' summary_*.json | 
  sort -t: -k2 -nr | head -10
```

---

## 🔧 故障排查

### 任务失败

查看任务日志：
```bash
cat /data/yjh/biomnibench-organized-results/da-X-Y_*_output.log
```

查看 AI 执行轨迹：
```bash
cat /data/yjh/biomnibench-organized-results/da-X-Y_*/workspace_*/trace.md
```

### Judge 失败

检查必要文件：
```bash
ls /data/yjh/biomnibench-organized-results/da-X-Y_*/workspace_*/trace.md
ls /data/yjh/biomnibench-organized-results/da-X-Y_*/workspace_*/answer.txt
ls /data/yjh/biomnibench-organized/da-X-Y/evaluation/rubric.md
```

手动运行 Judge：
```bash
export QWEN_MODEL="Vendor3/qwen3.5-plus"
export QWEN_BASE_URL="https://api.gpugeek.com/v1"
export QWEN_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"

python3 /home/yjh/my_claude/llm_judge_qwen.py \
  /path/to/trace.md \
  /path/to/answer.txt \
  /path/to/rubric.md \
  /path/to/output.json
```

### 重新运行单个任务

```bash
cd /home/yjh/my_claude
/home/yjh/.bun/bin/bun src/harness/evaluation/cli.ts \
  --task da-1-3 \
  --task-dir /data/yjh/biomnibench-organized/da-1-3 \
  --runs-dir /data/yjh/biomnibench-organized-results \
  --max-rounds 5 \
  --timeout-seconds 3600 \
  --temperature 1 \
  --thinking disabled
```

---

## ⚠️ 注意事项

1. **API 限流**：任务间有 5 秒间隔，如遇到限流可以增加间隔
2. **长时间运行**：建议使用 tmux，避免终端断开
3. **磁盘空间**：每个任务约占用 10-50 MB，确保足够空间
4. **中断恢复**：可以随时中断，使用 `./run_biomnibench_organized.sh 任务名` 继续

---

## 📞 环境验证

运行以下命令验证环境：

```bash
cd /home/yjh/my_claude
./start_biomnibench_organized.sh
```

应该看到：
```
✅ bun 已安装: 1.3.14
✅ 任务目录存在: 50 个任务
✅ 测评脚本已就绪
✅ Python3 已安装: Python 3.14.4
```

---

## 🎉 准备就绪！

所有系统已配置完成，现在可以开始测评了。

**立即开始：**

```bash
tmux new -s biomnibench
cd /home/yjh/my_claude
./run_biomnibench_organized.sh
```

祝测评顺利！🚀
