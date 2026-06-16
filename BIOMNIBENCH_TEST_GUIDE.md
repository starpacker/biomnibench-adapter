# BioMniBench 测试指南

## 📋 概述

已为你创建了测试 `/data/yjh/biomnibench-organized` 中 52 个任务的脚本。

## 🚀 快速开始

### 运行全部 52 个任务

```bash
cd /home/yjh/my_claude
./run_biomnibench_test.sh
```

### 或者直接运行 Python 脚本

```bash
cd /home/yjh/my_claude
python3 test_biomnibench_tasks.py
```

## 📊 任务列表

共 52 个任务：
- 1 个 `conventional_ptychography`
- 51 个 `da-X-Y` 格式的任务

## ⚙️ 配置说明

- **模型**: Vendor2/Claude-4.7-opus
- **API 端点**: https://api.gpugeek.com/v1
- **超时时间**: 每个任务 3600 秒 (1 小时)
- **最大迭代**: 20 次
- **模式**: end_to_end

## 📁 输出结构

```
/data/yjh/biomnibench-results/
├── summary_YYYYMMDD_HHMMSS.json          # 总体结果摘要
├── test_run.log                          # 完整日志
├── conventional_ptychography/
│   └── YYYYMMDD_HHMMSS/
│       ├── conventional_ptychography_log.md
│       └── conventional_ptychography_result.json
├── da-1-3/
│   └── YYYYMMDD_HHMMSS/
│       ├── da-1-3_log.md
│       └── da-1-3_result.json
└── ...
```

## 📈 监控进度

### 实时查看日志
```bash
tail -f /data/yjh/biomnibench-results/test_run.log
```

### 查看摘要文件
```bash
# 找到最新的摘要文件
ls -lt /data/yjh/biomnibench-results/summary_*.json | head -1

# 查看内容
cat /data/yjh/biomnibench-results/summary_*.json | jq
```

### 查看进度统计
```bash
cat /data/yjh/biomnibench-results/summary_*.json | jq '{total: .total_tasks, completed: .completed, passed: .passed, failed: .failed}'
```

## 📝 结果文件说明

### summary_*.json
包含所有任务的汇总信息：
```json
{
  "total_tasks": 52,
  "completed": 52,
  "passed": 30,
  "failed": 22,
  "errors": 0,
  "success_rate": 0.577,
  "timestamp": "20260607_150530",
  "results": [...]
}
```

### 每个任务的 result.json
包含单个任务的详细结果：
```json
{
  "task_name": "da-1-3",
  "status": "success",
  "passed": true,
  "score": 0.85,
  "timestamp": "2026-06-07T15:05:30",
  "result": {...}
}
```

## ⏱️ 预计运行时间

- **单任务**: 5-60 分钟（取决于复杂度）
- **全部 52 任务**: 4-48 小时（并行运行可加速）

## 🔧 故障排查

### 问题 1: API Key 错误
```bash
export ANTHROPIC_API_KEY="your-api-key-here"
./run_biomnibench_test.sh
```

### 问题 2: Python 环境错误
```bash
which python3
# 应该是: /home/yjh/.conda/envs/ragas/bin/python3
```

### 问题 3: imaging-101 未找到
```bash
ls -la /home/yjh/imaging-101
# 确保该目录存在
```

### 问题 4: 任务超时
编辑 `test_biomnibench_tasks.py`，修改：
```python
timeout_seconds=7200,  # 增加到 2 小时
```

## 🎯 测试单个任务

如果想先测试单个任务，可以修改脚本：

```python
# 在 main() 函数中，替换
all_tasks = get_all_tasks(base_dir)

# 为
all_tasks = ["da-1-3"]  # 只测试这一个任务
```

## 📊 分析结果

### 查看通过率
```bash
cat /data/yjh/biomnibench-results/summary_*.json | jq '.success_rate'
```

### 查看失败的任务
```bash
cat /data/yjh/biomnibench-results/summary_*.json | jq '.results[] | select(.passed == false) | .task_name'
```

### 查看得分
```bash
cat /data/yjh/biomnibench-results/summary_*.json | jq '.results[] | {task: .task_name, score: .score}'
```

## 🔄 重新运行失败的任务

可以从摘要中提取失败的任务，然后只运行这些任务：

```bash
# 提取失败的任务
failed_tasks=$(cat /data/yjh/biomnibench-results/summary_*.json | jq -r '.results[] | select(.passed == false) | .task_name')

echo "失败的任务:"
echo "$failed_tasks"
```

## 📞 需要帮助？

查看相关文档：
- `QUICK_START.md` - BioDSBench 快速启动
- `EXECUTION_PLAN.md` - 执行计划
- `README.md` - 项目总览

---

**准备就绪，开始测试！** 🚀
