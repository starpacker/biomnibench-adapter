# BioDSBench 轨迹增强完成报告

## 📋 改进概述

根据你的需求，我已经完成了以下增强：

1. **保存完整的上下文信息**（包括前面子任务的代码和描述）
2. **保存详细的执行轨迹**（用于后续分析模型错误）
3. **创建轨迹分析工具**（帮助快速定位和分析问题）

---

## ✅ 完成的修改

### 1. 增强 `study_task_executor.py`

#### 修改 1: 上下文构建 (`_build_context`)

**之前**：只传递简单的文本描述
```python
def _build_context(...) -> str:
    return "前面已完成X个子任务..."
```

**现在**：返回完整的结构化上下文
```python
def _build_context(...) -> Dict:
    return {
        "current_subtask_idx": 1,
        "previous_subtasks": [
            {
                "task_id": "25303977_0",
                "description": "...",      # ✅ 新增：任务描述
                "generated_code": "...",   # ✅ 新增：实际生成的代码
                "output_files": [...]      # ✅ 新增：输出文件列表
            }
        ],
        "retry_info": {
            "failed_code": "...",          # ✅ 新增：失败的代码
            "error": "..."
        }
    }
```

**好处**：
- AI现在能看到前面子任务**实际生成的代码**，而不只是描述
- AI能理解前面任务**具体做了什么**
- 重试时能看到**失败的代码**，避免重复错误

#### 修改 2: 保存轨迹信息 (`_run_cli`)

**新增功能**：
```python
# 1. 保存上下文到文件
context_file = round_dir / "context.json"
with open(context_file, "w") as f:
    json.dump(context, f, indent=2, ensure_ascii=False)

# 2. 提取并保存AI生成的代码
self._extract_and_save_generated_code(task_id, round_dir)

# 3. 保存任务描述
self._save_task_description(task_id, round_dir)
```

#### 修改 3: 新增 `_extract_and_save_generated_code`

**功能**：从BioDSBench CLI的运行目录中提取AI生成的代码

```python
def _extract_and_save_generated_code(self, task_id, round_dir):
    # 1. 找到CLI创建的运行目录
    # 2. 查找生成的代码文件（.py）
    # 3. 保存到 round_dir/generated_code.py
    # 4. 同时保存到 subtask_root/ （用于后续子任务的上下文）
    # 5. 保存agent轨迹文件（logs, conversations, traces）
```

**保存位置**：
- `round_X/generated_code.py` - 该轮生成的代码
- `subtask_X/generated_code.py` - 最终代码（供后续子任务引用）
- `round_X/agent_traces/` - 完整的agent轨迹

#### 修改 4: 新增 `_save_task_description`

**功能**：从task.json提取并保存任务描述

```python
def _save_task_description(self, task_id, round_dir):
    # 提取：
    # - instruction（任务指令）
    # - background（背景信息）
    # - requirements（要求）
    # 保存到：
    # - round_X/task_description.txt
    # - subtask_X/task_description.txt
```

#### 修改 5: 增强评测结果保存 (`_validate_output`)

**新增**：保存详细的评测结果
```python
detailed_result = {
    "evaluation": eval_result,           # 评测结果
    "evaluator_stdout": result.stdout,   # ✅ 新增：评测器输出
    "evaluator_stderr": result.stderr,   # ✅ 新增：评测器错误
    "evaluator_returncode": result.returncode
}

# 保存到 {task_id}_eval_detailed.json
```

**好处**：
- 评测失败时能看到完整的错误堆栈
- 能理解测试为什么失败
- 能追踪评测器本身的问题

---

### 2. 创建轨迹分析工具 (`analyze_traces.py`)

一个强大的命令行工具，帮助你快速分析测评结果。

#### 功能 1: 批次分析

```bash
python3 analyze_traces.py --batch-dir /data/yjh/biodsbench-serial-results/batch_*
```

**输出**：
- 批次统计（总数、通过、失败、成功率）
- 所有失败任务列表
- 错误类型分布（自动分类）

#### 功能 2: 母任务分析

```bash
python3 analyze_traces.py --batch-dir /data/... --study-id 25303977
```

**输出**：
- 母任务的所有子任务状态
- 每个子任务的尝试轮次
- 失败子任务的错误和文件路径

#### 功能 3: 子任务深度分析

```bash
python3 analyze_traces.py --batch-dir /data/... --task-id 25303977_0
```

**输出**：
- 每一轮的完整信息：
  - 任务描述
  - 上下文（前置任务的代码和描述）
  - 生成的代码（预览）
  - CLI日志
  - Agent轨迹文件列表
- 评测结果详情
- 所有关键文件路径

#### 功能 4: 导出失败案例

```bash
python3 analyze_traces.py --batch-dir /data/... --export-failures failures.json
```

**输出**：生成JSON文件，包含所有失败案例的完整信息

---

### 3. 创建分析指南 (`TRACE_ANALYSIS_GUIDE.md`)

详细的文档，包括：
- 轨迹文件结构说明
- 分析工具使用方法
- 手动分析步骤
- 典型错误分析示例
- 批量统计技巧
- 改进系统的方法

---

## 📊 保存的轨迹结构

```
/data/yjh/biodsbench-serial-results/batch_YYYYMMDD_HHMMSS/
├── batch_state.json                    # 批次总结
├── 25303977/                          # 母任务目录
│   └── 25303977_incremental_*/
│       ├── study_state.json           # 母任务状态
│       ├── outputs/                   # 共享输出目录
│       │   ├── result_0.pkl
│       │   ├── result_1.pkl
│       │   └── ...
│       │
│       ├── subtask_0/                 # 子任务0
│       │   ├── round_1/               # 第1轮尝试
│       │   │   ├── cli_output.log          # ✅ CLI执行日志
│       │   │   ├── context.json            # ✅ 上下文信息
│       │   │   ├── task_description.txt    # ✅ 任务描述
│       │   │   ├── generated_code.py       # ✅ 生成的代码
│       │   │   └── agent_traces/           # ✅ Agent轨迹
│       │   │       ├── agent.log
│       │   │       ├── conversation.json
│       │   │       └── trace.json
│       │   ├── round_2/               # 第2轮尝试（如果需要）
│       │   │   └── ...
│       │   ├── generated_code.py      # 最终代码（供后续引用）
│       │   └── task_description.txt   # 任务描述（供后续引用）
│       │
│       ├── subtask_1/                 # 子任务1
│       │   └── ...
│       │
│       ├── 25303977_0_eval_result.json      # 评测结果
│       └── 25303977_0_eval_detailed.json    # ✅ 详细评测结果
│
└── batch_run.log                      # 完整日志
```

---

## 🎯 关键改进点

### 改进 1: 完整的上下文传递

**问题**：之前AI只知道"前面有X个子任务"，不知道它们具体做了什么。

**解决**：
```json
{
  "previous_subtasks": [
    {
      "task_id": "25303977_0",
      "description": "Load and validate the imaging data",
      "generated_code": "import pandas as pd\ndf = pd.read_csv(...)\n...",
      "output_files": ["result_0.pkl"]
    }
  ]
}
```

现在AI能：
- 看到前面任务的**实际代码**
- 理解前面任务**做了什么操作**
- 知道有哪些**输出文件可用**

### 改进 2: 重试时的错误上下文

**问题**：重试时AI不知道上一轮为什么失败。

**解决**：
```json
{
  "retry_info": {
    "previous_round": 1,
    "error": "TypeError: expected ndarray, got DataFrame",
    "failed_code": "def process():\n    return df  # 错误：返回了DataFrame而不是ndarray\n"
  }
}
```

现在AI能：
- 看到**失败的代码**
- 理解**具体的错误**
- 避免**重复同样的错误**

### 改进 3: 完整的失败分析能力

**之前**：失败后只有一个简短的错误信息。

**现在**：每个失败案例都有：
1. **任务描述** - 要求是什么
2. **上下文** - 前面的任务做了什么
3. **生成的代码** - AI写了什么
4. **执行日志** - 运行时发生了什么
5. **评测详情** - 为什么测试失败
6. **Agent轨迹** - AI的思考过程

你可以完整重现和分析每一个失败。

---

## 📝 使用示例

### 场景 1: 快速查看失败原因

```bash
# 运行测评
./run_small_test.sh

# 等待完成后，查看失败情况
python3 analyze_traces.py --batch-dir /data/yjh/biodsbench-serial-results/batch_*
```

输出示例：
```
❌ 失败的任务 (3):

  📍 25303977_2
     错误: TypeError: expected ndarray, got DataFrame

  📍 34819518_1
     错误: ModuleNotFoundError: No module named 'specific_lib'

  📍 29713087_3
     错误: AssertionError: Expected shape (100, 5), got (100, 4)

📈 错误类型分布:
  - 类型错误: 1
  - 导入错误: 1
  - 测试失败: 1
```

### 场景 2: 深度分析某个失败

```bash
python3 analyze_traces.py --batch-dir /data/... --task-id 25303977_2
```

输出示例：
```
==================================================
Round 1
==================================================

📄 任务描述:
  Convert the preprocessed data to a numpy array...

🔗 上下文:
  - 当前子任务索引: 2
  - 前置子任务数: 2
  - 前置任务 25303977_0: Load data
  - 前置任务 25303977_1: Preprocess data

💻 生成的代码:
  - 代码行数: 45
  - 前10行:
    import pandas as pd
    from pathlib import Path
    
    def convert_to_array():
        # 加载前面的结果
        df = pd.read_pickle("outputs/result_1.pkl")
        return df  # 错误！应该返回 df.values
    ...

📊 评测状态: fail

❌ 失败原因:
  TypeError: expected ndarray, got DataFrame
  
  测试期望numpy array，但代码返回了DataFrame。
  应该使用 df.values 或 df.to_numpy()。
```

### 场景 3: 批量统计

```bash
# 导出所有失败
python3 analyze_traces.py --batch-dir /data/... --export-failures failures.json

# 统计最常见的错误类型
cat failures.json | jq '[.[].rounds[-1].error] | group_by(.) | map({error: .[0], count: length}) | sort_by(.count) | reverse | .[0:5]'

# 统计哪个母任务失败最多
cat failures.json | jq '[.[].study_id] | group_by(.) | map({study: .[0], count: length}) | sort_by(.count) | reverse'
```

---

## 🔍 你可以用这些信息做什么

### 1. 分析模型的常见错误

- 哪种类型的错误最多？（类型错误、导入错误、逻辑错误）
- 模型在哪些任务上表现最差？
- 重试后成功率提高了多少？

### 2. 改进任务设计

- 如果某个任务经常失败，可能是任务描述不够清晰
- 检查 `task_description.txt`，改进描述
- 检查测试是否过于严格

### 3. 研究上下文的影响

- 前置任务的代码是否给后续任务提供了足够信息？
- 上下文传递是否有效？
- 是否需要更多的中间结果？

### 4. 对比成功和失败

```bash
# 对比两个类似任务的代码
diff subtask_0/generated_code.py subtask_1/generated_code.py
```

### 5. 可复现研究

所有信息都被完整保存，你可以：
- 重现任何一次执行
- 分享失败案例给团队
- 写论文时引用具体的案例

---

## 📌 重要文件清单

### 修改的文件
- ✅ `/home/yjh/my_claude/study_task_executor.py` - 增强的执行器

### 新增的文件
- ✅ `/home/yjh/my_claude/analyze_traces.py` - 轨迹分析工具
- ✅ `/home/yjh/my_claude/TRACE_ANALYSIS_GUIDE.md` - 详细使用指南
- ✅ `/home/yjh/my_claude/TRACE_ENHANCEMENT_SUMMARY.md` - 本文档

### 更新的文档
- ✅ `/home/yjh/my_claude/QUICK_START.md` - 更新了轨迹功能说明

---

## ✅ 验证建议

建议按以下顺序验证：

### 1. 小规模测试
```bash
cd /home/yjh/my_claude
./run_small_test.sh
```

### 2. 检查轨迹文件
```bash
# 等待至少一个子任务完成后
ls -la /data/yjh/biodsbench-serial-results/batch_*/*/25303977_incremental_*/subtask_0/round_1/

# 应该看到：
# - cli_output.log
# - context.json
# - task_description.txt
# - generated_code.py
# - agent_traces/ (可能有)
```

### 3. 测试分析工具
```bash
# 等待测试完成后
python3 analyze_traces.py --batch-dir /data/yjh/biodsbench-serial-results/batch_*
```

---

## 🎉 总结

所有增强已完成：

1. ✅ **完整上下文传递**
   - 前置任务的代码
   - 前置任务的描述
   - 可用的输出文件
   - 重试时的失败代码和错误

2. ✅ **详细轨迹保存**
   - AI生成的代码
   - 任务描述
   - CLI执行日志
   - Agent轨迹
   - 详细评测结果

3. ✅ **强大分析工具**
   - 批次分析
   - 母任务分析
   - 子任务深度分析
   - 失败案例导出

4. ✅ **完整文档**
   - 使用指南
   - 分析示例
   - 故障排查

现在你可以：
- 运行测评
- 仔细分析每个失败案例
- 理解模型在哪里、为什么犯错
- 基于分析改进系统

**系统已就绪，可以开始测评了！** 🚀
