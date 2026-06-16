#!/usr/bin/env python3
"""
为BioDSBench任务注入输出格式要求
根据biodsbench_judge.py的期望，明确告诉agent需要保存CSV文件
"""
import sys
from pathlib import Path

sys.path.insert(0, '/home/yjh/imaging-101')

from evaluation_harness.biodsbench_judge import run_biodsbench_judge


def generate_output_format_instruction(task_dir: Path) -> str:
    """
    根据任务的test_cases.py生成输出格式说明
    """

    test_cases_path = task_dir / "evaluation" / "test_cases.py"
    if not test_cases_path.exists():
        return ""

    test_code = test_cases_path.read_text()

    # 分析test_cases.py找出变量名
    # 常见的模式：
    #   assert variable_name.shape == ...
    #   assert variable_name['column'] == ...
    #   assert abs(variable_name['column'].sum() - ...) < ...
    import re

    # 匹配模式1: variable.method 或 variable['key']
    pattern1 = r'assert\s+(\w+)\.'
    pattern2 = r'assert\s+(\w+)\['
    pattern3 = r'assert\s+abs\((\w+)\['

    matches = []
    matches.extend(re.findall(pattern1, test_code))
    matches.extend(re.findall(pattern2, test_code))
    matches.extend(re.findall(pattern3, test_code))

    if not matches:
        return ""

    # 获取最常见的变量名
    from collections import Counter
    variable_counts = Counter(matches)
    main_variable = variable_counts.most_common(1)[0][0] if variable_counts else None

    if not main_variable:
        return ""

    # 生成输出格式说明
    instruction = f"""

## IMPORTANT: Output Format Requirements for Evaluation

Your main.py MUST save the results to a CSV file for automated evaluation.

**Required output:**
- Variable name in code: `{main_variable}` (a pandas DataFrame)
- File format: CSV
- File location: One of the following:
  - `output/{main_variable}.csv` (recommended)
  - `output/substitution_ratios.csv`
  - `output/results.csv`
  - `{main_variable}.csv` (in root directory)

**How to save:**
```python
import os
import pandas as pd

# After computing your results in a DataFrame named '{main_variable}'
output_dir = "output"
os.makedirs(output_dir, exist_ok=True)

# Save to CSV - the evaluation system will load this file
output_path = os.path.join(output_dir, "{main_variable}.csv")
{main_variable}.to_csv(output_path, index=True)  # or index=False depending on your data structure

print(f"Results saved to {{output_path}}")
```

**Why CSV format is required:**
The automated evaluation system (biodsbench_judge.py) will:
1. Run your main.py
2. Search for the output CSV file in the locations listed above
3. Load it with `pd.read_csv(filepath, index_col=0)`
4. Pass the loaded DataFrame to test assertions

**Do NOT:**
- Only save as .npy (numpy array) - this will cause evaluation to fail
- Only save as .pkl (pickle) - this will not be recognized
- Only print results without saving - tests need the file

**Verification:**
After your main.py runs, these files should exist:
- `output/{main_variable}.csv` ✓
"""

    return instruction


def add_output_format_to_readme(task_dir: Path, dry_run: bool = True):
    """
    将输出格式要求添加到README.md中
    """

    readme_path = task_dir / "README.md"
    if not readme_path.exists():
        print(f"  ⚠️  README.md not found")
        return False

    readme_content = readme_path.read_text()

    # 检查是否已经包含输出格式说明
    if "Output Format Requirements for Evaluation" in readme_content:
        print(f"  ✓ Already contains output format instructions")
        return False

    # 生成输出格式说明
    format_instruction = generate_output_format_instruction(task_dir)

    if not format_instruction:
        print(f"  ⚠️  Could not generate output format instruction")
        return False

    # 添加到README末尾
    new_content = readme_content + "\n" + format_instruction

    if dry_run:
        print(f"  📝 Would add output format instruction ({len(format_instruction)} chars)")
        return True
    else:
        readme_path.write_text(new_content)
        print(f"  ✅ Added output format instruction")
        return True


def process_all_tasks(tasks_dir: Path, dry_run: bool = True):
    """
    处理所有BioDSBench任务
    """

    print("=" * 80)
    print("BioDSBench Output Format Injection")
    print("=" * 80)
    print()
    print(f"Tasks directory: {tasks_dir}")
    print(f"Mode: {'DRY RUN (no changes)' if dry_run else 'WRITE (will modify files)'}")
    print()

    if not tasks_dir.exists():
        print(f"❌ Tasks directory not found: {tasks_dir}")
        return

    # 获取所有任务目录
    task_dirs = sorted([d for d in tasks_dir.iterdir() if d.is_dir()])

    print(f"Found {len(task_dirs)} tasks")
    print()

    modified_count = 0

    for task_dir in task_dirs:
        task_id = task_dir.name
        print(f"Task: {task_id}")

        # 检查是否是BioDSBench任务
        test_cases = task_dir / "evaluation" / "test_cases.py"
        if not test_cases.exists():
            print(f"  ⚠️  Not a BioDSBench task (no test_cases.py)")
            print()
            continue

        # 添加输出格式说明
        if add_output_format_to_readme(task_dir, dry_run):
            modified_count += 1

        print()

    print("=" * 80)
    print(f"Summary: {modified_count}/{len(task_dirs)} tasks {'would be' if dry_run else 'were'} modified")
    print("=" * 80)

    if dry_run:
        print()
        print("To actually modify files, run with --write flag")


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Inject output format requirements into BioDSBench task READMEs"
    )
    parser.add_argument(
        "--tasks-dir",
        default="/home/yjh/BioDSBench-imaging101-format/tasks",
        help="Path to BioDSBench tasks directory"
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Actually write changes (default is dry-run)"
    )

    args = parser.parse_args()

    tasks_dir = Path(args.tasks_dir)
    dry_run = not args.write

    process_all_tasks(tasks_dir, dry_run)


if __name__ == "__main__":
    main()
