#!/usr/bin/env python3
"""
为BioDSBench任务注入简洁的输出格式要求
"""
import sys
from pathlib import Path
import re
from collections import Counter

def generate_concise_output_format(task_dir: Path) -> str:
    """生成简洁的输出格式说明"""

    test_cases_path = task_dir / "evaluation" / "test_cases.py"
    if not test_cases_path.exists():
        return ""

    test_code = test_cases_path.read_text()

    # 提取变量名
    pattern1 = r'assert\s+(\w+)\.'
    pattern2 = r'assert\s+(\w+)\['
    pattern3 = r'assert\s+abs\((\w+)\['

    matches = []
    matches.extend(re.findall(pattern1, test_code))
    matches.extend(re.findall(pattern2, test_code))
    matches.extend(re.findall(pattern3, test_code))

    if not matches:
        return ""

    variable_counts = Counter(matches)
    main_variable = variable_counts.most_common(1)[0][0] if variable_counts else None

    if not main_variable:
        return ""

    # 生成简洁的格式说明
    instruction = f"""

---
**OUTPUT FORMAT (Required for Evaluation):**

Save results as CSV file: `output/{main_variable}.csv`

```python
import os
{main_variable}.to_csv("output/{main_variable}.csv", index=True)
```

Alternative locations: `output/substitution_ratios.csv`, `output/results.csv`, `{main_variable}.csv`
"""

    return instruction


def update_readme(task_dir: Path, dry_run: bool = True):
    """更新README，使用简洁格式"""

    readme_path = task_dir / "README.md"
    if not readme_path.exists():
        return False

    readme_content = readme_path.read_text()

    # 移除旧的详细格式说明
    if "## IMPORTANT: Output Format Requirements for Evaluation" in readme_content:
        # 找到旧的说明并删除
        lines = readme_content.split("\n")
        new_lines = []
        skip = False
        for line in lines:
            if "## IMPORTANT: Output Format Requirements for Evaluation" in line:
                skip = True
            elif skip and line.strip() and not line.startswith("#") and not line.startswith("**") and not line.startswith("-") and not line.startswith("```"):
                skip = False

            if not skip:
                new_lines.append(line)

        readme_content = "\n".join(new_lines).strip()

    # 检查是否已有简洁格式
    if "OUTPUT FORMAT (Required for Evaluation)" in readme_content:
        print(f"  ✓ Already has concise format")
        return False

    # 生成简洁格式
    format_instruction = generate_concise_output_format(task_dir)

    if not format_instruction:
        print(f"  ⚠️  Could not generate format instruction")
        return False

    # 添加到末尾
    new_content = readme_content + "\n" + format_instruction

    if dry_run:
        print(f"  📝 Would add concise format ({len(format_instruction)} chars)")
        return True
    else:
        readme_path.write_text(new_content)
        print(f"  ✅ Added concise format")
        return True


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--tasks-dir", default="/home/yjh/BioDSBench-imaging101-format/tasks")
    parser.add_argument("--write", action="store_true")

    args = parser.parse_args()

    tasks_dir = Path(args.tasks_dir)
    dry_run = not args.write

    print("=" * 80)
    print("BioDSBench Concise Output Format Update")
    print("=" * 80)
    print()

    task_dirs = sorted([d for d in tasks_dir.iterdir() if d.is_dir()])
    modified = 0

    for task_dir in task_dirs:
        print(f"Task: {task_dir.name}")

        test_cases = task_dir / "evaluation" / "test_cases.py"
        if not test_cases.exists():
            print(f"  ⚠️  Not a BioDSBench task")
            print()
            continue

        if update_readme(task_dir, dry_run):
            modified += 1

        print()

    print("=" * 80)
    print(f"Summary: {modified}/{len(task_dirs)} tasks {'would be' if dry_run else 'were'} modified")
    print("=" * 80)


if __name__ == "__main__":
    main()
