#!/usr/bin/env python3
"""
自动创建所有研究的combined任务
"""
import os
import json
import shutil
from pathlib import Path

# 所有研究ID
STUDY_IDS = [
    "25303977",
    "27959731", 
    "28472509",
    "28481359",
    "28985567",
    "29713087",
    "30742119",
    "30867592",
    "32437664",
    "32864625",
    "33765338",
    "34819518",
    "37699004"
]

TASKS_DIR = Path("/home/yjh/BioDSBench-imaging101-format/tasks")
MY_CLAUDE_TASKS = Path("/home/yjh/my_claude/tasks")

def get_subtasks(study_id):
    """获取某个研究的所有子任务"""
    subtasks = []
    for task_dir in sorted(TASKS_DIR.glob(f"{study_id}_*")):
        if task_dir.is_dir() and not task_dir.name.endswith("_combined"):
            subtasks.append(task_dir.name)
    return subtasks

def create_combined_task(study_id, subtasks):
    """创建combined任务"""
    combined_name = f"{study_id}_combined"
    combined_dir = MY_CLAUDE_TASKS / combined_name
    
    # 如果任务已存在，跳过
    if combined_dir.exists() and (combined_dir / "task_manifest.json").exists():
        print(f"⏭️  {combined_name} 已存在，跳过")
        return combined_name
    
    print(f"\n创建 {combined_name} (包含 {len(subtasks)} 个子任务)...")
    
    # 创建目录
    combined_dir.mkdir(parents=True, exist_ok=True)
    (combined_dir / "evaluation").mkdir(exist_ok=True)
    
    # 复制第一个子任务的基础文件
    first_task = TASKS_DIR / subtasks[0]
    
    # 创建符号链接而不是复制大文件
    # 复制workdir数据 (使用符号链接)
    if (first_task / "workdir").exists() and not (combined_dir / "workdir").exists():
        os.symlink(first_task / "workdir", combined_dir / "workdir")
    
    # 复制data数据 (使用符号链接)
    if (first_task / "data").exists() and not (combined_dir / "data").exists():
        os.symlink(first_task / "data", combined_dir / "data")
    
    # 复制envs (使用符号链接)
    if (first_task / "envs").exists() and not (combined_dir / "envs").exists():
        os.symlink(first_task / "envs", combined_dir / "envs")
    
    # 复制requirements.txt
    if (first_task / "requirements.txt").exists():
        shutil.copy(first_task / "requirements.txt", combined_dir / "requirements.txt")
    
    # 合并所有子任务的queries和test_cases
    all_queries = []
    all_test_cases = []
    all_cot_instructions = []
    
    for i, subtask_name in enumerate(subtasks):
        subtask_dir = TASKS_DIR / subtask_name
        
        # 读取queries.md
        queries_file = subtask_dir / "queries.md"
        if queries_file.exists():
            with open(queries_file, 'r', encoding='utf-8') as f:
                content = f.read()
                all_queries.append(f"## Task {i+1}: {subtask_name}\n\n{content}")
        
        # 读取test_cases.py
        test_cases_file = subtask_dir / "evaluation" / "test_cases.py"
        if test_cases_file.exists():
            with open(test_cases_file, 'r', encoding='utf-8') as f:
                content = f.read()
                all_test_cases.append(f"# Task {i+1}: {subtask_name}\n{content}")
        
        # 读取cot_instructions.md
        cot_file = subtask_dir / "cot_instructions.md"
        if cot_file.exists():
            with open(cot_file, 'r', encoding='utf-8') as f:
                content = f.read()
                all_cot_instructions.append(content)
    
    # 创建合并的queries.md
    queries_content = f"""# Combined Query for Study {study_id}

This is a comprehensive analysis task combining {len(subtasks)} sequential sub-tasks.

"""
    queries_content += "\n\n---\n\n".join(all_queries)
    
    with open(combined_dir / "queries.md", 'w', encoding='utf-8') as f:
        f.write(queries_content)
    
    # 创建README.md
    readme_content = f"""# Combined Task: {combined_name}

This task combines {len(subtasks)} sub-tasks from study {study_id}.

## Sub-tasks included:
"""
    for subtask in subtasks:
        readme_content += f"- {subtask}\n"
    
    with open(combined_dir / "README.md", 'w', encoding='utf-8') as f:
        f.write(readme_content)
    
    # 创建cot_instructions.md
    if all_cot_instructions:
        cot_content = all_cot_instructions[0]  # 使用第一个任务的COT指令
    else:
        cot_content = "Please think step by step and provide detailed analysis."
    
    with open(combined_dir / "cot_instructions.md", 'w', encoding='utf-8') as f:
        f.write(cot_content)
    
    # 创建evaluation/test_cases.py
    test_cases_content = f"# Combined Test Cases for Study {study_id}\n"
    test_cases_content += f"# Tests all {len(subtasks)} tasks in sequence\n\n"
    test_cases_content += "\n\n".join(all_test_cases)
    
    with open(combined_dir / "evaluation" / "test_cases.py", 'w', encoding='utf-8') as f:
        f.write(test_cases_content)
    
    # 创建evaluation/prefix.py
    prefix_content = "# Prefix for combined task\n"
    with open(combined_dir / "evaluation" / "prefix.py", 'w', encoding='utf-8') as f:
        f.write(prefix_content)
    
    # 创建evaluation/reference_answer.py
    reference_content = f'''"""
Reference answer loader for combined task {study_id}.
"""
import sys
import os
import pickle
from pathlib import Path

# Determine outputs directory
if 'BIODSBENCH_OUTPUTS_DIR' in os.environ:
    OUTPUTS_DIR = Path(os.environ['BIODSBENCH_OUTPUTS_DIR'])
else:
    if '__file__' in dir():
        TASK_ROOT = Path(__file__).resolve().parents[1]
    else:
        TASK_ROOT = Path(os.getcwd())
    OUTPUTS_DIR = TASK_ROOT / "outputs"

# Load all output pickle files
for pkl_file in OUTPUTS_DIR.glob("*.pkl"):
    var_name = pkl_file.stem
    try:
        with open(pkl_file, 'rb') as f:
            globals()[var_name] = pickle.load(f)
    except Exception as e:
        print(f"Warning: Could not load {{pkl_file.name}}: {{e}}")
'''
    
    with open(combined_dir / "evaluation" / "reference_answer.py", 'w', encoding='utf-8') as f:
        f.write(reference_content)
    
    # 创建evaluation/run_reference.py
    run_reference_content = '''#!/usr/bin/env python3
"""Run the BioDSBench reference answer and assertion tests for this task."""

from __future__ import annotations

import builtins
import json
import os
import runpy
from pathlib import Path
from typing import Any

import pandas as pd


TASK_ROOT = Path(__file__).resolve().parents[1]
DATA_WORKDIR = TASK_ROOT / "workdir"


def _redirect_workdir_path(path: Any) -> Any:
    if isinstance(path, os.PathLike):
        path = os.fspath(path)
    if isinstance(path, str):
        normalized = path.replace("\\\\", "/")
        if normalized == "/workdir":
            return str(DATA_WORKDIR)
        if normalized.startswith("/workdir/"):
            return str(DATA_WORKDIR / normalized[len("/workdir/"):])
        if normalized == "./workdir" or normalized == "workdir":
            return str(TASK_ROOT / "workdir")
        if normalized.startswith("./workdir/"):
            return str(TASK_ROOT / "workdir" / normalized[len("./workdir/"):])
        if normalized.startswith("workdir/"):
            return str(TASK_ROOT / "workdir" / normalized[len("workdir/"):])
    return path


_real_read_csv = pd.read_csv


def _read_csv_with_workdir_redirect(filepath_or_buffer: Any, *args: Any, **kwargs: Any) -> pd.DataFrame:
    return _real_read_csv(_redirect_workdir_path(filepath_or_buffer), *args, **kwargs)


pd.read_csv = _read_csv_with_workdir_redirect

_real_open = builtins.open


def _open_with_workdir_redirect(file: Any, *args: Any, **kwargs: Any) -> Any:
    return _real_open(_redirect_workdir_path(file), *args, **kwargs)


builtins.open = _open_with_workdir_redirect


def _preload_tables(namespace: dict[str, Any]) -> None:
    task_json_path = TASK_ROOT / "task.json"
    if not task_json_path.exists():
        return
    with task_json_path.open("r", encoding="utf-8") as handle:
        metadata = json.load(handle)
    table_bindings = metadata.get("table_bindings", [])
    for binding in table_bindings:
        csv_path = DATA_WORKDIR / binding["output_file"]
        if not csv_path.exists():
            continue
        df = pd.read_csv(csv_path)
        names = {binding["variable_name"], Path(binding["output_file"]).stem}
        for name in names:
            if name and name.isidentifier():
                namespace[name] = df.copy()


def main() -> None:
    namespace: dict[str, Any] = {
        "__name__": "__biodsbench_reference__",
        "__file__": str(TASK_ROOT / "evaluation" / "reference_answer.py"),
    }
    _preload_tables(namespace)
    
    # Load outputs from submission directory
    outputs_dir = os.environ.get('BIODSBENCH_OUTPUTS_DIR')
    if outputs_dir:
        outputs_path = Path(outputs_dir)
        # Try to load from pickle files first (preferred method)
        import pickle
        loaded_from_pickle = False
        for pkl_file in outputs_path.glob("*.pkl"):
            var_name = pkl_file.stem
            try:
                with open(pkl_file, 'rb') as f:
                    namespace[var_name] = pickle.load(f)
                loaded_from_pickle = True
            except Exception as e:
                print(f"Warning: Could not load {pkl_file.name}: {e}")
        
        # If no pickle files found, try to load from solution.py, answer.py, or results.py
        if not loaded_from_pickle:
            for solution_file in ['solution.py', 'answer.py', 'results.py']:
                solution_path = outputs_path / solution_file
                if solution_path.exists():
                    code = solution_path.read_text(encoding="utf-8")
                    exec(compile(code, str(solution_path), "exec"), namespace)
                    break
    
    for filename in ("prefix.py", "reference_answer.py", "test_cases.py"):
        code_path = TASK_ROOT / "evaluation" / filename
        if code_path.exists():
            code = code_path.read_text(encoding="utf-8")
            exec(compile(code, str(code_path), "exec"), namespace)
    print("Reference answer and test cases executed successfully.")


if __name__ == "__main__":
    main()
'''
    
    with open(combined_dir / "evaluation" / "run_reference.py", 'w', encoding='utf-8') as f:
        f.write(run_reference_content)
    
    # 创建evaluation/judge.py
    judge_content = '''#!/usr/bin/env python3
"""Judge wrapper for combined task."""
import sys
import os
import json
import subprocess
from pathlib import Path

def main():
    # 解析命令行参数
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
    
    if not result_file:
        print("Error: --result argument required")
        sys.exit(1)
    
    if not submission_dir:
        print("Error: --submission argument required")
        sys.exit(1)
    
    # 设置环境变量，让run_reference.py知道outputs目录位置
    env = os.environ.copy()
    env['BIODSBENCH_OUTPUTS_DIR'] = os.path.abspath(submission_dir)
    
    # 获取当前脚本所在目录（judge目录）
    judge_dir = Path(__file__).parent.parent.resolve()
    
    # 运行 run_reference.py
    try:
        result = subprocess.run(
            ['python3', 'evaluation/run_reference.py'],
            capture_output=True,
            text=True,
            timeout=300,
            env=env,
            cwd=str(judge_dir)
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
        
    except Exception as e:
        judge_result = {
            "status": "error",
            "score": 0.0,
            "feedback": str(e)
        }
        with open(result_file, 'w') as f:
            json.dump(judge_result, f, indent=2)
        sys.exit(1)

if __name__ == '__main__':
    main()
'''
    
    with open(combined_dir / "evaluation" / "judge.py", 'w', encoding='utf-8') as f:
        f.write(judge_content)
    os.chmod(combined_dir / "evaluation" / "judge.py", 0o755)
    
    # 创建evaluation/metrics.json
    metrics = {
        "metrics": [
            {
                "name": "correctness",
                "weight": 1.0
            }
        ]
    }
    with open(combined_dir / "evaluation" / "metrics.json", 'w', encoding='utf-8') as f:
        json.dump(metrics, f, indent=2)
    
    # 创建task.json
    task_json = {
        "version": 1,
        "task_id": combined_name,
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
    
    with open(combined_dir / "task.json", 'w', encoding='utf-8') as f:
        json.dump(task_json, f, indent=2)
    
    # 创建task_manifest.json
    task_manifest = {
        "version": 1,
        "task_id": combined_name,
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
    
    with open(combined_dir / "task_manifest.json", 'w', encoding='utf-8') as f:
        json.dump(task_manifest, f, indent=2)
    
    print(f"✅ {combined_name} 创建完成")
    return combined_name

def main():
    print("=" * 60)
    print("开始创建所有combined任务...")
    print("=" * 60)
    
    created_tasks = []
    
    for study_id in STUDY_IDS:
        subtasks = get_subtasks(study_id)
        if len(subtasks) > 0:
            combined_name = create_combined_task(study_id, subtasks)
            created_tasks.append(combined_name)
        else:
            print(f"⚠️  {study_id} 没有找到子任务")
    
    print("\n" + "=" * 60)
    print(f"✅ 完成！共创建 {len(created_tasks)} 个combined任务")
    print("=" * 60)
    
    # 创建任务列表文件
    with open(MY_CLAUDE_TASKS.parent / "combined_tasks_list.txt", 'w') as f:
        for task in created_tasks:
            f.write(f"{task}\n")
    
    print(f"\n任务列表已保存到: {MY_CLAUDE_TASKS.parent / 'combined_tasks_list.txt'}")
    
    return created_tasks

if __name__ == "__main__":
    created = main()
