# 方法2实现文档（修正版）

## 📋 核心设计（已修正）

### 关键理解
- **13个母任务相互独立** - 母任务之间没有任何关系
- **母任务内部增量执行** - 子任务之间上下文累积
- **每个子任务最多3次重试**

### 执行架构

```
母任务1 (25303977)
  ├─ 子任务0 (最多3次重试)
  ├─ 子任务1 (可访问子任务0的输出，最多3次重试)
  ├─ 子任务2 (可访问子任务0-1的输出，最多3次重试)
  └─ ...

母任务2 (27959731) - 独立，不依赖母任务1
  ├─ 子任务0
  ├─ 子任务1
  └─ ...

...
```

## 🎯 方法1 vs 方法2 对比

| 特性 | 方法1 | 方法2 |
|------|-------|-------|
| **任务粒度** | 13个combined任务 | 13个母任务 |
| **子任务执行** | 一次性生成所有代码 | 逐个执行，上下文累积 |
| **验证时机** | 全部完成后验证 | 每个子任务完成后立即验证 |
| **失败处理** | 停在第一个失败 | 记录失败，继续执行 |
| **重试策略** | 重做所有子任务 | 只重做失败的子任务 |
| **重试次数** | 5次/母任务 | 3次/子任务 |
| **母任务关系** | 独立 | 独立 |
| **子任务关系** | 无（一次性生成） | 上下文累积 |

## 📁 文件结构

### 核心组件

```
my_claude/
├── get_all_subtasks.py          # 母任务配置（13个母任务）
├── study_task_executor.py       # 母任务执行器（核心）
├── run_method2_batch.py         # 批量执行脚本
├── test_single_subtask.sh       # 测试脚本（测试一个母任务）
└── start_method2_batch.sh       # 启动脚本
```

### 输出目录结构

```
output/Bio_runs/
├── 25303977_incremental_20260528_143022/
│   ├── study_state.json         # 母任务状态
│   ├── outputs/                 # 所有子任务共享的输出目录
│   │   ├── result_0.pkl
│   │   ├── result_1.pkl
│   │   └── ...
│   ├── subtask_0/
│   │   ├── round_1/
│   │   │   └── cli_output.log
│   │   └── round_2/             # 如果失败重试
│   ├── subtask_1/
│   ├── subtask_2/
│   └── ...
├── 27959731_incremental_20260528_150000/
├── ...
└── method2_batch_stats.json     # 批量执行统计
```

## 🔧 使用方法

### 1. 测试单个母任务（8个子任务）

```bash
# 测试 25303977（8个子任务）
./test_single_subtask.sh

# 或直接指定
python run_method2_batch.py --study 25303977
```

### 2. 批量执行所有13个母任务

```bash
# 使用启动脚本
./start_method2_batch.sh

# 或直接执行
python run_method2_batch.py
```

### 3. 断点续传

```bash
# 从第5个母任务开始
python run_method2_batch.py --start 5
```

### 4. 修改重试次数

```bash
# 每个子任务最多重试5次
python run_method2_batch.py --max-rounds 5
```

## 🔍 执行流程

### 单个母任务执行流程

```
开始执行母任务 25303977 (8个子任务)
  │
  ├─ 子任务0 (25303977_0)
  │   ├─ Round 1
  │   │   ├─ 构建上下文: "这是第一个子任务，没有前置依赖"
  │   │   ├─ 调用 CLI 执行
  │   │   ├─ 验证输出
  │   │   └─ 结果: 通过 ✅
  │   └─ 保存到 outputs/
  │
  ├─ 子任务1 (25303977_1)
  │   ├─ Round 1
  │   │   ├─ 构建上下文: "前面已完成1个子任务，可以使用 outputs/ 中的文件"
  │   │   ├─ 调用 CLI 执行
  │   │   ├─ 验证输出
  │   │   └─ 结果: 失败 ❌
  │   ├─ Round 2
  │   │   ├─ 构建上下文: "包含前一轮的错误信息"
  │   │   ├─ 调用 CLI 执行
  │   │   ├─ 验证输出
  │   │   └─ 结果: 通过 ✅
  │   └─ 保存到 outputs/
  │
  ├─ 子任务2 (25303977_2)
  │   ├─ 构建上下文: "前面已完成2个子任务，可以使用它们的输出"
  │   └─ ...
  │
  └─ 完成，生成 study_state.json
```

### 批量执行流程

```
for 每个母任务 (13个):
    创建母任务运行目录
    创建共享的 outputs/ 目录
    
    for 每个子任务:
        for 尝试 (最多3次):
            1. 构建上下文（包含前面已完成子任务的输出）
            2. 调用 CLI 执行
            3. 验证输出
            4. 如果通过，进入下一个子任务
               如果失败，重试当前子任务
    
    保存母任务状态
```

## 📊 状态文件格式

### study_state.json（母任务状态）

```json
{
  "study_id": "25303977",
  "num_subtasks": 8,
  "status": "passed",
  "completed_subtasks": 8,
  "passed_subtasks": 7,
  "failed_subtasks": 1,
  "subtasks": [
    {
      "task_id": "25303977_0",
      "subtask_index": 0,
      "status": "passed",
      "rounds": [
        {
          "round": 1,
          "status": "passed",
          "start_time": "2026-05-28T14:30:22",
          "end_time": "2026-05-28T14:32:15",
          "error": null
        }
      ],
      "start_time": "2026-05-28T14:30:22",
      "end_time": "2026-05-28T14:32:15"
    },
    {
      "task_id": "25303977_1",
      "subtask_index": 1,
      "status": "passed",
      "rounds": [
        {
          "round": 1,
          "status": "failed",
          "error": "Assertion failed..."
        },
        {
          "round": 2,
          "status": "passed",
          "error": null
        }
      ]
    }
  ],
  "start_time": "2026-05-28T14:30:00",
  "end_time": "2026-05-28T15:00:00"
}
```

### method2_batch_stats.json（批量执行统计）

```json
{
  "total_studies": 13,
  "completed_studies": 13,
  "passed_studies": 11,
  "failed_studies": 2,
  "total_subtasks": 118,
  "passed_subtasks": 105,
  "failed_subtasks": 13,
  "start_time": "2026-05-28T14:00:00",
  "end_time": "2026-05-28T20:30:00",
  "results": [
    {
      "study_id": "25303977",
      "status": "passed",
      "passed_subtasks": 8,
      "failed_subtasks": 0,
      "total_subtasks": 8,
      "run_dir": "output/Bio_runs/25303977_incremental_20260528_140000"
    }
  ]
}
```

## ⏱️ 时间估算

- **单个子任务**: 2-10分钟（取决于复杂度和重试次数）
- **单个母任务**: 20-80分钟（取决于子任务数量）
- **全部13个母任务**: 4-12小时

## 🔍 监控和调试

### 查看实时进度

```bash
# 查看批量统计
watch -n 30 'cat output/Bio_runs/method2_batch_stats.json | jq ".completed_studies, .passed_subtasks, .failed_subtasks"'
```

### 查看某个母任务的状态

```bash
# 查看最新的运行
ls -td output/Bio_runs/25303977_incremental_* | head -1 | xargs -I {} cat {}/study_state.json
```

### 查看失败的子任务

```bash
# 从母任务状态中提取失败的子任务
cat output/Bio_runs/25303977_incremental_*/study_state.json | jq '.subtasks[] | select(.status=="failed") | .task_id'
```

## 📝 关键差异说明

### 与方法1的核心差异

1. **子任务执行方式**
   - 方法1: AI一次性生成包含所有子任务的完整脚本
   - 方法2: AI逐个生成每个子任务的代码，每次只处理一个

2. **上下文传递**
   - 方法1: 无上下文传递（一次性生成）
   - 方法2: 后续子任务可以看到前面子任务的输出文件和代码

3. **失败处理**
   - 方法1: 验证停在第一个失败，需要重做整个母任务
   - 方法2: 只重做失败的子任务，已通过的子任务不受影响

4. **输出目录**
   - 方法1: 一个workspace目录，包含一个完整脚本
   - 方法2: 每个子任务有独立的round目录，共享outputs目录

## ✅ 验证清单

- [x] 13个母任务配置正确
- [x] 母任务执行器实现完整
- [x] 批量执行脚本实现完整
- [x] 测试脚本更新
- [x] 启动脚本更新
- [x] 文档更新

## 🚀 下一步

1. **等待方法1完成** (~16:40)
2. **测试方法2单个母任务**
   ```bash
   ./test_single_subtask.sh
   ```
3. **启动方法2批量评估**
   ```bash
   ./start_method2_batch.sh
   ```
4. **对比方法1和方法2的结果**

---

**更新时间**: 2026-05-28 15:10
**状态**: ✅ 已修正，就绪
