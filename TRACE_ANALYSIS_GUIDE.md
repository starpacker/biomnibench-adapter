# BioDSBench 轨迹分析指南

## 📊 已保存的轨迹信息

系统现在会自动保存以下完整轨迹，用于后续深度分析：

### 1. 子任务执行轨迹

每个子任务的每一轮尝试都会保存：

```
/data/yjh/biodsbench-serial-results/batch_*/
└── {study_id}/
    └── {study_id}_incremental_{timestamp}/
        ├── subtask_{idx}/
        │   ├── round_1/
        │   │   ├── cli_output.log           # CLI完整执行日志
        │   │   ├── context.json              # 上下文信息（前置任务的代码和描述）
        │   │   ├── task_description.txt      # 任务描述
        │   │   ├── generated_code.py         # AI生成的代码
        │   │   └── agent_traces/             # Agent完整轨迹
        │   │       ├── agent.log
        │   │       ├── conversation.json
        │   │       └── trace.json
        │   ├── round_2/
        │   └── round_3/
        │   ├── generated_code.py             # 最终成功的代码（软链接）
        │   └── task_description.txt          # 任务描述（软链接）
        │
        └── {task_id}_eval_detailed.json      # 详细评测结果
```

### 2. 上下文信息 (context.json)

```json
{
  "current_subtask_idx": 1,
  "round_num": 1,
  "previous_subtasks": [
    {
      "task_id": "25303977_0",
      "subtask_idx": 0,
      "status": "passed",
      "description": "加载数据并进行初步预处理...",
      "generated_code": "import pandas as pd\n...",
      "output_files": ["result_0.pkl"]
    }
  ],
  "retry_info": {
    "previous_round": 1,
    "error": "TypeError: ...",
    "failed_code": "def process():\n..."
  },
  "available_outputs": ["result_0.pkl"]
}
```

**关键信息**：
- `previous_subtasks`: 前面所有子任务的代码、描述和输出
- `retry_info`: 如果是重试，包含上一轮失败的代码和错误
- 这样AI能看到完整的上下文历史

### 3. 评测详情 (eval_detailed.json)

```json
{
  "evaluation": {
    "status": "fail",
    "feedback": "AssertionError: Expected shape (100, 5), got (100, 4)",
    "test_name": "test_output_shape",
    "expected": {...},
    "actual": {...}
  },
  "evaluator_stdout": "Running tests...\n",
  "evaluator_stderr": "Traceback...\n",
  "evaluator_returncode": 1
}
```

---

## 🔍 使用分析工具

我们提供了 `analyze_traces.py` 工具来帮助你分析测评结果。

### 安装（如需要）

```bash
cd /home/yjh/my_claude
chmod +x analyze_traces.py
```

### 使用方式

#### 1. 分析整个批次

```bash
python3 analyze_traces.py \
    --batch-dir /data/yjh/biodsbench-serial-results/batch_20260606_143022
```

**输出**：
- 批次统计（总任务数、通过/失败数、成功率）
- 所有失败任务列表
- 错误类型分布（超时、导入错误、测试失败等）

#### 2. 分析单个母任务

```bash
python3 analyze_traces.py \
    --batch-dir /data/yjh/biodsbench-serial-results/batch_20260606_143022 \
    --study-id 25303977
```

**输出**：
- 该母任务的所有子任务状态
- 每个子任务的尝试轮次
- 失败子任务的错误信息
- 关键文件路径（生成的代码、评测详情）

#### 3. 深度分析单个子任务

```bash
python3 analyze_traces.py \
    --batch-dir /data/yjh/biodsbench-serial-results/batch_20260606_143022 \
    --task-id 25303977_0
```

**输出**：
- 每一轮的完整信息：
  - 任务描述
  - 上下文信息（前置任务）
  - 生成的代码（前10行预览）
  - CLI执行日志
  - Agent轨迹文件
- 评测结果详情
- 所有关键文件的路径

#### 4. 导出所有失败案例

```bash
python3 analyze_traces.py \
    --batch-dir /data/yjh/biodsbench-serial-results/batch_20260606_143022 \
    --export-failures failed_cases.json
```

**输出**：
- 生成 `failed_cases.json`，包含所有失败案例的：
  - Task ID
  - 所有轮次的错误信息
  - 生成的代码文件路径
  - 评测详情文件路径
  - 任务描述文件路径

---

## 📋 手动分析失败案例

### 步骤1: 找到失败的子任务

```bash
# 查看批次状态
cat /data/yjh/biodsbench-serial-results/batch_*/batch_state.json | jq '.studies[] | select(.status == "failed")'

# 或者使用分析工具
python3 analyze_traces.py --batch-dir /data/yjh/biodsbench-serial-results/batch_*
```

### 步骤2: 查看子任务的详细轨迹

假设失败的子任务是 `25303977_2`：

```bash
cd /data/yjh/biodsbench-serial-results/batch_*/25303977/25303977_incremental_*/subtask_2
```

### 步骤3: 检查每一轮的执行

```bash
# Round 1
cat round_1/task_description.txt          # 任务要求
cat round_1/context.json | jq            # 上下文（前置任务）
cat round_1/generated_code.py            # AI生成的代码
cat round_1/cli_output.log               # 执行日志
ls round_1/agent_traces/                 # Agent轨迹

# Round 2（如果有重试）
cat round_2/context.json | jq '.retry_info'  # 上一轮的错误和失败代码
cat round_2/generated_code.py                # 重试时生成的新代码
```

### 步骤4: 查看评测详情

```bash
# 回到母任务目录
cd ../..

# 查看评测结果
cat 25303977_2_eval_result.json | jq
cat 25303977_2_eval_detailed.json | jq
```

### 步骤5: 对比正确答案（如果有）

```bash
# 查看测试代码（了解期望的行为）
cat /home/yjh/BioDSBench-imaging101-format/tasks/25303977_2/test.py

# 查看参考实现（如果有）
cat /home/yjh/BioDSBench-imaging101-format/tasks/25303977_2/reference_solution.py
```

---

## 🎯 典型错误分析示例

### 示例1: 导入错误

**现象**：
```json
{
  "error": "ModuleNotFoundError: No module named 'specific_lib'"
}
```

**分析路径**：
1. 检查 `generated_code.py` - AI是否使用了不存在的库
2. 检查 `context.json` - 前置任务是否有误导信息
3. 检查环境 - 是否需要安装额外的依赖

### 示例2: 类型错误

**现象**：
```json
{
  "error": "TypeError: expected ndarray, got DataFrame"
}
```

**分析路径**：
1. 检查 `task_description.txt` - 任务描述是否清晰
2. 检查 `context.json` - 前置任务输出的实际类型
3. 检查 `generated_code.py` - AI的理解是否正确
4. 检查 `eval_detailed.json` - 测试期望的具体类型

### 示例3: 测试失败

**现象**：
```json
{
  "evaluation": {
    "status": "fail",
    "feedback": "AssertionError: Expected 5 columns, got 4"
  }
}
```

**分析路径**：
1. 检查 `eval_detailed.json` - 具体的断言失败信息
2. 检查生成的输出文件：
   ```bash
   python3 -c "import pickle; data = pickle.load(open('outputs/result_2.pkl', 'rb')); print(data.shape)"
   ```
3. 检查 `generated_code.py` - 为什么少了一列
4. 检查 `task_description.txt` - 是否明确要求5列

### 示例4: 重复失败（3轮都失败）

**分析路径**：
1. 对比 `round_1/generated_code.py` 和 `round_2/generated_code.py`
   - AI是否理解了错误？
   - AI是否改变了策略？
2. 检查 `round_2/context.json` 的 `retry_info`
   - 错误信息是否清晰？
   - 失败的代码是否正确传递？
3. 判断问题类型：
   - 任务描述不清？
   - 上下文信息不足？
   - 测试过于严格？
   - AI能力问题？

---

## 📊 批量统计分析

### 统计错误类型分布

```bash
python3 analyze_traces.py \
    --batch-dir /data/yjh/biodsbench-serial-results/batch_* \
    --export-failures failures.json

# 然后用jq分析
cat failures.json | jq '[.[].rounds[-1].error] | group_by(.) | map({error: .[0], count: length}) | sort_by(.count) | reverse'
```

### 统计重试次数分布

```bash
cat failures.json | jq '[.[].rounds | length] | group_by(.) | map({retry_count: .[0], task_count: length})'
```

### 找出最常失败的母任务

```bash
cat failures.json | jq '[.[].study_id] | group_by(.) | map({study_id: .[0], failures: length}) | sort_by(.failures) | reverse'
```

---

## 🔄 使用轨迹改进系统

基于分析结果，你可以：

### 1. 改进任务描述

如果发现某个任务经常因为理解错误而失败：
```bash
# 编辑任务描述
vim /home/yjh/BioDSBench-imaging101-format/tasks/{task_id}/task.json
```

### 2. 调整上下文传递

如果发现上下文信息不足，可以修改 `study_task_executor.py` 中的 `_build_context` 方法。

### 3. 改进评测标准

如果发现测试过于严格：
```bash
# 编辑测试代码
vim /home/yjh/BioDSBench-imaging101-format/tasks/{task_id}/test.py
```

### 4. 单独重跑失败的任务

```bash
# 重跑单个母任务
python3 batch_serial_executor.py --studies 25303977

# 或单个子任务（需要修改代码支持）
```

---

## 📝 轨迹文件说明

### CLI输出日志 (cli_output.log)

包含：
- 执行的完整命令
- 退出码
- 标准输出（stdout）
- 标准错误（stderr）

### Agent轨迹 (agent_traces/)

可能包含（取决于BioDSBench CLI的实现）：
- `agent.log` - Agent的决策日志
- `conversation.json` - 与AI的完整对话
- `trace.json` - 工具调用轨迹

### 上下文文件 (context.json)

完整记录：
- 当前子任务的位置
- 所有前置子任务的代码和输出
- 如果是重试，包含上一轮的失败代码和错误

---

## 💡 分析技巧

### 技巧1: 快速定位问题子任务

```bash
# 找到所有失败的子任务
find /data/yjh/biodsbench-serial-results/batch_* -name "study_state.json" -exec sh -c 'cat "$1" | jq -r "select(.status==\"failed\") | .subtasks[] | select(.status==\"failed\") | .task_id"' _ {} \;
```

### 技巧2: 对比成功和失败的代码

```bash
# 假设 task_0 成功，task_1 失败
diff subtask_0/generated_code.py subtask_1/generated_code.py
```

### 技巧3: 追踪上下文传递

```bash
# 查看子任务1使用了哪些前置任务的信息
cat subtask_1/round_1/context.json | jq '.previous_subtasks[].task_id'
```

### 技巧4: 验证输出文件

```bash
# 检查输出文件是否存在和内容
cd outputs/
ls -lh
python3 -c "import pickle; print(pickle.load(open('result_0.pkl', 'rb')))"
```

---

## 🎓 总结

完整的轨迹保存让你能够：

1. **理解模型行为**：看到AI生成的代码和决策过程
2. **分析失败原因**：详细的错误信息和上下文
3. **改进测评系统**：基于实际问题优化任务和测试
4. **研究模型能力**：哪些类型的任务容易失败
5. **可复现研究**：所有信息都被完整保存

使用 `analyze_traces.py` 工具可以大大简化分析工作！
