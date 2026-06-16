# BioDSBench 串行测评系统 - 实施总结

## 概述

本次重构实现了 BioDSBench 的串行测评系统，按照以下逻辑：
- **13个母任务**：独立测评（可独立运行）
- **每个母任务内的子任务**：串行测评（按顺序执行，支持上下文累积）
- **输出方式**：AI 生成代码 → 代码运行生成数据文件 → 测评代码评估

## 系统架构

### 1. 核心组件

#### 1.1 `batch_serial_executor.py`
- **功能**：批量测评器，管理所有13个母任务的执行
- **特点**：
  - 支持选择性测评（通过 `--studies` 参数）
  - 自动配置 API 和环境变量
  - 生成详细的批次执行报告
  - 结果保存至 `/data/yjh/biodsbench-serial-results`

#### 1.2 `study_task_executor.py`（已修改）
- **功能**：单个母任务执行器
- **修改内容**：
  - 添加命令行参数支持（`--runs-dir`, `--max-rounds`, `--timeout`）
  - 更新 API 配置为新的端点和模型
  - 支持自定义输出目录
- **特点**：
  - 子任务串行执行，fail-fast 策略
  - 上下文累积（后续子任务可访问前面子任务的输出）
  - 每个子任务支持最多 N 次重试

#### 1.3 `incremental_evaluator.py`（已验证）
- **功能**：增量评测器，评估单个子任务的输出
- **支持的输出格式**：
  - Pickle 文件 (*.pkl)
  - JSON 文件 (*.json)
  - CSV 文件 (*.csv)
  - Python 代码（workspace/*.py）
- **特点**：
  - 智能变量名映射
  - 智能列名映射
  - 灵活的测试用例执行

### 2. 配置

#### 2.1 API 配置
```bash
ANTHROPIC_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
ANTHROPIC_BASE_URL="https://api.gpugeek.com"
ANTHROPIC_MODEL="Vendor2/Claude-4.7-opus"
ANTHROPIC_SMALL_FAST_MODEL="Vendor2/Claude-4.7-opus"
```

#### 2.2 母任务配置
```python
STUDY_CONFIGS = {
    "25303977": 8,   # 8个子任务
    "27959731": 10,  # 10个子任务
    "28472509": 10,
    "28481359": 9,
    "28985567": 9,
    "29713087": 7,
    "30742119": 8,
    "30867592": 10,
    "32437664": 13,
    "32864625": 6,
    "33765338": 12,
    "34819518": 6,
    "37699004": 10,
}
```
总计：118个子任务

### 3. 环境修复

#### 3.1 Python 环境链接修复
- **问题**：任务中的 Python 虚拟环境链接指向不存在的路径
- **解决**：创建 `fix_python_links.sh` 脚本
- **结果**：修复了 131 个任务的 Python 链接

## 使用方法

### 1. 测试单个子任务
```bash
python3 test_simple.py
```

### 2. 测试单个母任务
```bash
python3 batch_serial_executor.py --studies 34819518
```

### 3. 运行完整测评
```bash
./run_biodsbench_full.sh
```

### 4. 运行指定的母任务
```bash
python3 batch_serial_executor.py \
    --studies 25303977 27959731 \
    --output-dir /data/yjh/biodsbench-serial-results \
    --max-rounds 3 \
    --timeout 3600
```

## 测试验证

### 测试 1：环境修复
- ✅ 修复了 131 个任务的 Python 环境链接

### 测试 2：单个子任务执行
- ✅ 任务：34819518_0
- ✅ AI 成功生成代码并输出结果文件（result.json）
- ✅ 增量评测器成功验证输出，测试通过

### 测试 3：完整流程验证
- ✅ CLI 调用成功
- ✅ 输出文件生成
- ✅ 增量评测器评估通过

## 输出结构

```
/data/yjh/biodsbench-serial-results/
├── batch_20260606_XXXXXX/           # 批次运行目录
│   ├── batch_state.json             # 批次状态
│   ├── 25303977/                    # 母任务目录
│   │   ├── 25303977_incremental_*/ # 母任务运行目录
│   │   │   ├── study_state.json    # 母任务状态
│   │   │   ├── outputs/            # 共享输出目录
│   │   │   ├── subtask_0/          # 子任务0运行记录
│   │   │   │   ├── round_1/
│   │   │   │   ├── round_2/
│   │   │   │   └── round_3/
│   │   │   ├── subtask_1/
│   │   │   └── ...
│   ├── 27959731/
│   └── ...
└── batch_run.log                    # 批次运行日志
```

## BioMniBench 整理

### 脚本：`organize_biomnibench.py`
- **功能**：将 BioMniBench 数据整理为统一的目录结构
- **参考结构**：`conventional_ptychography`
- **标准目录**：
  ```
  task_name/
  ├── envs/              # 环境配置
  ├── evaluation/        # 评测脚本和数据
  ├── std_code/          # 标准代码
  ├── visible_data/      # 可见数据
  ├── README.md
  ├── output_schema.json
  ├── requirements.txt
  └── task_manifest.json
  ```

### 支持的源格式
1. **标准格式**（如 conventional_ptychography）：直接复制
2. **新格式**（如 da-1-3）：自动转换为标准格式
   - `environment/` → `envs/`
   - `tests/` → `evaluation/`
   - `instruction.md` → `README.md`
   - `task.toml` → `task_manifest.json`

## 下一步

1. **运行完整测评**
   ```bash
   ./run_biodsbench_full.sh
   ```

2. **监控进度**
   ```bash
   tail -f /data/yjh/biodsbench-serial-results/batch_run.log
   ```

3. **查看结果**
   ```bash
   cat /data/yjh/biodsbench-serial-results/batch_*/batch_state.json
   ```

4. **BioMniBench 整理**
   ```bash
   python3 organize_biomnibench.py
   ```

## 文件清单

### 新创建的文件
- `batch_serial_executor.py` - 批量测评器
- `test_simple.py` - 简单测试脚本
- `fix_python_links.sh` - Python 环境修复脚本
- `run_biodsbench_full.sh` - 完整测评运行脚本
- `organize_biomnibench.py` - BioMniBench 整理脚本
- `IMPLEMENTATION_SUMMARY.md` - 本文档

### 修改的文件
- `study_task_executor.py` - 添加命令行参数支持，更新 API 配置

## 关键改进

1. ✅ **母任务独立测评**：每个母任务可以独立运行，便于并行和重试
2. ✅ **子任务串行测评**：子任务按顺序执行，支持上下文累积
3. ✅ **灵活的输出处理**：支持多种输出格式（pkl, json, csv, py）
4. ✅ **详细的状态跟踪**：批次、母任务、子任务三级状态记录
5. ✅ **环境自动修复**：修复了 Python 环境链接问题
6. ✅ **统一的 API 配置**：使用最新的 Claude 4.7 Opus 模型

## 测评逻辑总结

```
批量测评
├── 母任务1（独立）
│   ├── 子任务0 → 生成代码 → 运行 → 输出文件 → 增量评测 ✓
│   ├── 子任务1 → 生成代码 → 运行 → 输出文件 → 增量评测 ✓
│   └── ...
├── 母任务2（独立）
│   ├── 子任务0 → ...
│   └── ...
└── ...
```

每个子任务：
1. CLI 调用 AI 生成代码
2. 代码在沙箱中运行，生成输出文件
3. 增量评测器加载输出文件并执行测试用例
4. 返回通过/失败结果
