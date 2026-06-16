# BioDSBench Evaluation Harness - 配置与使用文档

## 📋 项目概述

**项目名称**: BioDSBench Evaluation Harness (my_claude)  
**位置**: `/home/yjh/my_claude`  
**用途**: 使用AI Agent评估生物信息学数据科学任务  
**技术栈**: Bun + TypeScript + Python

---

## 🏗️ 系统架构

### 核心组件

```
my_claude/
├── src/                          # TypeScript源码
│   └── harness/
│       └── evaluation/
│           └── cli.ts           # 评估CLI入口
├── tasks/                        # 任务目录
│   ├── <task_id>/               # 单个任务
│   └── <study_id>_combined/     # Combined任务
├── output/Bio_runs/              # 评估结果
├── config/                       # 配置文件
│   └── llm-config.sh            # LLM配置
└── scripts/                      # 自动化脚本
```

### 任务结构

每个任务包含：

```
tasks/<task_id>/
├── task_manifest.json           # 任务配置（必需）
├── queries.md                   # 任务描述
├── README.md                    # 任务说明
├── cot_instructions.md          # 思维链指令
├── requirements.txt             # Python依赖
├── workdir/                     # 工作数据
├── data/                        # 原始数据
├── envs/                        # 环境配置
│   └── env_manifest.json
└── evaluation/                  # Judge系统
    ├── judge.py                 # Judge包装器（入口点）
    ├── run_reference.py         # 输出加载器
    ├── test_cases.py            # 断言测试
    ├── reference_answer.py      # 参考答案
    ├── prefix.py                # 前置代码
    └── metrics.json             # 评分指标
```

---

## ⚙️ Judge系统配置

### 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Agent 提交                            │
│  生成 outputs/*.pkl 文件（每个变量一个pickle文件）            │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              evaluation/judge.py (包装器)                    │
│  • 解析 --result 和 --submission 参数                        │
│  • 设置 BIODSBENCH_OUTPUTS_DIR 环境变量                      │
│  • 调用 run_reference.py                                    │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│          evaluation/run_reference.py (加载器)               │
│  • 读取 BIODSBENCH_OUTPUTS_DIR                              │
│  • 加载所有 *.pkl 文件到命名空间                             │
│  • 执行 test_cases.py                                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│          evaluation/test_cases.py (断言)                    │
│  • 访问命名空间中的变量                                      │
│  • 执行 assert 语句验证                                      │
│  • 抛出 AssertionError（如果失败）                           │
└─────────────────────────────────────────────────────────────┘
```

### task_manifest.json 配置

```json
{
  "version": 1,
  "task_id": "25303977_combined",
  "public_bundle": [
    "README.md",
    "queries.md",
    "cot_instructions.md",
    "requirements.txt",
    "workdir",
    "envs"
  ],
  "private_judge_bundle": [
    "evaluation"
  ],
  "entrypoints": {
    "judge": "evaluation/judge.py",
    "environment": "envs/env_manifest.json"
  },
  "submission": {
    "output_dir": "outputs"
  }
}
```

**关键配置**:
- `entrypoints.judge`: 必须指向 `evaluation/judge.py`（不是test_cases.py）
- `submission.output_dir`: AI输出目录，默认为 `outputs`

### judge.py 实现

```python
#!/usr/bin/env python3
import sys
import os
import json
import subprocess
from pathlib import Path

def main():
    # 解析参数
    result_file = None
    submission_dir = None
    
    i = 0
    while i < len(sys.argv):
        if sys.argv[i] == '--result' and i + 1 < len(sys.argv):
            result_file = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--submission' and i + 1 < len(sys.argv):
            submission_dir = sys.argv[i + 1]
            i += 2
        else:
            i += 1
    
    # 设置环境变量（关键！）
    env = os.environ.copy()
    env['BIODSBENCH_OUTPUTS_DIR'] = os.path.abspath(submission_dir)
    
    # 获取judge目录（关键！）
    judge_dir = Path(__file__).parent.parent.resolve()
    
    # 运行 run_reference.py
    result = subprocess.run(
        ['python3', 'evaluation/run_reference.py'],
        capture_output=True,
        text=True,
        timeout=300,
        env=env,
        cwd=str(judge_dir)  # 关键！设置正确的工作目录
    )
    
    # 写入结果
    judge_result = {
        "status": "passed" if result.returncode == 0 else "failed",
        "score": 1.0 if result.returncode == 0 else 0.0,
        "feedback": result.stdout if result.returncode == 0 else result.stderr
    }
    
    with open(result_file, 'w') as f:
        json.dump(judge_result, f, indent=2)
    
    sys.exit(0 if result.returncode == 0 else 1)

if __name__ == '__main__':
    main()
```

### run_reference.py 实现

```python
#!/usr/bin/env python3
import os
import pickle
from pathlib import Path

def main():
    namespace = {
        "__name__": "__biodsbench_reference__",
        "__file__": str(TASK_ROOT / "evaluation" / "reference_answer.py"),
    }
    
    # 加载AI输出（关键！）
    outputs_dir = os.environ.get('BIODSBENCH_OUTPUTS_DIR')
    if outputs_dir:
        outputs_path = Path(outputs_dir)
        # 优先加载pickle文件
        loaded_from_pickle = False
        for pkl_file in outputs_path.glob("*.pkl"):
            var_name = pkl_file.stem
            try:
                with open(pkl_file, 'rb') as f:
                    namespace[var_name] = pickle.load(f)
                loaded_from_pickle = True
            except Exception as e:
                print(f"Warning: Could not load {pkl_file.name}: {e}")
        
        # 如果没有pickle文件，尝试加载Python模块
        if not loaded_from_pickle:
            for solution_file in ['solution.py', 'answer.py', 'results.py']:
                solution_path = outputs_path / solution_file
                if solution_path.exists():
                    code = solution_path.read_text(encoding="utf-8")
                    exec(compile(code, str(solution_path), "exec"), namespace)
                    break
    
    # 执行测试
    for filename in ("prefix.py", "reference_answer.py", "test_cases.py"):
        code_path = TASK_ROOT / "evaluation" / filename
        if code_path.exists():
            code = code_path.read_text(encoding="utf-8")
            exec(compile(code, str(code_path), "exec"), namespace)
    
    print("Reference answer and test cases executed successfully.")

if __name__ == "__main__":
    main()
```

---

## 🎯 Combined任务配置

### 什么是Combined任务

Combined任务将同一研究的多个子任务合并为一个整体任务，要求AI一次性完成所有分析步骤。

### 创建Combined任务

使用自动化脚本：

```bash
cd /home/yjh/my_claude
python3 create_all_combined_tasks.py
```

脚本功能：
- 自动识别所有研究ID
- 合并每个研究的所有子任务
- 生成完整的judge配置
- 使用符号链接共享数据（避免重复）

### Combined任务列表

| 任务ID | 子任务数 | 说明 |
|--------|---------|------|
| 25303977_combined | 8 | 突变分析 + 生存分析 |
| 27959731_combined | 10 | |
| 28472509_combined | 10 | |
| 28481359_combined | 9 | |
| 28985567_combined | 9 | |
| 29713087_combined | 7 | |
| 30742119_combined | 8 | |
| 30867592_combined | 10 | |
| 32437664_combined | 13 | |
| 32864625_combined | 6 | |
| 33765338_combined | 12 | |
| 34819518_combined | 6 | |
| 37699004_combined | 10 | |

**总计**: 13个combined任务，118个子任务

---

## 🚀 运行配置

### LLM配置

配置文件: `config/llm-config.sh`

```bash
# Model configuration
export MODEL_NAME="Vendor2/Claude-4.6-opus"
export BASE_URL="https://api.gpugeek.com/v1"
export API_KEY="your-api-key"
```

### 运行参数

```bash
bun run src/harness/evaluation/cli.ts \
  --task "25303977_combined" \
  --tasks-dir "tasks" \
  --runs-dir "output/Bio_runs" \
  --max-rounds 5 \
  --timeout-seconds 7200 \
  --temperature 1 \
  --thinking disabled \
  --agent-runtime source
```

**参数说明**:
- `--task`: 任务ID
- `--max-rounds`: 最大迭代轮数（默认5）
- `--timeout-seconds`: 超时时间（默认7200秒=2小时）
- `--temperature`: 温度参数（默认1）
- `--thinking`: 思维模式（disabled/enabled）

---

## 📝 自动化脚本

### 1. run_biodsbench.sh - 单任务运行

```bash
./run_biodsbench.sh <task_name>
```

示例：
```bash
./run_biodsbench.sh 25303977_combined
```

### 2. run_all_combined_tasks.sh - 批量运行

```bash
# 从头开始运行所有任务
./run_all_combined_tasks.sh

# 从第5个任务开始（索引从0开始）
./run_all_combined_tasks.sh 4
```

功能：
- 依次运行所有13个combined任务
- 支持断点续传
- 自动日志记录
- 失败时询问是否继续
- 最终汇总统计

### 3. start.sh - 交互式启动向导

```bash
./start.sh
```

提供5种运行模式：
1. 运行单个任务（测试）
2. 批量运行所有任务（前台）
3. 批量运行所有任务（后台）
4. 查看任务列表
5. 查看详细文档

### 4. show_all_tasks.sh - 任务列表

```bash
./show_all_tasks.sh
```

显示所有combined任务的详细信息。

### 5. create_all_combined_tasks.py - 任务创建

```bash
python3 create_all_combined_tasks.py
```

批量创建所有combined任务。

---

## 📊 输出结构

### 运行结果目录

```
output/Bio_runs/<task_id>_<timestamp>/
├── run_manifest.json            # 运行配置
├── public/                      # 公开文件
├── workspace/                   # AI工作空间
├── outputs/                     # AI输出（pickle文件）
└── logs/
    ├── run_summary.json         # 运行摘要
    ├── trajectory.clean.jsonl   # 清理后的轨迹
    ├── trajectory.raw.jsonl     # 原始轨迹
    └── run_events.jsonl         # 运行事件
```

### run_summary.json 格式

```json
{
  "status": "passed|failed",
  "rounds": 5,
  "reward": 0,
  "final_result": {
    "status": "passed|failed",
    "score": 0.0,
    "feedback": "..."
  },
  "validation_attempts": [...],
  "run_metadata": {
    "model": "Vendor2/Claude-4.6-opus",
    "temperature": 1,
    ...
  }
}
```

---

## 🔧 故障排查

### 问题1: Judge找不到输出文件

**症状**: `NameError: name 'variable_name' is not defined`

**原因**: AI没有生成pickle文件

**解决**:
```bash
# 检查outputs目录
ls -lh output/Bio_runs/<task>/outputs/
```

### 问题2: Judge入口点错误

**症状**: Judge直接执行test_cases.py，没有加载输出

**原因**: task_manifest.json配置错误

**解决**:
```json
{
  "entrypoints": {
    "judge": "evaluation/judge.py"  // 不是test_cases.py
  }
}
```

### 问题3: 工作目录错误

**症状**: 相对路径解析失败

**原因**: judge.py没有设置正确的工作目录

**解决**: 在judge.py中添加 `cwd=str(judge_dir)`

---

## 📚 参考文档

- **使用指南**: `COMBINED_TASKS_README.md`
- **项目总结**: `PROJECT_SUMMARY.md`
- **快速参考**: `QUICK_REFERENCE.txt`
- **效果报告**: `BIODSBENCH_RESULTS.md`

---

**创建时间**: 2026-05-28  
**最后更新**: 2026-05-28  
**维护者**: BioDSBench Team
