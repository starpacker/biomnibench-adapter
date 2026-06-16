# BioDSBench 测评执行计划

## 当前状态

### ✅ 已完成
1. **环境修复**
   - 修复了 131 个任务的 Python 环境链接
   - 所有任务现在使用正确的 Python 路径：`/home/yjh/.conda/envs/ragas/bin/python3`

2. **测评系统搭建**
   - `batch_serial_executor.py`：批量测评器
   - `study_task_executor.py`：母任务执行器（已修改）
   - `incremental_evaluator.py`：增量评测器（已验证）

3. **流程验证**
   - 单个子任务测试通过（34819518_0）
   - AI 代码生成 ✓
   - 输出文件生成 ✓
   - 增量评测通过 ✓

4. **API 配置**
   - 模型：Vendor2/Claude-4.7-opus
   - 端点：https://api.gpugeek.com
   - API Key：已配置

### 🔄 进行中
- BioMniBench 数据整理（`organize_biomnibench.py` 正在运行）

## 执行步骤

### 第一步：BioDSBench 完整测评

#### 方式 1：运行全部 13 个母任务
```bash
cd /home/yjh/my_claude
./run_biodsbench_full.sh
```

这将：
- 测评所有 13 个母任务（118 个子任务）
- 每个子任务最多重试 3 次
- 每个子任务超时 3600 秒（1小时）
- 结果保存至 `/data/yjh/biodsbench-serial-results/batch_*/`
- 日志输出至 `/data/yjh/biodsbench-serial-results/batch_run.log`

**预计时间**：根据每个子任务的复杂度，可能需要数小时到十几小时

#### 方式 2：先测试小规模母任务
为了节省时间和资源，建议先测试几个小的母任务：

```bash
cd /home/yjh/my_claude

# 测试 3 个最小的母任务（共 19 个子任务）
python3 batch_serial_executor.py \
    --studies 32864625 34819518 29713087 \
    --output-dir /data/yjh/biodsbench-serial-results \
    --max-rounds 3 \
    --timeout 3600
```

这三个母任务的子任务数：
- 32864625: 6 个子任务
- 34819518: 6 个子任务
- 29713087: 7 个子任务

**预计时间**：2-4 小时

#### 方式 3：逐个母任务测评
如果想更精细地控制，可以逐个测评：

```bash
# 测评单个母任务
python3 batch_serial_executor.py --studies 34819518

# 测评完成后再测下一个
python3 batch_serial_executor.py --studies 32864625

# 以此类推...
```

### 第二步：BioMniBench 整理

等待 `organize_biomnibench.py` 完成后，检查结果：

```bash
# 查看整理结果
cat /data/yjh/biomnibench-organized/organization_summary.json

# 查看整理后的目录结构
ls -la /data/yjh/biomnibench-organized/
```

整理完成后，所有任务将按照统一的目录结构组织。

## 监控和调试

### 实时监控日志
```bash
# 监控批次运行日志
tail -f /data/yjh/biodsbench-serial-results/batch_run.log

# 监控特定母任务的输出
tail -f /data/yjh/biodsbench-serial-results/batch_*/25303977/25303977_incremental_*/subtask_*/round_*/cli_output.log
```

### 查看实时状态
```bash
# 查看批次状态
cat /data/yjh/biodsbench-serial-results/batch_*/batch_state.json | jq

# 查看母任务状态
cat /data/yjh/biodsbench-serial-results/batch_*/*/25303977_incremental_*/study_state.json | jq
```

### 检查中间结果
```bash
# 查看某个子任务的输出
ls -la /data/yjh/biodsbench-serial-results/batch_*/25303977/25303977_incremental_*/outputs/

# 查看评测结果
cat /data/yjh/biodsbench-serial-results/batch_*/25303977/25303977_incremental_*/*_eval_result.json
```

## 结果分析

测评完成后，结果将包含：

### 批次级别
- `batch_state.json`：所有母任务的汇总状态
  - 总母任务数
  - 通过的母任务数
  - 失败的母任务数
  - 成功率

### 母任务级别
- `study_state.json`：每个母任务的详细状态
  - 子任务数量
  - 通过的子任务数
  - 失败的子任务数
  - 每个子任务的执行记录

### 子任务级别
- 每轮执行的日志（`cli_output.log`）
- 生成的输出文件（`outputs/`）
- 评测结果（`*_eval_result.json`）

## 建议的执行顺序

1. **先运行小规模测试**（推荐）
   ```bash
   python3 batch_serial_executor.py --studies 34819518
   ```
   - 验证整个流程是否正常
   - 预计时间：30分钟-1小时

2. **然后运行中等规模测试**
   ```bash
   python3 batch_serial_executor.py --studies 32864625 34819518 29713087
   ```
   - 测试 3 个小母任务
   - 预计时间：2-4小时

3. **最后运行完整测评**
   ```bash
   ./run_biodsbench_full.sh
   ```
   - 测评所有 13 个母任务
   - 预计时间：数小时到十几小时

## 故障排查

### 常见问题

1. **Python 环境错误**
   - 解决：运行 `./fix_python_links.sh`

2. **API 超时或错误**
   - 检查 API Key 是否有效
   - 检查网络连接
   - 检查 API 配额

3. **子任务失败**
   - 查看 `cli_output.log` 了解具体错误
   - 查看 `*_eval_result.json` 了解评测失败原因
   - 可以单独重跑失败的母任务

4. **磁盘空间不足**
   - 检查 `/data/yjh` 的可用空间
   - 清理旧的测评结果

## 输出文件说明

```
/data/yjh/biodsbench-serial-results/
├── batch_20260606_XXXXXX/              # 批次目录（时间戳）
│   ├── batch_state.json                # 📊 批次总结
│   ├── 25303977/                       # 母任务目录
│   │   └── 25303977_incremental_XXXXXX/
│   │       ├── study_state.json        # 📊 母任务状态
│   │       ├── outputs/                # 🎯 所有子任务的输出（共享）
│   │       │   ├── result_0.pkl
│   │       │   ├── result_1.pkl
│   │       │   └── ...
│   │       ├── subtask_0/
│   │       │   ├── round_1/
│   │       │   │   └── cli_output.log  # 📝 执行日志
│   │       │   ├── round_2/
│   │       │   └── round_3/
│   │       ├── subtask_1/
│   │       └── ...
│   │       └── 25303977_0_eval_result.json  # ✅ 评测结果
│   ├── 27959731/
│   └── ...
└── batch_run.log                       # 📝 完整批次日志
```

## 联系信息

如有问题，请查看：
- 实施总结：`IMPLEMENTATION_SUMMARY.md`
- 执行计划：本文档
- 代码注释：各个脚本中的详细说明
