# 方法2：增量执行实现文档

## 📋 概述

方法2实现了**增量执行**策略，将118个子任务逐个执行，每个子任务完成后立即验证，通过后才进入下一个。

## 🎯 核心特性

### 1. 增量执行
- 一次执行一个子任务
- 每个子任务完成后立即judge验证
- 只有通过验证才进入下一个子任务

### 2. 上下文累积
- 后续子任务可以访问前面所有已完成任务的：
  - 输出文件（.pkl）
  - 代码内容
  - 执行状态

### 3. 精确重试
- 每个子任务最多重试3次
- 只重做失败的子任务，不影响已通过的任务
- 重试时会包含前一轮的错误信息

### 4. 状态管理
- 每个子任务有独立的运行目录
- task_state.json 记录详细状态
- 支持断点续传

## 📁 文件结构

### 核心组件

```
my_claude/
├── get_all_subtasks.py          # 获取所有118个子任务列表
├── context_manager.py           # 上下文管理器（收集前置任务的输出和代码）
├── subtask_executor.py          # 子任务执行器（执行单个子任务）
├── run_all_subtasks_incremental.py  # 批量执行脚本
└── test_single_subtask.sh       # 测试脚本
```

### 输出目录结构

```
output/Bio_runs/
├── 25303977_0_incremental_20260528_143022/
│   ├── task_state.json          # 任务状态
│   ├── round_1/
│   │   └── cli_output.log       # CLI执行日志
│   ├── round_2/                 # 如果失败重试
│   ├── outputs/
│   │   └── *.pkl                # 输出文件
│   └── final_code.py            # 最终通过的代码
├── 25303977_1_incremental_20260528_143145/
├── ...
└── incremental_batch_stats.json # 批量执行统计
```

## 🔧 使用方法

### 1. 测试单个子任务

```bash
# 执行第一个子任务
python subtask_executor.py 25303977_0

# 或使用测试脚本
./test_single_subtask.sh
```

### 2. 执行某个母任务的所有子任务

```bash
# 执行 25303977 的所有8个子任务
python run_all_subtasks_incremental.py --study 25303977
```

### 3. 批量执行所有118个子任务

```bash
# 从头开始执行
python run_all_subtasks_incremental.py

# 从第10个子任务开始（断点续传）
python run_all_subtasks_incremental.py --start 10

# 修改最大重试次数
python run_all_subtasks_incremental.py --max-rounds 5
```

## 🔍 执行流程

### 单个子任务执行流程

```
开始执行 25303977_2
  │
  ├─ Round 1
  │   ├─ 1. 构建上下文
  │   │   ├─ 收集 25303977_0 的输出和代码
  │   │   └─ 收集 25303977_1 的输出和代码
  │   │
  │   ├─ 2. 调用 BioDSBench CLI
  │   │   ├─ 设置 BIODSBENCH_OUTPUTS_DIR
  │   │   ├─ 设置 BIODSBENCH_PREV_OUTPUTS
  │   │   └─ 执行 bun cli.ts
  │   │
  │   ├─ 3. 验证输出
  │   │   └─ 调用 judge.py
  │   │
  │   └─ 结果: 失败 ❌
  │
  ├─ Round 2
  │   ├─ 1. 构建上下文（包含Round 1的错误信息）
  │   ├─ 2. 调用 CLI
  │   ├─ 3. 验证输出
  │   └─ 结果: 通过 ✅
  │
  └─ 保存最终代码，进入下一个子任务
```

### 批量执行流程

```
for 每个子任务 (118个):
    执行子任务（最多3次重试）
    if 通过:
        记录结果，继续下一个
    else:
        记录失败，继续下一个
```

## 📊 状态文件格式

### task_state.json

```json
{
  "task_id": "25303977_0",
  "study_id": "25303977",
  "task_index": 0,
  "status": "passed",
  "current_round": 2,
  "max_rounds": 3,
  "rounds": [
    {
      "round": 1,
      "status": "failed",
      "start_time": "2026-05-28T14:30:22",
      "end_time": "2026-05-28T14:32:15",
      "error": "Assertion failed: ..."
    },
    {
      "round": 2,
      "status": "passed",
      "start_time": "2026-05-28T14:32:20",
      "end_time": "2026-05-28T14:34:10",
      "error": null
    }
  ],
  "start_time": "2026-05-28T14:30:22",
  "end_time": "2026-05-28T14:34:10"
}
```

### incremental_batch_stats.json

```json
{
  "total": 118,
  "completed": 50,
  "passed": 45,
  "failed": 5,
  "skipped": 0,
  "start_time": "2026-05-28T14:00:00",
  "results": [
    {
      "task_id": "25303977_0",
      "status": "passed",
      "rounds": 2,
      "run_dir": "output/Bio_runs/25303977_0_incremental_20260528_140000"
    },
    ...
  ]
}
```

## 🆚 方法1 vs 方法2 对比

| 特性 | 方法1（当前） | 方法2（增量） |
|------|--------------|--------------|
| 执行方式 | 一次性生成所有代码 | 逐个执行子任务 |
| 验证时机 | 全部完成后验证 | 每个完成后立即验证 |
| 失败处理 | 停在第一个失败 | 记录失败，继续执行 |
| 重试策略 | 重做所有任务 | 只重做失败的任务 |
| 上下文传递 | 无（一次性生成） | 累积传递 |
| 任务粒度 | 13个combined任务 | 118个原子任务 |
| 输出目录 | 一个目录 | 每个子任务一个目录 |

## 🔧 环境变量

### BIODSBENCH_OUTPUTS_DIR
- 当前子任务的输出目录
- 用于保存生成的 .pkl 文件

### BIODSBENCH_PREV_OUTPUTS
- 前面所有已完成任务的输出目录（用 `:` 分隔）
- 用于加载前置任务的输出文件

## 📝 注意事项

### 1. 依赖关系
- 子任务按顺序执行，确保依赖关系正确
- 例如：25303977_2 可以访问 25303977_0 和 25303977_1 的输出

### 2. 失败处理
- 某个子任务失败不会阻止后续任务执行
- 但后续任务可能因为缺少依赖而失败

### 3. 资源管理
- 每个子任务有独立的运行目录
- 注意磁盘空间使用

### 4. 断点续传
- 使用 `--start` 参数从指定位置继续
- 状态文件会持续更新

## 🚀 下一步

1. **测试单个子任务**
   ```bash
   ./test_single_subtask.sh
   ```

2. **测试一个母任务**
   ```bash
   python run_all_subtasks_incremental.py --study 25303977
   ```

3. **等待方法1完成后，批量评估方法2**
   ```bash
   python run_all_subtasks_incremental.py
   ```

## 📈 预期结果

- 每个子任务最多3次重试
- 成功的子任务会保存最终代码和输出
- 失败的子任务会记录详细错误信息
- 最终生成完整的统计报告

## 🐛 调试

### 查看子任务状态
```bash
cat output/Bio_runs/25303977_0_incremental_*/task_state.json
```

### 查看CLI日志
```bash
cat output/Bio_runs/25303977_0_incremental_*/round_1/cli_output.log
```

### 查看批量执行统计
```bash
cat output/Bio_runs/incremental_batch_stats.json
```
