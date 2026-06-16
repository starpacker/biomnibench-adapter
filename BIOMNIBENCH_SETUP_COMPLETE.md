# BioMniBench 测试系统 - 完成总结

## ✅ 已创建的文件

### 1. 主测试脚本
- **`test_biomnibench_tasks.py`** - Python 测试脚本，运行所有 52 个任务
- **`run_biomnibench_test.sh`** - Bash 启动脚本，便捷运行
- **`test_single_biomnibench.sh`** - 单任务测试脚本

### 2. 文档
- **`BIOMNIBENCH_TEST_GUIDE.md`** - 完整使用指南

## 🚀 快速开始

### 方法 1：运行全部 52 个任务（推荐）

```bash
cd /home/yjh/my_claude
./run_biomnibench_test.sh
```

### 方法 2：测试单个任务

```bash
cd /home/yjh/my_claude
./test_single_biomnibench.sh da-1-3
```

### 方法 3：直接使用 Python

```bash
cd /home/yjh/my_claude
python3 test_biomnibench_tasks.py
```

## 📋 系统配置

| 配置项 | 值 |
|--------|-----|
| 任务目录 | `/data/yjh/biomnibench-organized` |
| 任务数量 | 52 个（1 个 conventional + 51 个 da-X-Y）|
| 结果目录 | `/data/yjh/biomnibench-results` |
| 模型 | Vendor2/Claude-4.7-opus |
| API 端点 | https://api.gpugeek.com/v1 |
| 每任务超时 | 3600 秒（1 小时）|
| 最大迭代 | 20 次 |

## 📊 监控命令

```bash
# 实时日志
tail -f /data/yjh/biomnibench-results/test_run.log

# 查看进度
cat /data/yjh/biomnibench-results/summary_*.json | jq '{total, completed, passed, failed}'

# 查看成功率
cat /data/yjh/biomnibench-results/summary_*.json | jq '.success_rate'

# 列出失败的任务
cat /data/yjh/biomnibench-results/summary_*.json | jq -r '.results[] | select(.passed == false) | .task_name'
```

## 🎯 任务列表（52个）

```
1. conventional_ptychography
2. da-1-3
3. da-1-3-clean
4. da-1-4
5. da-10-1
6. da-10-3
7. da-11-1
8. da-12-2
9. da-12-4
10. da-13-1
11. da-13-3
12. da-13-5
13. da-13-6
14. da-14-1
15. da-14-3
16. da-14-8
17. da-15-1
18. da-15-2
19. da-15-7
20. da-15-8
21. da-16-1
22. da-17-1
23. da-17-3
24. da-17-5
25. da-18-1
26. da-18-5
27. da-18-7
28. da-19-1
29. da-19-3
30. da-19-4
31. da-19-6
32. da-20-1
33. da-20-3
34. da-20-4
35. da-24-3
36. da-25-1
37. da-26-2
38. da-26-4
39. da-3-4
40. da-3-5
41. da-4-1
42. da-4-6
43. da-4-7
44. da-5-1
45. da-5-3
46. da-6-2
47. da-6-5
48. da-8-1
49. da-8-2
50. da-8-3
51. da-9-1
52. da-9-7
```

## 📁 输出结构

```
/data/yjh/biomnibench-results/
├── summary_20260607_HHMMSS.json    # 总体摘要
├── test_run.log                     # 完整日志
├── conventional_ptychography/
│   └── 20260607_HHMMSS/
│       ├── conventional_ptychography_log.md
│       ├── conventional_ptychography_result.json
│       └── conventional_ptychography_error.json (如果失败)
├── da-1-3/
│   └── 20260607_HHMMSS/
│       └── ...
└── ... (每个任务一个目录)
```

## ⏱️ 预计时间

- **单任务**: 5-60 分钟
- **全部 52 任务（串行）**: 4-52 小时
- **建议**: 先测试 1-2 个任务验证系统正常

## 🧪 建议测试流程

### 第一步：测试单个任务（5-15分钟）
```bash
./test_single_biomnibench.sh da-1-3
```

### 第二步：检查结果
```bash
ls -la /data/yjh/biomnibench-results/da-1-3/
cat /data/yjh/biomnibench-results/da-1-3/*/da-1-3_result.json
```

### 第三步：如果成功，运行全部
```bash
./run_biomnibench_test.sh
```

## 🔧 常见问题

### Q1: 如何暂停测试？
```bash
# 按 Ctrl+C 停止
# 脚本会保存已完成任务的结果到 summary_*.json
```

### Q2: 如何从中断处继续？
脚本不支持断点续传，需要手动提取未完成的任务重新运行。

### Q3: 如何只测试特定任务？
编辑 `test_biomnibench_tasks.py`，在 `main()` 函数中：
```python
# 替换
all_tasks = get_all_tasks(base_dir)

# 为
all_tasks = ["da-1-3", "da-1-4", "da-10-1"]  # 只测试这些
```

### Q4: 如何调整超时时间？
编辑 `test_biomnibench_tasks.py`，修改：
```python
timeout_seconds=7200,  # 改为 2 小时
```

## 📊 结果分析

### 查看统计
```bash
cat /data/yjh/biomnibench-results/summary_*.json | jq '{
  total: .total_tasks,
  passed: .passed,
  failed: .failed,
  success_rate: (.success_rate * 100 | tostring + "%")
}'
```

### 导出失败任务列表
```bash
cat /data/yjh/biomnibench-results/summary_*.json | \
  jq -r '.results[] | select(.passed == false) | .task_name' \
  > failed_tasks.txt
```

### 查看每个任务的得分
```bash
cat /data/yjh/biomnibench-results/summary_*.json | \
  jq '.results[] | "\(.task_name): \(.score)"' -r
```

## 📝 下一步

1. ✅ 测试系统已准备就绪
2. 运行 `./run_biomnibench_test.sh` 开始测试
3. 监控 `/data/yjh/biomnibench-results/test_run.log`
4. 等待完成，分析结果

## 📞 技术细节

- **评估框架**: imaging-101 evaluation_harness
- **运行模式**: end_to_end（完整端到端测试）
- **任务格式**: 每个任务有 task_manifest.json 或 task.toml
- **环境**: Python 3 (ragas conda env)
- **并发**: 当前为串行执行（一次一个任务）

## 🎉 准备完成！

所有脚本已创建并赋予执行权限。现在可以开始测试了：

```bash
cd /home/yjh/my_claude
./run_biomnibench_test.sh
```

祝测试顺利！ 🚀
