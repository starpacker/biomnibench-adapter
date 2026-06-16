# BioMniBench-Organized 测评指南

## 概述

使用 `my_claude` 对 `/data/yjh/biomnibench-organized` 中的所有任务进行自动化测评。

## 配置信息

- **测评模型**: claude-4.7-opus
- **LLM Judge**: qwen3.5-plus
- **任务目录**: `/data/yjh/biomnibench-organized`
- **结果目录**: `/data/yjh/biomnibench-organized-results`
- **最大轮数**: 5 轮
- **超时时间**: 3600 秒/任务
- **温度**: 1.0

## 使用方法

### 1. 运行完整测评

从头开始运行所有任务：

```bash
cd /home/yjh/my_claude
./run_biomnibench_organized.sh
```

### 2. 从指定任务开始运行

如果测评中断，可以从指定任务继续：

```bash
cd /home/yjh/my_claude
./run_biomnibench_organized.sh da-10-1
```

这将跳过 `da-10-1` 之前的所有任务，从 `da-10-1` 开始运行。

### 3. 监控测评进度

在另一个终端中运行监控脚本：

```bash
cd /home/yjh/my_claude
./monitor_biomnibench_organized.sh
```

监控脚本会显示：
- 总体进度统计
- 成功/失败/错误数量
- 最近完成的任务
- 实时日志文件位置

### 4. 查看详细结果

查看最新的测评总结：

```bash
cd /data/yjh/biomnibench-organized-results
cat summary_*.json | jq
```

查看特定任务的日志：

```bash
cd /data/yjh/biomnibench-organized-results
cat da-1-3_*_output.log
```

## 输出文件结构

```
/data/yjh/biomnibench-organized-results/
├── summary_20260608_123456.json          # 测评总结（JSON格式）
├── run_20260608_123456.log                # 完整运行日志
├── da-1-3_20260608_123500/                # 任务运行目录
│   ├── workspace_*/                       # 工作空间
│   │   ├── trace.md                       # 执行轨迹
│   │   ├── answer.txt                     # AI答案
│   │   └── ...                            # 其他生成文件
│   └── judge_result.json                  # Judge评分结果
├── da-1-3_20260608_123500_output.log      # 任务执行日志
├── da-1-4_20260608_124000/
└── ...
```

## Summary JSON 格式

```json
{
  "timestamp": "20260608_123456",
  "model": "claude-4.7-opus",
  "judge": "qwen3.5-plus",
  "total": 50,
  "completed": 25,
  "passed": 20,
  "failed": 4,
  "errors": 1,
  "results": [
    {
      "task_name": "da-1-3",
      "status": "success",
      "returncode": 0,
      "duration": 245.67,
      "timestamp": "20260608_123500",
      "run_dir": "/data/yjh/biomnibench-organized-results/da-1-3_20260608_123500",
      "log_file": "/data/yjh/biomnibench-organized-results/da-1-3_20260608_123500_output.log",
      "judge_result": {
        "total_score": 85,
        "criteria_scores": {...}
      },
      "error": null
    },
    ...
  ]
}
```

## Judge 结果格式

每个任务的 `judge_result.json` 包含：

```json
{
  "total_score": 85,
  "criteria_scores": {
    "criterion_1": {"level": "A", "points": 30},
    "criterion_2": {"level": "B", "points": 25},
    "criterion_3": {"level": "A", "points": 30}
  },
  "feedback": "...",
  "model": "Vendor3/qwen3.5-plus",
  "timestamp": "2026-06-08T12:35:45"
}
```

## 任务列表

biomnibench-organized 包含以下任务：

```
da-1-3    da-10-1   da-13-1   da-15-1   da-17-3   da-19-4
da-1-4    da-10-3   da-13-3   da-15-2   da-17-5   da-19-6
da-11-1   da-13-5   da-15-7   da-18-1   da-20-1   ...
```

使用以下命令查看完整列表：

```bash
ls -1 /data/yjh/biomnibench-organized/ | grep "^da-"
```

## 故障排查

### 任务执行失败

1. 查看任务日志：
   ```bash
   cat /data/yjh/biomnibench-organized-results/da-X-Y_*_output.log
   ```

2. 查看 trace.md 了解 AI 执行过程：
   ```bash
   cat /data/yjh/biomnibench-organized-results/da-X-Y_*/workspace_*/trace.md
   ```

3. 重新运行单个任务：
   ```bash
   cd /home/yjh/my_claude
   /home/admin/.bun/bin/bun src/harness/evaluation/cli.ts \
     --task da-X-Y \
     --task-dir /data/yjh/biomnibench-organized/da-X-Y \
     --runs-dir /data/yjh/biomnibench-organized-results \
     --max-rounds 5 \
     --timeout-seconds 3600 \
     --temperature 1 \
     --thinking disabled
   ```

### Judge 评分失败

1. 检查必要文件是否存在：
   ```bash
   ls /data/yjh/biomnibench-organized-results/da-X-Y_*/workspace_*/trace.md
   ls /data/yjh/biomnibench-organized-results/da-X-Y_*/workspace_*/answer.txt
   ls /data/yjh/biomnibench-organized/da-X-Y/evaluation/rubric.md
   ```

2. 手动运行 Judge：
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

### API 限流

如果遇到 API 限流，可以：

1. 增加任务间隔时间（修改脚本中的 `time.sleep(5)` 为更大的值）
2. 从失败的任务继续运行：
   ```bash
   ./run_biomnibench_organized.sh da-X-Y
   ```

## 预计运行时间

- 单任务平均时间: 5-15 分钟
- 总任务数: ~50 个
- 预计总时间: 4-12 小时

建议在 tmux 或 screen 会话中运行，避免终端断开导致中断。

## 使用 tmux 运行

```bash
# 创建新会话
tmux new -s biomnibench

# 运行测评
cd /home/yjh/my_claude
./run_biomnibench_organized.sh

# 分离会话（不中断运行）: Ctrl+B, 然后按 D

# 重新连接
tmux attach -t biomnibench

# 查看所有会话
tmux ls
```

## 后续分析

测评完成后，可以使用以下 Python 脚本进行分析：

```python
import json
from pathlib import Path

# 读取结果
summary_file = max(Path("/data/yjh/biomnibench-organized-results").glob("summary_*.json"))
with open(summary_file) as f:
    data = json.load(f)

# 统计分析
print(f"总任务数: {data['total']}")
print(f"成功率: {data['passed']/data['total']*100:.2f}%")

# 按得分排序
successful_tasks = [r for r in data['results'] if r['status'] == 'success' and r.get('judge_result')]
successful_tasks.sort(key=lambda x: x['judge_result']['total_score'], reverse=True)

print("\n得分最高的任务:")
for task in successful_tasks[:5]:
    print(f"  {task['task_name']}: {task['judge_result']['total_score']}")

print("\n失败的任务:")
failed_tasks = [r for r in data['results'] if r['status'] != 'success']
for task in failed_tasks:
    print(f"  {task['task_name']}: {task.get('error', 'Unknown error')}")
```

## 联系与支持

如有问题，请检查：
1. API Key 是否有效
2. 网络连接是否正常
3. bun 是否正确安装
4. 任务目录结构是否完整
